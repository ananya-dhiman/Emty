import { Types } from "mongoose";
import { ILabel, LabelModel } from "../model/Label";
import { InsightModel } from "../model/Insight";
import { EmailMessageModel } from "../model/EmailMessage";
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

const getNearestDeadlineHours = (dates: Array<{ type: string; date: Date }>, now: Date): number | null => {
  const futureDeadlines = dates
    .filter((d) => d && d.type === "deadline" && d.date && new Date(d.date).getTime() > now.getTime())
    .map((d) => (new Date(d.date).getTime() - now.getTime()) / (1000 * 60 * 60));

  if (futureDeadlines.length === 0) {
    return null;
  }

  return Math.min(...futureDeadlines);
};

interface PriorityScoringContext {
  totalActivePriorities: number;
  priorityById: Map<string, number>;
  priorityByName: Map<string, number>;
}

interface BaseScoreResult {
  baseScore: number;
  importanceNorm: number;
  labelNorm: number;
  matchedLabelRank: number;
  matchedLabels: string[];
}

export interface PriorityRankingScoreBreakdown {
  baseScore: number;
  dynamicScore: number;
  totalScore: number;
  importanceNorm: number;
  labelNorm: number;
  recencyNorm: number;
  deadlineBoost: number;
  matchedLabelRank: number;
}

export interface PriorityRankingItem {
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
  isActionRequired: boolean;
  score: PriorityRankingScoreBreakdown;
  timestamps: {
    createdAt?: Date;
    updatedAt?: Date;
    lastSignalAt?: Date;
  };
  dates?: Array<{
    type: "deadline" | "event" | "followup";
    date: Date;
    sourceEmailId?: string;
  }>;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    sourceEmailId?: string;
  }>;
  emailContextById?: Record<
    string,
    {
      subject?: string;
      from?: { email?: string; name?: string; domain?: string };
      internalDate?: Date;
    }
  >;
  checklistItems?: Array<{
    task: string;
    status: "pending";
    dueDate?: Date;
    reason?: string;
    inferred?: boolean;
    sourceEmailId?: string;
  }>;
  importantLinksByEmail?: Record<
    string,
    Array<{
      url: string;
      label?: string;
      reason?: string;
      inferred?: boolean;
    }>
  >;
  checklist?: string[];
}

const buildPriorityScoringContext = (
  priorityList: Array<{ labelId: Types.ObjectId; labelNameSnapshot: string; rank: number }>
): PriorityScoringContext => ({
  totalActivePriorities: priorityList.length,
  priorityById: new Map(priorityList.map((item) => [item.labelId.toString(), item.rank])),
  priorityByName: new Map(
    priorityList.map((item) => [normalizeLabelName(item.labelNameSnapshot), item.rank])
  ),
});

const findBestRank = (
  labels: Array<{ labelId?: Types.ObjectId; name?: string }>,
  context: PriorityScoringContext
): { bestRank: number; matchedLabels: string[] } => {
  const matchedLabels: string[] = [];
  let bestRank = Number.POSITIVE_INFINITY;

  for (const label of labels) {
    const byId = label?.labelId ? context.priorityById.get(label.labelId.toString()) : undefined;
    const normalizedName = typeof label?.name === "string" ? normalizeLabelName(label.name) : "";
    const byName = normalizedName ? context.priorityByName.get(normalizedName) : undefined;
    const rank = byId ?? byName;
    if (!rank) {
      continue;
    }
    if (label.name) {
      matchedLabels.push(label.name);
    }
    if (rank < bestRank) {
      bestRank = rank;
    }
  }

  if (!isFinite(bestRank)) {
    bestRank = context.totalActivePriorities + 1;
  }

  return { bestRank, matchedLabels: Array.from(new Set(matchedLabels)) };
};

export const computeBaseScore = (params: {
  importanceScore?: number;
  labels: Array<{ labelId?: Types.ObjectId; name?: string }>;
  context: PriorityScoringContext;
}): BaseScoreResult => {
  const importanceNorm = clamp(
    typeof params.importanceScore === "number" ? params.importanceScore : 0.5,
    0,
    1
  );
  const { bestRank, matchedLabels } = findBestRank(params.labels, params.context);
  const labelNormRaw =
    params.context.totalActivePriorities > 0
      ? 1 - (bestRank - 1) / Math.max(params.context.totalActivePriorities - 1, 1)
      : 0;
  const labelNorm = clamp(labelNormRaw, 0, 1);
  const baseScore = 0.6 * importanceNorm + 0.2 * labelNorm;

  return {
    baseScore,
    importanceNorm,
    labelNorm,
    matchedLabelRank: bestRank,
    matchedLabels,
  };
};

export const getPriorityScoringContext = async (params: {
  userId: string;
  accountId: string;
}): Promise<PriorityScoringContext> => {
  const config = await ensureLabelPriorityConfig(params.userId, params.accountId);
  const activeLabels = await getActivePriorityLabels(params.userId, params.accountId);
  const activeIdSet = new Set(activeLabels.map((label) => (label._id as Types.ObjectId).toString()));
  const priorityList = (config.priorities || [])
    .filter((item) => activeIdSet.has(item.labelId.toString()))
    .sort((a, b) => a.rank - b.rank);
  return buildPriorityScoringContext(priorityList);
};

const resolveEnvInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const flattenDatesFromEmails = (emails: any[]): Array<{
  type: "deadline" | "event" | "followup";
  date: Date;
  sourceEmailId?: string;
}> =>
  emails.flatMap((entry: any) =>
    (Array.isArray(entry?.dates) ? entry.dates : [])
      .map((d: any) => {
        const parsed = new Date(d?.date);
        if (!["deadline", "event", "followup"].includes(d?.type) || Number.isNaN(parsed.getTime())) {
          return null;
        }
        return {
          type: d.type,
          date: parsed,
          sourceEmailId: entry?.messageId,
        };
      })
      .filter(Boolean)
  ) as Array<{ type: "deadline" | "event" | "followup"; date: Date; sourceEmailId?: string }>;

const flattenAttachmentsFromEmails = (emails: any[]): Array<{
  filename: string;
  mimeType: string;
  size: number;
  sourceEmailId?: string;
}> =>
  emails.flatMap((entry: any) =>
    (Array.isArray(entry?.attachments) ? entry.attachments : [])
      .map((a: any) => {
        if (!a?.filename) return null;
        return {
          filename: a.filename,
          mimeType: a.mimeType || "application/octet-stream",
          size: typeof a.size === "number" ? a.size : 0,
          sourceEmailId: entry?.messageId,
        };
      })
      .filter(Boolean)
  ) as Array<{ filename: string; mimeType: string; size: number; sourceEmailId?: string }>;

const sortBySignal = <T extends { date?: Date; sourceEmailId?: string }>(
  arr: T[]
): T[] =>
  [...arr].sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return bTime - aTime;
  });

const sortAttachmentsBySourceDate = <T extends { sourceEmailId?: string }>(
  arr: T[],
  contextById: Record<string, { internalDate?: Date }>
): T[] =>
  [...arr].sort((a, b) => {
    const aTime = a.sourceEmailId
      ? new Date(contextById[a.sourceEmailId]?.internalDate || 0).getTime()
      : 0;
    const bTime = b.sourceEmailId
      ? new Date(contextById[b.sourceEmailId]?.internalDate || 0).getTime()
      : 0;
    return bTime - aTime;
  });

export const getPriorityRanking = async (params: {
  userId: string;
  accountId: string;
}): Promise<{
  actionRequired: PriorityRankingItem[];
  topPriority: PriorityRankingItem[];
  others: PriorityRankingItem[];
  config: ILabelPriorityConfig;
}> => {
  const config = await ensureLabelPriorityConfig(params.userId, params.accountId);
  const activeLabels = await getActivePriorityLabels(params.userId, params.accountId);
  const activeIdSet = new Set(activeLabels.map((label) => (label._id as Types.ObjectId).toString()));
  const priorityList = (config.priorities || [])
    .filter((item) => activeIdSet.has(item.labelId.toString()))
    .sort((a, b) => a.rank - b.rank);
  const context = buildPriorityScoringContext(priorityList);

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
    .select(
      "gmailThreadId summary from labels importanceScore baseScore baseScoreBreakdown state createdAt updatedAt dates attachments checklist emails"
    )
    .lean()
    .exec();

  const scoredItems: PriorityRankingItem[] = [];

  for (const insight of insights) {
    const labels = (Array.isArray(insight.labels) ? insight.labels : []) as Array<{
      labelId?: Types.ObjectId;
      name?: string;
    }>;
    const storedBaseScore = typeof (insight as any).baseScore === "number" ? (insight as any).baseScore : null;
    const storedImportanceNorm =
      typeof (insight as any)?.baseScoreBreakdown?.importanceNorm === "number"
        ? (insight as any).baseScoreBreakdown.importanceNorm
        : null;
    const storedLabelNorm =
      typeof (insight as any)?.baseScoreBreakdown?.labelNorm === "number"
        ? (insight as any).baseScoreBreakdown.labelNorm
        : null;
    const storedMatchedRank =
      typeof (insight as any)?.baseScoreBreakdown?.matchedLabelRank === "number"
        ? (insight as any).baseScoreBreakdown.matchedLabelRank
        : null;

    const computedBase = computeBaseScore({
      importanceScore:
        typeof insight.importanceScore === "number" ? insight.importanceScore : undefined,
      labels,
      context,
    });
    const baseScore = storedBaseScore ?? computedBase.baseScore;
    const importanceNorm = storedImportanceNorm ?? computedBase.importanceNorm;
    const labelNorm = storedLabelNorm ?? computedBase.labelNorm;
    const matchedLabelRank = storedMatchedRank ?? computedBase.matchedLabelRank;
    const matchedLabels = computedBase.matchedLabels;

    const recencyDate = insight.state?.lastSignalAt || insight.updatedAt || insight.createdAt || now;
    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(recencyDate).getTime()) / (1000 * 60 * 60)
    );
    const recencyNorm = Math.exp(-ageHours / RECENCY_DECAY_HOURS);

    const embeddedEmails = Array.isArray((insight as any).emails) ? (insight as any).emails : [];
    const derivedChecklist = Array.isArray((insight as any).checklist)
      ? (insight as any).checklist
      : embeddedEmails.flatMap((entry: any) =>
          (Array.isArray(entry?.checklist) ? entry.checklist : []).map((item: any) => ({
            ...item,
            sourceEmailId: entry?.messageId,
          }))
        );
    const derivedDates = embeddedEmails.length > 0
      ? flattenDatesFromEmails(embeddedEmails)
      : (Array.isArray(insight.dates) ? insight.dates : []);
    const derivedAttachments = embeddedEmails.length > 0
      ? flattenAttachmentsFromEmails(embeddedEmails)
      : (Array.isArray(insight.attachments) ? insight.attachments : []);
    const nearestDeadlineHours = getNearestDeadlineHours(derivedDates as any, now);
    const deadlineBoost =
      nearestDeadlineHours !== null && nearestDeadlineHours <= DEADLINE_WINDOW_HOURS
        ? DEADLINE_BOOST
        : 0;
    const dynamicScore = 0.2 * recencyNorm + deadlineBoost;
    const totalScore = baseScore + dynamicScore;

    const emailContextById: Record<string, { subject?: string; from?: { email?: string; name?: string; domain?: string }; internalDate?: Date }> = {};
    for (const email of embeddedEmails) {
      if (!email?.messageId) continue;
      emailContextById[email.messageId] = {
        subject: email.subject,
        from: email.from
          ? {
              email: email.from.email,
              name: email.from.name,
              domain: email.from.domain,
            }
          : undefined,
        internalDate: email.internalDate ? new Date(email.internalDate) : undefined,
      };
    }

    const missingSourceIds = Array.from(
      new Set(
        [
          ...((Array.isArray(derivedDates) ? derivedDates : []).map((d: any) => d?.sourceEmailId)),
          ...((Array.isArray(derivedAttachments) ? derivedAttachments : []).map((a: any) => a?.sourceEmailId)),
        ]
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .filter((id) => !emailContextById[id])
      )
    );

    if (missingSourceIds.length > 0) {
      const fallbackEmails = await EmailMessageModel.find({
        accountId: accountObjectId,
        messageId: { $in: missingSourceIds },
      })
        .select("messageId from subject internalDate")
        .lean()
        .exec();

      for (const fallbackEmail of fallbackEmails) {
        const rawFrom = typeof fallbackEmail.from === "string" ? fallbackEmail.from : "";
        const emailMatch = rawFrom.match(/<(.+?)>/);
        const parsedEmail = emailMatch ? emailMatch[1] : rawFrom;
        const parsedName = emailMatch
          ? rawFrom.substring(0, rawFrom.indexOf("<")).trim().replace(/^["']|["']$/g, "")
          : undefined;
        const parsedDomain = parsedEmail.includes("@") ? parsedEmail.split("@")[1] : undefined;

        emailContextById[fallbackEmail.messageId] = {
          subject: fallbackEmail.subject || undefined,
          from: parsedEmail
            ? {
                email: parsedEmail,
                name: parsedName || undefined,
                domain: parsedDomain || undefined,
              }
            : undefined,
          internalDate: fallbackEmail.internalDate ? new Date(fallbackEmail.internalDate) : undefined,
        };
      }
    }

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
      matchedLabels,
      isActionRequired: insight.summary?.intent === "action_required",
      score: {
        baseScore,
        dynamicScore,
        totalScore,
        importanceNorm,
        labelNorm,
        recencyNorm,
        deadlineBoost,
        matchedLabelRank,
      },
      timestamps: {
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
        lastSignalAt: insight.state?.lastSignalAt,
      },
      dates: sortBySignal(
        Array.isArray(derivedDates)
          ? derivedDates.map((d: any) => ({
              type: d.type,
              date: d.date,
              sourceEmailId: d.sourceEmailId,
            }))
          : []
      ),
      attachments: sortAttachmentsBySourceDate(
        Array.isArray(derivedAttachments)
          ? derivedAttachments.map((a: any) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              sourceEmailId: a.sourceEmailId,
            }))
          : [],
        emailContextById
      ),
      emailContextById,
      checklistItems: Array.isArray(derivedChecklist)
        ? (derivedChecklist as any[])
            .map((item: any) => {
              const task = typeof item?.task === "string" ? item.task.trim() : "";
              if (!task) return null;
              const parsedDueDate = item?.dueDate ? new Date(item.dueDate) : undefined;
              return {
                task,
                status: "pending" as const,
                dueDate: parsedDueDate && !Number.isNaN(parsedDueDate.getTime()) ? parsedDueDate : undefined,
                reason: typeof item?.reason === "string" ? item.reason : undefined,
                inferred: item?.inferred === true,
                sourceEmailId: typeof item?.sourceEmailId === "string" ? item.sourceEmailId : undefined,
              };
            })
            .filter(Boolean) as Array<{
            task: string;
            status: "pending";
            dueDate?: Date;
            reason?: string;
            inferred?: boolean;
            sourceEmailId?: string;
          }>
        : [],
      importantLinksByEmail: embeddedEmails.reduce((acc: Record<string, Array<{ url: string; label?: string; reason?: string; inferred?: boolean }>>, entry: any) => {
        const messageId = typeof entry?.messageId === "string" ? entry.messageId : "";
        if (!messageId) return acc;
        const deduped = new Map<string, { url: string; label?: string; reason?: string; inferred?: boolean }>();
        const links = Array.isArray(entry?.importantLinks) ? entry.importantLinks : [];
        for (const link of links) {
          const url = typeof link?.url === "string" ? link.url.trim() : "";
          if (!url || deduped.has(url)) continue;
          deduped.set(url, {
            url,
            label: typeof link?.label === "string" ? link.label : undefined,
            reason: typeof link?.reason === "string" ? link.reason : undefined,
            inferred: link?.inferred === true,
          });
        }
        acc[messageId] = Array.from(deduped.values());
        return acc;
      }, {}),
      checklist: Array.isArray(derivedChecklist)
        ? (derivedChecklist as any[])
            .map((item: any) => (typeof item === "string" ? item : item?.task))
            .filter((task: any): task is string => typeof task === "string" && task.trim().length > 0)
        : [],
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

  const actionRequiredCount = resolveEnvInt(process.env.PRIORITY_ACTION_REQUIRED_COUNT, 5);
  const topPriorityCount = resolveEnvInt(process.env.PRIORITY_TOP_COUNT, 5);
  const actionRequired = scoredItems.filter((item) => item.isActionRequired).slice(0, actionRequiredCount);
  const actionRequiredSet = new Set(actionRequired.map((item) => item.insightId));
  const remaining = scoredItems.filter((item) => !actionRequiredSet.has(item.insightId));
  const topPriority = remaining.slice(0, topPriorityCount);
  const topPrioritySet = new Set(topPriority.map((item) => item.insightId));
  const others = remaining.filter((item) => !topPrioritySet.has(item.insightId));

  return {
    actionRequired,
    topPriority,
    others,
    config,
  };
};
