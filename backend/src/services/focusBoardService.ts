import { Types } from "mongoose";
import { ILabel, LabelModel } from "../model/Label";
import { InsightModel } from "../model/Insight";
import {
  ILabelPriorityConfig,
  LabelPriorityConfigModel,
} from "../model/LabelPriorityConfig";
import {
  SYSTEM_LABEL_DEFINITIONS,
  ensureSystemLabels,
  normalizeLabelName,
} from "./labelLifecycleService";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECENCY_DECAY_HOURS = 168;
const DEADLINE_WINDOW_HOURS = 48;
const DEADLINE_BOOST = 0.15;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const asObjectId = (accountId: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(accountId)) {
    throw new Error("Invalid accountId");
  }
  return new Types.ObjectId(accountId);
};

const getActivePriorityLabels = async (
  userId: string,
  accountId: string
): Promise<ILabel[]> => {
  return LabelModel.find({
    userId,
    accountId,
    status: "active",
    source: { $in: ["system", "user"] },
  })
    .sort({ createdAt: 1, name: 1 })
    .exec();
};

const getObservedCounts = async (
  userId: string,
  accountId: string,
  onlyRecent: boolean
): Promise<Map<string, number>> => {
  const accountObjectId = asObjectId(accountId);
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const query: Record<string, any> = { userId, accountId: accountObjectId };

  if (onlyRecent) {
    query.updatedAt = { $gte: cutoff };
  }

  const insights = await InsightModel.find(query).select("labels").lean().exec();
  const counts = new Map<string, number>();

  for (const insight of insights) {
    const labels = Array.isArray(insight.labels) ? insight.labels : [];
    const seenPerInsight = new Set<string>();

    for (const label of labels) {
      const labelId = label?.labelId
        ? new Types.ObjectId(label.labelId).toString()
        : "";
      const nameKey = typeof label?.name === "string"
        ? `name:${normalizeLabelName(label.name)}`
        : "";
      const key = labelId ? `id:${labelId}` : nameKey;
      if (!key || seenPerInsight.has(key)) {
        continue;
      }
      seenPerInsight.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return counts;
};

const getCountForLabel = (counts: Map<string, number>, label: ILabel): number => {
  const idKey = `id:${(label._id as Types.ObjectId).toString()}`;
  const nameKey = `name:${normalizeLabelName(label.name)}`;
  return (counts.get(idKey) || 0) + (counts.get(nameKey) || 0);
};

const buildDefaultPriorities = async (
  userId: string,
  accountId: string,
  labels: ILabel[]
): Promise<Array<{ labelId: Types.ObjectId; labelNameSnapshot: string; rank: number }>> => {
  const systemOrderMap = new Map(
    SYSTEM_LABEL_DEFINITIONS.map((d, index) => [normalizeLabelName(d.name), index])
  );

  let counts = await getObservedCounts(userId, accountId, true);
  const hasRecentSignal = Array.from(counts.values()).some((value) => value > 0);
  if (!hasRecentSignal) {
    counts = await getObservedCounts(userId, accountId, false);
  }

  const enriched = labels.map((label) => ({
    label,
    systemOrder: systemOrderMap.has(label.nameNormalized)
      ? (systemOrderMap.get(label.nameNormalized) as number)
      : Number.POSITIVE_INFINITY,
    observedCount: getCountForLabel(counts, label),
  }));

  enriched.sort((a, b) => {
    if (a.systemOrder !== b.systemOrder) {
      return a.systemOrder - b.systemOrder;
    }
    if (a.observedCount !== b.observedCount) {
      return b.observedCount - a.observedCount;
    }
    const aCreated = getCreatedTime(a.label);
    const bCreated = getCreatedTime(b.label);
    if (aCreated !== bCreated) {
      return aCreated - bCreated;
    }
    return a.label.name.localeCompare(b.label.name);
  });

  return enriched.map(({ label }, index) => ({
    labelId: label._id as Types.ObjectId,
    labelNameSnapshot: label.name,
    rank: index + 1,
  }));
};

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
};

const getCreatedTime = (label: ILabel): number => {
  const raw = (label as any).createdAt;
  return raw ? new Date(raw).getTime() : 0;
};

const syncPriorityConfigWithActiveLabels = async (
  config: ILabelPriorityConfig,
  activeLabels: ILabel[]
): Promise<ILabelPriorityConfig> => {
  const activeMap = new Map(
    activeLabels.map((label) => [(label._id as Types.ObjectId).toString(), label])
  );

  const filteredExisting = (config.priorities || [])
    .filter((item) => activeMap.has(item.labelId.toString()))
    .sort((a, b) => a.rank - b.rank);

  const existingIds = new Set(filteredExisting.map((item) => item.labelId.toString()));

  const appended = activeLabels
    .filter((label) => !existingIds.has((label._id as Types.ObjectId).toString()))
    .sort((a, b) => {
      const aCreated = getCreatedTime(a);
      const bCreated = getCreatedTime(b);
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }
      return a.name.localeCompare(b.name);
    })
    .map((label) => ({
      labelId: label._id as Types.ObjectId,
      labelNameSnapshot: label.name,
      rank: 0,
    }));

  const combined = [...filteredExisting, ...appended].map((item, index) => ({
    labelId: item.labelId,
    labelNameSnapshot:
      activeMap.get(item.labelId.toString())?.name || item.labelNameSnapshot,
    rank: index + 1,
  }));

  const currentIds = (config.priorities || [])
    .sort((a, b) => a.rank - b.rank)
    .map((item) => item.labelId.toString());
  const nextIds = combined.map((item) => item.labelId.toString());
  const changed = !arraysEqual(currentIds, nextIds);

  if (changed || appended.length > 0) {
    config.priorities = combined;
    config.lastComputedAt = new Date();
    await config.save();
  } else {
    const snapshotsNeedUpdate = combined.some((item, index) => {
      const existing = config.priorities[index];
      return existing && existing.labelNameSnapshot !== item.labelNameSnapshot;
    });

    if (snapshotsNeedUpdate) {
      config.priorities = combined;
      await config.save();
    }
  }

  return config;
};

export const ensureLabelPriorityConfig = async (
  userId: string,
  accountId: string
): Promise<ILabelPriorityConfig> => {
  await ensureSystemLabels(userId, accountId);
  const activeLabels = await getActivePriorityLabels(userId, accountId);
  let config = await LabelPriorityConfigModel.findOne({ userId, accountId }).exec();

  if (!config) {
    const priorities = await buildDefaultPriorities(userId, accountId, activeLabels);
    config = await LabelPriorityConfigModel.create({
      userId,
      accountId,
      priorities,
      isReviewedByUser: false,
      initializedAt: new Date(),
      lastComputedAt: new Date(),
    });
    return config;
  }

  return syncPriorityConfigWithActiveLabels(config, activeLabels);
};

export const appendLabelToPriorityConfig = async (
  userId: string,
  accountId: string,
  labelId: Types.ObjectId
): Promise<void> => {
  const config = await ensureLabelPriorityConfig(userId, accountId);
  const exists = (config.priorities || []).some(
    (item) => item.labelId.toString() === labelId.toString()
  );
  if (exists) {
    return;
  }

  const label = await LabelModel.findById(labelId).exec();
  if (!label || label.status !== "active" || !["system", "user"].includes(label.source)) {
    return;
  }

  config.priorities.push({
    labelId: label._id as Types.ObjectId,
    labelNameSnapshot: label.name,
    rank: config.priorities.length + 1,
  });
  config.lastComputedAt = new Date();
  await config.save();
};

export const getLabelPriorities = async (
  userId: string,
  accountId: string
): Promise<ILabelPriorityConfig> => {
  return ensureLabelPriorityConfig(userId, accountId);
};

export const reorderLabelPriorities = async (params: {
  userId: string;
  accountId: string;
  orderedLabelIds: string[];
}): Promise<ILabelPriorityConfig> => {
  const config = await ensureLabelPriorityConfig(params.userId, params.accountId);
  const activeLabels = await getActivePriorityLabels(params.userId, params.accountId);
  const activeMap = new Map(
    activeLabels.map((label) => [(label._id as Types.ObjectId).toString(), label])
  );

  const dedupedIds = Array.from(new Set(params.orderedLabelIds));
  if (dedupedIds.length !== params.orderedLabelIds.length) {
    throw new Error("orderedLabelIds contains duplicates");
  }
  if (dedupedIds.length !== activeMap.size) {
    throw new Error("orderedLabelIds must include all active labels exactly once");
  }
  const allOwned = dedupedIds.every((id) => activeMap.has(id));
  if (!allOwned) {
    throw new Error("orderedLabelIds contains labels not available for this account");
  }

  config.priorities = dedupedIds.map((id, index) => ({
    labelId: activeMap.get(id)!._id as Types.ObjectId,
    labelNameSnapshot: activeMap.get(id)!.name,
    rank: index + 1,
  }));
  config.isReviewedByUser = true;
  config.lastEditedAt = new Date();
  await config.save();

  return config;
};

export const markLabelPrioritiesReviewed = async (
  userId: string,
  accountId: string
): Promise<ILabelPriorityConfig> => {
  const config = await ensureLabelPriorityConfig(userId, accountId);
  if (!config.isReviewedByUser) {
    config.isReviewedByUser = true;
    config.lastEditedAt = new Date();
    await config.save();
  }
  return config;
};

interface FocusBoardScoreBreakdown {
  totalScore: number;
  importanceNorm: number;
  labelNorm: number;
  recencyNorm: number;
  deadlineBoost: number;
  matchedLabelRank: number;
}

export interface FocusBoardItem {
  insightId: string;
  gmailThreadId: string;
  summary: {
    shortSnippet: string;
    intent: string;
  };
  from: {
    email: string;
    name?: string;
    domain?: string;
  };
  matchedLabels: string[];
  score: FocusBoardScoreBreakdown;
  timestamps: {
    createdAt?: Date;
    updatedAt?: Date;
    lastSignalAt?: Date;
  };
}

const getNearestDeadlineHours = (dates: Array<{ type: string; date: Date }>, now: Date): number | null => {
  const futureDeadlines = dates
    .filter((d) => d && d.type === "deadline" && d.date && new Date(d.date).getTime() > now.getTime())
    .map((d) => (new Date(d.date).getTime() - now.getTime()) / (1000 * 60 * 60));

  if (futureDeadlines.length === 0) {
    return null;
  }

  return Math.min(...futureDeadlines);
};

export const getFocusBoard = async (params: {
  userId: string;
  accountId: string;
  limit: number;
}): Promise<{ items: FocusBoardItem[]; config: ILabelPriorityConfig }> => {
  const config = await ensureLabelPriorityConfig(params.userId, params.accountId);
  const activeLabels = await getActivePriorityLabels(params.userId, params.accountId);
  const activeIdSet = new Set(activeLabels.map((label) => (label._id as Types.ObjectId).toString()));
  const priorityList = (config.priorities || [])
    .filter((item) => activeIdSet.has(item.labelId.toString()))
    .sort((a, b) => a.rank - b.rank);

  const priorityById = new Map(priorityList.map((item) => [item.labelId.toString(), item.rank]));
  const priorityByName = new Map(
    priorityList.map((item) => [normalizeLabelName(item.labelNameSnapshot), item.rank])
  );

  if (priorityList.length === 0) {
    return { items: [], config };
  }

  const now = new Date();
  const accountObjectId = asObjectId(params.accountId);
  const insights = await InsightModel.find({
    userId: params.userId,
    accountId: accountObjectId,
    $or: [
      { "state.relevance": "active" },
      { state: null },
      { "state.relevance": { $exists: false } },
    ],
  })
    .lean()
    .exec();

  const scoredItems: FocusBoardItem[] = [];

  for (const insight of insights) {
    const labels = Array.isArray(insight.labels) ? insight.labels : [];
    let bestRank = Number.POSITIVE_INFINITY;
    const matchedLabels: string[] = [];

    for (const label of labels) {
      const byId = label?.labelId ? priorityById.get(label.labelId.toString()) : undefined;
      const normalizedName =
        typeof label?.name === "string" ? normalizeLabelName(label.name) : "";
      const byName = normalizedName ? priorityByName.get(normalizedName) : undefined;
      const rank = byId ?? byName;

      if (!rank) {
        continue;
      }
      matchedLabels.push(label.name);
      if (rank < bestRank) {
        bestRank = rank;
      }
    }

    if (!isFinite(bestRank)) {
      continue;
    }

    const totalActivePriorities = priorityList.length;
    const importanceNorm = clamp(
      typeof insight.importanceScore === "number" ? insight.importanceScore : 0.5,
      0,
      1
    );
    const labelNorm =
      1 - (bestRank - 1) / Math.max(totalActivePriorities - 1, 1);

    const recencyDate = insight.state?.lastSignalAt || insight.updatedAt || insight.createdAt || now;
    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(recencyDate).getTime()) / (1000 * 60 * 60)
    );
    const recencyNorm = Math.exp(-ageHours / RECENCY_DECAY_HOURS);

    const nearestDeadlineHours = getNearestDeadlineHours(
      Array.isArray(insight.dates) ? insight.dates : [],
      now
    );
    const deadlineBoost =
      nearestDeadlineHours !== null && nearestDeadlineHours <= DEADLINE_WINDOW_HOURS
        ? DEADLINE_BOOST
        : 0;

    const totalScore =
      0.6 * importanceNorm +
      0.2 * labelNorm +
      0.2 * recencyNorm +
      deadlineBoost;

    scoredItems.push({
      insightId: insight._id.toString(),
      gmailThreadId: insight.gmailThreadId,
      summary: {
        shortSnippet: insight.summary?.shortSnippet || "",
        intent: insight.summary?.intent || "information",
      },
      from: {
        email: insight.from?.email || "",
        name: insight.from?.name,
        domain: insight.from?.domain,
      },
      matchedLabels: Array.from(new Set(matchedLabels)),
      score: {
        totalScore,
        importanceNorm,
        labelNorm,
        recencyNorm,
        deadlineBoost,
        matchedLabelRank: bestRank,
      },
      timestamps: {
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
        lastSignalAt: insight.state?.lastSignalAt,
      },
    });
  }

  scoredItems.sort((a, b) => {
    if (b.score.totalScore !== a.score.totalScore) {
      return b.score.totalScore - a.score.totalScore;
    }
    const aTime =
      a.timestamps.lastSignalAt?.getTime() ||
      a.timestamps.updatedAt?.getTime() ||
      0;
    const bTime =
      b.timestamps.lastSignalAt?.getTime() ||
      b.timestamps.updatedAt?.getTime() ||
      0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return b.insightId.localeCompare(a.insightId);
  });

  return {
    items: scoredItems.slice(0, Math.max(1, params.limit)),
    config,
  };
};
