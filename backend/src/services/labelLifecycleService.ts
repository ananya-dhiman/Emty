import { ILabel, Label } from "../model/Label";
import { Types } from "mongoose";
import { canonicalizeLabelName } from "../utils/labelNormalization";
import { generateEmbedding } from "./embeddingService";
import * as labelVectorRepository from "../db/repositories/labelVectorRepository";

export const AI_LABEL_SUGGESTION_MIN_MATCHES = Number(
  process.env.AI_LABEL_SUGGESTION_MIN_MATCHES || 5
);

export const SYSTEM_LABEL_DEFINITIONS = [
  {
    name: "Needs Action",
    description: "Emails that require a response, deadline, or task",
    source: "system" as const,
    status: "active" as const,
  },
  {
    name: "Finance",
    description: "Bills, transactions, payments",
    source: "system" as const,
    status: "active" as const,
  },
];

export interface LabelCandidate {
  _id?: Types.ObjectId;
  name: string;
  nameNormalized: string;
  description?: string;
  source: "system" | "ai" | "user";
  status: "active" | "suggested" | "rejected";
  suggestionCount?: number;
}

export interface NormalizedAIClassification {
  assignedLabels: LabelCandidate[];
  suggestedLabelName?: string;
}

export const normalizeLabelName = canonicalizeLabelName;

const toCandidate = (label: ILabel): LabelCandidate => ({
  _id: label._id as Types.ObjectId,
  name: label.name,
  nameNormalized: label.nameNormalized,
  description: label.description || "",
  source: label.source,
  status: label.status,
  suggestionCount: label.suggestionCount || 0,
});

export const generateAndStoreLabelVector = async (
  labelId: string,
  labelName: string,
  description: string
): Promise<void> => {
  try {
    const textToEmbed = `${labelName} ${description}`.trim();
    const embedding = await generateEmbedding(textToEmbed);
    labelVectorRepository.upsert(
      labelId,
      JSON.stringify(embedding),
      labelName,
      'nomic-embed-text'
    );
  } catch (error) {
    // We log and swallow the error to not block label creation
    console.error(`Failed to generate/store label vector for ${labelName}:`, error);
  }
};

export const ensureSystemLabels = async (
  userId: string,
  accountId: string
): Promise<void> => {
  await Promise.all(
    SYSTEM_LABEL_DEFINITIONS.map(async (label) => {
      const result = await Label.upsert({
        where: {
          userId_accountId_nameNormalized: {
            userId,
            accountId,
            nameNormalized: normalizeLabelName(label.name),
          },
        },
        create: {
          userId,
          accountId,
          name: label.name,
          nameNormalized: normalizeLabelName(label.name),
          description: label.description,
          source: label.source,
          status: "active",
        },
        update: {
          description: label.description,
          source: label.source,
          status: "active",
        },
      });
      if (result && result._id) {
        await generateAndStoreLabelVector(
          (result._id as Types.ObjectId).toString(),
          result.name,
          result.description || ""
        );
      }
    })
  );
};

export const getAssignableLabels = async (
  userId: string,
  accountId: string
): Promise<LabelCandidate[]> => {
  await ensureSystemLabels(userId, accountId);
  const labels = await Label.findMany({
    where: {
      userId,
      accountId,
      status: "active",
      source: { in: ["system", "user"] },
    },
  });

  return labels.map(toCandidate);
};

export const getVisibleLabels = async (
  userId: string,
  accountId: string,
  status?: "active" | "suggested" | "rejected"
): Promise<ILabel[]> => {
  await ensureSystemLabels(userId, accountId);

  if (status) {
    if (status === "suggested") {
      return Label.findMany({
        where: {
          userId,
          accountId,
          status,
          source: "ai",
          suggestionCount: { gte: AI_LABEL_SUGGESTION_MIN_MATCHES },
        },
        orderBy: [{ suggestionCount: "desc" }, { updatedAt: "desc" }],
      });
    }

    return Label.findMany({
      where: { userId, accountId, status },
      orderBy: [{ source: "asc" }, { name: "asc" }],
    });
  }

  return Label.findMany({
    where: {
      userId,
      accountId,
      OR: [
        { status: "active" },
        {
          status: "suggested",
          source: "ai",
          suggestionCount: { gte: AI_LABEL_SUGGESTION_MIN_MATCHES },
        },
      ],
    },
    orderBy: [{ status: "asc" }, { source: "asc" }, { name: "asc" }],
  });
};

export const normalizeAIClassification = (
  aiLabels: string[],
  suggestedLabel: string | undefined,
  assignableLabels: LabelCandidate[]
): NormalizedAIClassification => {
  const labelMap = new Map<string, LabelCandidate>();
  for (const label of assignableLabels) {
    const canonicalKey = normalizeLabelName(label.nameNormalized || label.name);
    if (!canonicalKey || labelMap.has(canonicalKey)) {
      continue;
    }
    labelMap.set(canonicalKey, label);
  }
  const assignedLabels: LabelCandidate[] = [];
  const seenAssigned = new Set<string>();
  const unmatched: string[] = [];

  for (const rawLabel of aiLabels || []) {
    if (!rawLabel || typeof rawLabel !== "string") {
      continue;
    }

    const normalized = normalizeLabelName(rawLabel);
    if (!normalized) {
      continue;
    }

    const matched = labelMap.get(normalized);
    if (matched) {
      const matchedKey = normalizeLabelName(
        matched.nameNormalized || matched.name
      );
      if (!seenAssigned.has(matchedKey)) {
        assignedLabels.push(matched);
        seenAssigned.add(matchedKey);
      }
      continue;
    }

    unmatched.push(rawLabel.trim());
  }

  const normalizedSuggested = suggestedLabel
    ? suggestedLabel.trim().replace(/\s+/g, " ")
    : "";
  const normalizedSuggestedKey = normalizedSuggested
    ? normalizeLabelName(normalizedSuggested)
    : "";

  if (normalizedSuggestedKey) {
    const matchedSuggested = labelMap.get(normalizedSuggestedKey);
    if (
      matchedSuggested &&
      !seenAssigned.has(
        normalizeLabelName(
          matchedSuggested.nameNormalized || matchedSuggested.name
        )
      )
    ) {
      const suggestedMatchedKey = normalizeLabelName(
        matchedSuggested.nameNormalized || matchedSuggested.name
      );
      assignedLabels.push(matchedSuggested);
      seenAssigned.add(suggestedMatchedKey);
    }
  }

  const fallbackSuggestion = unmatched.find(
    (label) => !labelMap.has(normalizeLabelName(label))
  );

  const chosenSuggestion = labelMap.has(normalizedSuggestedKey)
    ? ""
    : normalizedSuggested || fallbackSuggestion;

  return {
    assignedLabels,
    suggestedLabelName: chosenSuggestion || undefined,
  };
};

export const recordSuggestedLabel = async (params: {
  userId: string;
  accountId: string;
  suggestionName?: string;
  threadId?: string;
}): Promise<ILabel | null> => {
  const rawName = params.suggestionName?.trim().replace(/\s+/g, " ");
  if (!rawName) {
    return null;
  }

  const nameNormalized = normalizeLabelName(rawName);
  if (!nameNormalized) {
    return null;
  }

  const existing = await Label.findUnique({
    where: {
      userId_accountId_nameNormalized: {
        userId: params.userId,
        accountId: params.accountId,
        nameNormalized,
      },
    },
  });

  if (existing?.status === "rejected") {
    return existing;
  }

  if (existing?.status === "active" && existing.source !== "ai") {
    return existing;
  }

  if (
    existing &&
    params.threadId &&
    Array.isArray(existing.sampleThreadIds) &&
    existing.sampleThreadIds.includes(params.threadId)
  ) {
    return existing;
  }

  const baseData = {
    userId: params.userId,
    accountId: params.accountId,
    name: rawName,
    nameNormalized,
    description: "",
    source: "ai" as const,
    status: "suggested" as const,
    lastSuggestedAt: new Date(),
    sampleThreadIds: params.threadId ? [params.threadId] : [],
  };

  const result = await Label.upsert({
    where: {
      userId_accountId_nameNormalized: {
        userId: params.userId,
        accountId: params.accountId,
        nameNormalized,
      },
    },
    create: {
      ...baseData,
      suggestionCount: 1,
    },
    update: {
      ...baseData,
      suggestionCount: { increment: 1 },
      ...(params.threadId && {
        sampleThreadIds: {
          push: params.threadId,
        },
      }),
    },
  });

  if (result && result._id && ((result.suggestionCount || 0) >= AI_LABEL_SUGGESTION_MIN_MATCHES)) {
    await generateAndStoreLabelVector(
      (result._id as Types.ObjectId).toString(),
      result.name,
      result.description || ""
    );
  }

  return result;
};
