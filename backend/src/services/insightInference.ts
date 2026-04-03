export interface InferredImportantLink {
  url: string;
  label?: string;
  reason?: string;
  inferred?: boolean;
}

export interface InferredChecklistItem {
  task: string;
  status: "pending";
  dueDate?: string;
  reason?: string;
  inferred?: boolean;
}

const MAX_LINKS = 12;
const MAX_TASKS = 8;

const normalizeUrl = (raw: string): string | null => {
  const trimmed = (raw || "").trim().replace(/[),.;!?]+$/, "");
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const findNearestDeadline = (
  dates: Array<{ type?: string; date?: string }>
): string | undefined => {
  const now = Date.now();
  const deadlines = dates
    .filter((d) => d?.type === "deadline" && d?.date)
    .map((d) => new Date(d.date as string))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() >= now)
    .sort((a, b) => a.getTime() - b.getTime());

  return deadlines.length > 0 ? deadlines[0].toISOString() : undefined;
};

const ACTION_PATTERNS: RegExp[] = [
  /\b(action required|please|kindly|must|need to|required)\b/i,
  /\b(reply|respond|confirm|approve|review|submit|complete|fill|sign|pay|upload|schedule|book|attend|send|update)\b/i,
  /\bby\s+\w+\s+\d{1,2}\b/i,
];

const looksActionable = (text: string): boolean =>
  ACTION_PATTERNS.some((pattern) => pattern.test(text));

const normalizeTask = (line: string): string => {
  let task = line.trim();
  task = task.replace(/^[\-\*\u2022\d\.\)\(]+\s*/, "");
  task = task.replace(/\s+/g, " ").trim();
  if (task.length > 180) {
    task = `${task.slice(0, 177).trim()}...`;
  }
  return task;
};

export const inferActionIntelligence = (params: {
  body: string;
  intent?: string;
  dates?: Array<{ type?: string; date?: string }>;
}): { importantLinks: InferredImportantLink[]; checklist: InferredChecklistItem[] } => {
  const body = params.body || "";

  const linkMatches = [
    ...body.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi),
    ...body.matchAll(/\bwww\.[^\s<>"')\]]+/gi),
  ];
  const linkMap = new Map<string, InferredImportantLink>();
  for (const match of linkMatches) {
    const normalized = normalizeUrl(match[0]);
    if (!normalized) continue;
    if (!linkMap.has(normalized)) {
      linkMap.set(normalized, {
        url: normalized,
        reason: "Detected in email body",
        inferred: true,
      });
    }
    if (linkMap.size >= MAX_LINKS) break;
  }

  const shouldInferChecklist = params.intent === "action_required";
  const checklist: InferredChecklistItem[] = [];
  if (shouldInferChecklist) {
    const dueDate = findNearestDeadline(params.dates || []);
    const parts = body
      .split(/\r?\n|[.!?]\s+/)
      .map((line) => normalizeTask(line))
      .filter((line) => line.length >= 12 && line.length <= 180);

    const seen = new Set<string>();
    for (const part of parts) {
      if (!looksActionable(part)) continue;
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      checklist.push({
        task: part,
        status: "pending",
        dueDate,
        reason: "Inferred from action language",
        inferred: true,
      });
      if (checklist.length >= MAX_TASKS) break;
    }
  }

  return {
    importantLinks: Array.from(linkMap.values()),
    checklist,
  };
};
