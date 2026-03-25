import { createHash } from "node:crypto";

import type { LLMMessage } from "./types.js";
import type {
  ArtifactCompactionState,
  ContextArtifactKind,
  ContextArtifactRecord,
  ContextArtifactRef,
} from "../memory/artifact-store.js";

const DEFAULT_KEEP_TAIL_COUNT = 5;
const DEFAULT_MAX_ARTIFACTS = 8;
const MAX_ARTIFACT_SUMMARY_CHARS = 120;
const MAX_OPEN_LOOP_CHARS = 120;
const FILE_PATH_RE =
  /(?:^|[\s`'"])((?:\/|\.\/|\.\.\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.[A-Za-z0-9_-]{1,12})(?=$|[\s`'"),.;:])/g;
const OPEN_LOOP_RE =
  /\b(?:todo|next step|remaining|follow[- ]?up|blocked|fix|verify|investigate|unresolved|need to)\b/i;
const TEST_SIGNAL_RE =
  /\b(?:test|vitest|jest|pytest|failing|passed|assert|coverage)\b/i;
const PLAN_SIGNAL_RE =
  /\b(?:plan|todo|roadmap|design|architecture|milestone|workstream)\b/i;
const REVIEW_SIGNAL_RE =
  /\b(?:review|finding|risk|security|regression|critique|audit)\b/i;
const DECISION_SIGNAL_RE =
  /\b(?:decision|decided|root cause|resolved|fix(ed)?|mitigation)\b/i;

export interface ArtifactCompactionInput {
  readonly sessionId: string;
  readonly history: readonly LLMMessage[];
  readonly keepTailCount?: number;
  readonly maxArtifacts?: number;
  readonly existingState?: ArtifactCompactionState;
  readonly source: "session_compaction" | "executor_compaction";
  readonly narrativeSummary?: string;
}

export interface ArtifactCompactionOutput {
  readonly compactedHistory: readonly LLMMessage[];
  readonly state: ArtifactCompactionState;
  readonly records: readonly ContextArtifactRecord[];
  readonly summaryText: string;
}

function extractText(message: LLMMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function inferKind(message: LLMMessage, content: string): ContextArtifactKind {
  const lowerToolName = message.toolName?.toLowerCase();
  if (lowerToolName?.includes("write") || lowerToolName?.includes("append")) {
    return "file_change";
  }
  if (lowerToolName?.includes("read") || lowerToolName?.includes("list")) {
    return "repo_snapshot";
  }
  if (lowerToolName?.includes("bash") && TEST_SIGNAL_RE.test(content)) {
    return "test_result";
  }
  if (message.role === "tool" && TEST_SIGNAL_RE.test(content)) {
    return "test_result";
  }
  if (PLAN_SIGNAL_RE.test(content)) {
    return "plan";
  }
  if (REVIEW_SIGNAL_RE.test(content)) {
    return "review";
  }
  if (DECISION_SIGNAL_RE.test(content)) {
    return "decision";
  }
  if (message.role === "user") {
    return "task_brief";
  }
  if (message.role === "tool") {
    return "tool_result";
  }
  return "conversation_chunk";
}

function extractTags(content: string, kind: ContextArtifactKind): readonly string[] {
  const tags = new Set<string>([kind]);
  let match: RegExpExecArray | null;
  FILE_PATH_RE.lastIndex = 0;
  while ((match = FILE_PATH_RE.exec(content)) !== null) {
    tags.add(match[1]!.replace(/^[./]+/, ""));
    if (tags.size >= 6) break;
  }
  if (TEST_SIGNAL_RE.test(content)) tags.add("test");
  if (PLAN_SIGNAL_RE.test(content)) tags.add("plan");
  if (REVIEW_SIGNAL_RE.test(content)) tags.add("review");
  if (OPEN_LOOP_RE.test(content)) tags.add("open_loop");
  return [...tags];
}

function extractTitle(message: LLMMessage, content: string, kind: ContextArtifactKind): string {
  const pathMatch = content.match(FILE_PATH_RE);
  if (pathMatch && pathMatch[0]) {
    return pathMatch[0].trim().replace(/^[`'"\s]+|[`'"\s]+$/g, "");
  }
  switch (kind) {
    case "task_brief":
      return "Task brief";
    case "plan":
      return "Planning context";
    case "review":
      return "Review context";
    case "decision":
      return "Decision context";
    case "repo_snapshot":
      return "Workspace snapshot";
    case "test_result":
      return "Test result";
    case "file_change":
      return "File mutation";
    case "tool_result":
      return message.toolName ? `Tool: ${message.toolName}` : "Tool result";
    default:
      return message.role === "assistant"
        ? "Assistant context"
        : message.role === "user"
        ? "User context"
        : "Conversation context";
  }
}

function scoreArtifact(
  message: LLMMessage,
  content: string,
  kind: ContextArtifactKind,
  index: number,
): number {
  let score = 0;
  if (message.role === "tool") score += 4;
  if (message.role === "assistant") score += 2;
  if (message.role === "user") score += 3;
  if (kind === "file_change") score += 4;
  if (kind === "test_result") score += 5;
  if (kind === "plan") score += 4;
  if (kind === "review") score += 4;
  if (kind === "decision") score += 3;
  if (FILE_PATH_RE.test(content)) score += 2;
  if (OPEN_LOOP_RE.test(content)) score += 2;
  score += Math.min(4, Math.floor(content.length / 400));
  score += index / 100;
  FILE_PATH_RE.lastIndex = 0;
  return score;
}

function buildArtifactRecord(params: {
  sessionId: string;
  message: LLMMessage;
  content: string;
  source: "session_compaction" | "executor_compaction";
  createdAt: number;
  index: number;
}): ContextArtifactRecord {
  const kind = inferKind(params.message, params.content);
  const normalizedContent = params.content.replace(/\s+/g, " ").trim();
  const digest = sha256Hex(`${params.message.role}:${params.message.toolName ?? ""}:${normalizedContent}`);
  return {
    id: `artifact:${digest.slice(0, 16)}`,
    sessionId: params.sessionId,
    kind,
    title: extractTitle(params.message, normalizedContent, kind),
    summary: truncateText(normalizedContent, MAX_ARTIFACT_SUMMARY_CHARS),
    content: normalizedContent,
    createdAt: params.createdAt + params.index,
    digest,
    tags: extractTags(normalizedContent, kind),
    source: params.source,
  };
}

function dedupeRecords(
  existingState: ArtifactCompactionState | undefined,
  records: readonly ContextArtifactRecord[],
  maxArtifacts: number,
): readonly ContextArtifactRecord[] {
  const merged = new Map<string, ContextArtifactRecord>();
  for (const artifact of records) {
    merged.set(artifact.digest, artifact);
  }
  if (existingState) {
    for (const ref of existingState.artifactRefs) {
      const digest = ref.digest;
      if (!merged.has(digest)) {
        merged.set(digest, {
          id: ref.id,
          sessionId: existingState.sessionId,
          kind: ref.kind,
          title: ref.title,
          summary: ref.summary,
          content: ref.summary,
          createdAt: ref.createdAt,
          digest,
          tags: ref.tags,
          source: existingState.source,
        });
      }
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, maxArtifacts);
}

function collectOpenLoops(messages: readonly LLMMessage[]): readonly string[] {
  const loops: string[] = [];
  for (const message of messages) {
    const content = extractText(message).replace(/\s+/g, " ").trim();
    if (!content || !OPEN_LOOP_RE.test(content)) continue;
    loops.push(truncateText(content, MAX_OPEN_LOOP_CHARS));
    if (loops.length >= 4) break;
  }
  return loops;
}

function renderSummaryText(state: ArtifactCompactionState): string {
  const lines: string[] = [
    `[Compacted context snapshot ${state.snapshotId}]`,
  ];
  if (state.narrativeSummary && state.narrativeSummary.trim().length > 0) {
    lines.push(`Summary: ${state.narrativeSummary.trim()}`);
  }
  if (state.artifactRefs.length > 0) {
    lines.push("Artifact refs:");
    for (const artifact of state.artifactRefs) {
      lines.push(
        `- [${artifact.kind}:${artifact.id}] ${artifact.title} — ${artifact.summary}`,
      );
    }
  }
  if (state.openLoops.length > 0) {
    lines.push("Open loops:");
    for (const openLoop of state.openLoops) {
      lines.push(`- ${openLoop}`);
    }
  }
  return lines.join("\n");
}

export function compactHistoryIntoArtifactContext(
  input: ArtifactCompactionInput,
): ArtifactCompactionOutput {
  const keepTailCount = Math.max(1, input.keepTailCount ?? DEFAULT_KEEP_TAIL_COUNT);
  const maxArtifacts = Math.max(1, input.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS);
  if (input.history.length <= keepTailCount) {
    const emptyState: ArtifactCompactionState = {
      version: 1,
      snapshotId: `snapshot:${sha256Hex(`${input.sessionId}:empty`).slice(0, 16)}`,
      sessionId: input.sessionId,
      createdAt: Date.now(),
      source: input.source,
      historyDigest: sha256Hex(""),
      sourceMessageCount: input.history.length,
      retainedTailCount: input.history.length,
      narrativeSummary: input.narrativeSummary,
      openLoops: [],
      artifactRefs: [],
    };
    return {
      compactedHistory: [...input.history],
      state: emptyState,
      records: [],
      summaryText: renderSummaryText(emptyState),
    };
  }

  const toCompact = input.history.slice(0, Math.max(0, input.history.length - keepTailCount));
  const toKeep = input.history.slice(-keepTailCount);
  const now = Date.now();
  const records = toCompact
    .map((message, index) => ({
      record: buildArtifactRecord({
        sessionId: input.sessionId,
        message,
        content: extractText(message),
        source: input.source,
        createdAt: now,
        index,
      }),
      score: scoreArtifact(
        message,
        extractText(message),
        inferKind(message, extractText(message)),
        index,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.record)
    .filter((record) => record.summary.length > 0)
    ;

  const selectedRecords = dedupeRecords(
    input.existingState,
    records,
    maxArtifacts,
  );
  const artifactRefs: ContextArtifactRef[] = selectedRecords.map((record) => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    createdAt: record.createdAt,
    digest: record.digest,
    tags: record.tags,
  }));
  const historyDigest = sha256Hex(
    toCompact.map((message) => `${message.role}:${extractText(message)}`).join("\n"),
  );
  const narrativeSummary =
    input.narrativeSummary && input.narrativeSummary.trim().length > 0
      ? truncateText(input.narrativeSummary, 320)
      : undefined;
  const state: ArtifactCompactionState = {
    version: 1,
    snapshotId: `snapshot:${historyDigest.slice(0, 16)}`,
    sessionId: input.sessionId,
    createdAt: now,
    source: input.source,
    historyDigest,
    sourceMessageCount: toCompact.length,
    retainedTailCount: toKeep.length,
    ...(narrativeSummary ? { narrativeSummary } : {}),
    openLoops: collectOpenLoops(toCompact),
    artifactRefs,
  };
  const summaryText = renderSummaryText(state);
  return {
    compactedHistory: [
      {
        role: "system",
        content: summaryText,
      },
      ...toKeep,
    ],
    state,
    records: selectedRecords,
    summaryText,
  };
}
