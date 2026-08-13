import { Types } from "mongoose";
import { ILabel, Label } from "../model/Label";
import * as insightRepository from "../db/repositories/insightRepository";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import {
  ILabelPriorityConfig,
  LabelPriorityConfig,
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
  return Label.findMany({
    where: {
      userId,
      accountId,
      status: "active",
      source: { in: ["system", "user"] },
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
};

const getObservedCounts = async (
  userId: string,
  accountId: string,
  onlyRecent: boolean
): Promise<Map<string, number>> => {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const allInsights = insightRepository.getByIntent(accountId, userId);
  const insights = onlyRecent
    ? allInsights.filter(i => i.updated_at ? i.updated_at >= cutoff : false)
    : allInsights;

  const counts = new Map<string, number>();

  for (const insight of insights) {
    let labels: any[] = [];
    try { labels = JSON.parse(insight.labels || '[]'); } catch (e) {}
    const seenPerInsight = new Set<string>();

    for (const label of labels) {
      const labelId = label?.labelId ? String(label.labelId) : "";
      const nameKey = typeof label?.name === "string"
        ? `name:${normalizeLabelName(label.name)}`
        : "";
      const key = labelId ? `id:${labelId}` : nameKey;
      if (!key || seenPerInsight.has(key)) continue;
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
  const priorities = await buildDefaultPriorities(userId, accountId, activeLabels);
  const now = new Date();
  const config = await LabelPriorityConfig.upsert({
    where: { userId_accountId: { userId, accountId } },
    create: {
      userId,
      accountId,
      priorities,
      isReviewedByUser: false,
      initializedAt: now,
      lastComputedAt: now,
    },
    update: {
      priorities,
      lastComputedAt: now,
    },
  });

  if (!config) {
    throw new Error("Failed to initialize label priority config");
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

  const label = await Label.findUnique({ where: { id: labelId.toString() } });
  if (!label || label.status !== "active" || !["system", "user"].includes(label.source)) {
    return;
  }

  config.priorities.push({
    labelId: label.id as any,
    labelNameSnapshot: label.name,
    rank: config.priorities.length + 1,
  });
  config.lastComputedAt = new Date();
  await LabelPriorityConfig.update({
    where: { userId_accountId: { userId: config.userId, accountId: config.accountId } },
    data: {
      priorities: config.priorities,
      lastComputedAt: config.lastComputedAt,
    },
  });
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
  isCompleted: boolean;
  isTracked: boolean;
  trackingNote: string | null;
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

export interface LowPriorityEmailItem {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate: Date;
  score: number;
  extractedFeatures: string[];
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
  completed: PriorityRankingItem[];
  lowPriorityEmails: LowPriorityEmailItem[];
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
  // Fetch insights for account from local SQLite, filter active/null state_relevance in JS
  const insights = insightRepository.findAllByAccountId(accountObjectId.toString()).filter((row) => {
    return !row.state_relevance || row.state_relevance === 'active';
  });

  const scoredItems: PriorityRankingItem[] = [];

  for (const rawInsight of insights) {
    // Parse JSON fields from the SQLite row
    const insight = {
      _id: { toString: () => rawInsight.id },
      gmailThreadId: rawInsight.gmail_thread_id,
      summary: (() => { try { return JSON.parse(rawInsight.summary_snippet || '{}'); } catch { return { shortSnippet: rawInsight.summary_snippet, intent: rawInsight.summary_intent }; } })(),
      from: (() => { try { return JSON.parse(rawInsight.from_email || '{}'); } catch { return { email: rawInsight.from_email, name: rawInsight.from_name, domain: rawInsight.from_domain }; } })(),
      labels: (() => { try { return JSON.parse(rawInsight.labels || '[]'); } catch { return []; } })(),
      importanceScore: rawInsight.importance_score,
      baseScore: rawInsight.base_score,
      baseScoreBreakdown: (() => { try { return JSON.parse(rawInsight.base_score_breakdown || 'null'); } catch { return null; } })(),
      state: { lastSignalAt: rawInsight.state_last_signal_at ? new Date(rawInsight.state_last_signal_at) : null },
      createdAt: rawInsight.created_at ? new Date(rawInsight.created_at) : null,
      updatedAt: rawInsight.updated_at ? new Date(rawInsight.updated_at) : null,
      dates: (() => { try { return JSON.parse(rawInsight.dates || '[]'); } catch { return []; } })(),
      attachments: (() => { try { return JSON.parse(rawInsight.attachments || '[]'); } catch { return []; } })(),
      checklist: (() => { try { return JSON.parse(rawInsight.checklist || '[]'); } catch { return []; } })(),
      emails: (() => { try { return JSON.parse(rawInsight.emails || '[]'); } catch { return []; } })(),
      isCompleted: rawInsight.is_completed === 1,
      isTracked: rawInsight.is_tracked === 1,
      trackingNote: rawInsight.tracking_note ?? null,
    };
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

    const embeddedEmails = Array.isArray((insight as any).emails) ? (insight as any).emails : [];
    
    let actualEmailDate = null;
    for (const email of embeddedEmails) {
      if (email.internalDate) {
        const time = new Date(email.internalDate).getTime();
        if (!actualEmailDate || time > actualEmailDate) {
          actualEmailDate = time;
        }
      }
    }

    const recencyDate = actualEmailDate 
      ? new Date(actualEmailDate) 
      : (insight.state?.lastSignalAt || insight.updatedAt || insight.createdAt || now);

    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(recencyDate).getTime()) / (1000 * 60 * 60)
    );
    const recencyNorm = Math.exp(-ageHours / RECENCY_DECAY_HOURS);
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
      const allAccountEmails = emailMessageRepository.findByAccountId(accountObjectId.toString());
      const fallbackEmails = allAccountEmails.filter(
        e => missingSourceIds.includes(e.message_id)
      );

      for (const fallbackEmail of fallbackEmails) {
        const rawFrom = fallbackEmail.from || "";
        const emailMatch = rawFrom.match(/<(.+?)>/);
        const parsedEmail = emailMatch ? emailMatch[1] : rawFrom;
        const parsedName = emailMatch
          ? rawFrom.substring(0, rawFrom.indexOf("<")).trim().replace(/^["']|["']$/g, "")
          : undefined;
        const parsedDomain = parsedEmail.includes("@") ? parsedEmail.split("@")[1] : undefined;

        emailContextById[fallbackEmail.message_id] = {
          subject: fallbackEmail.subject || undefined,
          from: parsedEmail
            ? {
                email: parsedEmail,
                name: parsedName || undefined,
                domain: parsedDomain || undefined,
              }
            : undefined,
          internalDate: fallbackEmail.internal_date ? new Date(fallbackEmail.internal_date) : undefined,
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
      isCompleted: insight.isCompleted,
      isTracked: insight.isTracked,
      trackingNote: insight.trackingNote,
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
        createdAt: insight.createdAt ?? undefined,
        updatedAt: insight.updatedAt ?? undefined,
        lastSignalAt: insight.state?.lastSignalAt ?? undefined,
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

  // Sort active items by score/recency; completed items are sorted by when they were completed (recency)
  const scoreSort = (a: PriorityRankingItem, b: PriorityRankingItem) => {
    if (b.score.totalScore !== a.score.totalScore) {
      return b.score.totalScore - a.score.totalScore;
    }
    const getActualTime = (item: PriorityRankingItem) => {
      if (item.emailContextById) {
        let maxTime = 0;
        for (const ctx of Object.values(item.emailContextById)) {
          if (ctx.internalDate) {
            const time = new Date(ctx.internalDate).getTime();
            if (time > maxTime) maxTime = time;
          }
        }
        if (maxTime > 0) return maxTime;
      }
      return item.timestamps.lastSignalAt?.getTime() || item.timestamps.updatedAt?.getTime() || 0;
    };
    const aTime = getActualTime(a);
    const bTime = getActualTime(b);
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return b.insightId.localeCompare(a.insightId);
  };

  // Split completed items out first — they never appear in active boards
  const completedItems = scoredItems.filter((item) => item.isCompleted);
  const activeItems = scoredItems.filter((item) => !item.isCompleted);

  activeItems.sort(scoreSort);
  completedItems.sort(scoreSort);

  const topPriorityCount = resolveEnvInt(process.env.PRIORITY_TOP_COUNT, 10);
  const actionRequired = activeItems.filter((item) => item.isActionRequired);
  const actionRequiredSet = new Set(actionRequired.map((item) => item.insightId));
  const remaining = activeItems.filter((item) => !actionRequiredSet.has(item.insightId));
  const topPriority = remaining.slice(0, topPriorityCount);
  const topPrioritySet = new Set(topPriority.map((item) => item.insightId));
  const others = remaining.filter((item) => !topPrioritySet.has(item.insightId));
  const lowPriorityRows = emailMessageRepository.findByAccountId(accountObjectId.toString()).filter(
    email =>
      email.user_id === params.userId &&
      email.score !== null &&
      email.score < 0.4 &&
      email.ai_processed === 0
  ).sort((a, b) => b.internal_date - a.internal_date);

  return {
    actionRequired,
    topPriority,
    others,
    completed: completedItems,
    lowPriorityEmails: lowPriorityRows.map((email) => ({
      messageId: email.message_id,
      threadId: email.thread_id,
      from: email.from,
      subject: email.subject,
      internalDate: new Date(email.internal_date),
      score: email.score ?? 0,
      extractedFeatures: (() => {
        try { return JSON.parse(email.extracted_features || '[]'); } catch { return []; }
      })(),
    })),
    config,
  };
};
