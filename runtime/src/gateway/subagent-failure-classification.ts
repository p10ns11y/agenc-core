/**
 * Sub-agent failure classification, retry logic, and working-directory
 * resolution for delegated planner steps.
 *
 * Extracted from SubAgentOrchestrator — these helpers classify spawn/runtime
 * failures into retryable categories, resolve delegated working directories,
 * and manage retry budget tracking.
 *
 * @module
 */

import type { PipelinePlannerSubagentStep } from "../workflow/pipeline.js";
import type { Pipeline } from "../workflow/pipeline.js";
import type { SubAgentResult } from "./sub-agent.js";
import {
  type DelegatedWorkingDirectoryResolution,
  resolveDelegatedWorkingDirectory,
} from "./delegation-tool.js";
import { sanitizeDelegationContextRequirements } from "../utils/delegation-execution-context.js";
import {
  resolveDelegationBudgetHintMs,
} from "./delegation-timeout.js";
import type { SubagentFailureClass, SubagentRetryRule } from "./subagent-orchestrator-types.js";
import {
  DEFAULT_TOOL_BUDGET_PER_REQUEST,
} from "../llm/chat-executor-constants.js";
import { buildCanonicalDelegatedFilesystemScope } from "../workflow/delegated-filesystem-scope.js";

/* ------------------------------------------------------------------ */
/*  Budget & tool budget constants                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_PLANNED_SUBAGENT_TOOL_BUDGET = DEFAULT_TOOL_BUDGET_PER_REQUEST;
const MAX_PLANNED_SUBAGENT_TOOL_BUDGET = 96;
const PLANNED_SUBAGENT_TOOL_BUDGET_MS_PER_CALL = 7_500;
const BUDGET_EXCEEDED_RETRY_TOOL_BUDGET_MULTIPLIER = 1.5;

/* ------------------------------------------------------------------ */
/*  Budget hint & tool budget resolution                               */
/* ------------------------------------------------------------------ */

export function parseBudgetHintMs(
  hint: string,
  defaultSubagentTimeoutMs: number,
): number {
  return resolveDelegationBudgetHintMs(
    hint,
    defaultSubagentTimeoutMs,
  );
}

export function resolveSubagentToolBudgetPerRequest(params: {
  readonly timeoutMs: number;
  readonly priorFailureClass?: SubagentFailureClass;
}): number {
  const baseBudget = Math.max(
    DEFAULT_PLANNED_SUBAGENT_TOOL_BUDGET,
    Math.ceil(params.timeoutMs / PLANNED_SUBAGENT_TOOL_BUDGET_MS_PER_CALL),
  );
  const boostedBudget =
    params.priorFailureClass === "budget_exceeded"
      ? Math.ceil(
          baseBudget * BUDGET_EXCEEDED_RETRY_TOOL_BUDGET_MULTIPLIER,
        )
      : baseBudget;
  return Math.min(MAX_PLANNED_SUBAGENT_TOOL_BUDGET, boostedBudget);
}

/* ------------------------------------------------------------------ */
/*  Retry attempt tracking                                             */
/* ------------------------------------------------------------------ */

export function createRetryAttemptTracker(): Record<SubagentFailureClass, number> {
  return {
    timeout: 0,
    budget_exceeded: 0,
    tool_misuse: 0,
    malformed_result_contract: 0,
    needs_decomposition: 0,
    invalid_input: 0,
    transient_provider_error: 0,
    cancelled: 0,
    spawn_error: 0,
    unknown: 0,
  };
}

export function computeRetryDelayMs(
  rule: SubagentRetryRule,
  retryAttempt: number,
): number {
  if (rule.maxRetries <= 0 || rule.baseDelayMs <= 0) return 0;
  const scaled = rule.baseDelayMs * Math.max(1, retryAttempt);
  return Math.max(0, Math.min(rule.maxDelayMs, scaled));
}

/* ------------------------------------------------------------------ */
/*  Failure classification                                             */
/* ------------------------------------------------------------------ */

export function classifySpawnFailure(message: string): SubagentFailureClass {
  const lower = message.toLowerCase();
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("deadline exceeded")
  ) {
    return "timeout";
  }
  if (
    lower.includes("temporarily unavailable") ||
    lower.includes("resource temporarily unavailable") ||
    lower.includes("connection reset") ||
    lower.includes("econnreset") ||
    lower.includes("429") ||
    lower.includes("rate limit")
  ) {
    return "transient_provider_error";
  }
  return "spawn_error";
}

export function classifySubagentFailureMessage(message: string): SubagentFailureClass {
  const lower = message.toLowerCase();
  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("deadline exceeded")
  ) {
    return "timeout";
  }
  if (lower.includes("cancelled") || lower.includes("canceled")) {
    return "cancelled";
  }
  if (
    lower.includes("provider error") ||
    lower.includes("fetch failed") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("connection reset") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("rate limit") ||
    lower.includes("429")
  ) {
    return "transient_provider_error";
  }
  if (
    lower.includes("missing required argument") ||
    lower.includes("invalid argument") ||
    lower.includes("unknown tool") ||
    lower.includes("tool call validation") ||
    lower.includes("command must be one executable token/path") ||
    lower.includes("shell snippets")
  ) {
    return "tool_misuse";
  }
  if (
    lower.includes("malformed result contract") ||
    lower.includes("expected json object")
  ) {
    return "malformed_result_contract";
  }
  return "unknown";
}

export function classifySubagentFailureResult(
  result: Pick<SubAgentResult, "output" | "stopReason" | "stopReasonDetail">,
): SubagentFailureClass {
  if (result.stopReason === "timeout") return "timeout";
  if (result.stopReason === "budget_exceeded") return "budget_exceeded";
  if (result.stopReason === "cancelled") return "cancelled";
  if (
    result.stopReason === "provider_error" ||
    result.stopReason === "authentication_error" ||
    result.stopReason === "rate_limited"
  ) {
    return "transient_provider_error";
  }
  const message =
    typeof result.stopReasonDetail === "string" &&
      result.stopReasonDetail.trim().length > 0
      ? result.stopReasonDetail
      : (typeof result.output === "string" ? result.output : "");
  return classifySubagentFailureMessage(message);
}

/* ------------------------------------------------------------------ */
/*  Delegated working directory resolution                             */
/* ------------------------------------------------------------------ */

export function resolveEffectiveDelegatedWorkingDirectory(input: {
  readonly executionContext?: PipelinePlannerSubagentStep["executionContext"];
}): (DelegatedWorkingDirectoryResolution & { readonly anchored: boolean }) | undefined {
  const delegatedWorkingDirectory = resolveDelegatedWorkingDirectory(input);
  if (!delegatedWorkingDirectory) {
    return undefined;
  }

  return {
    ...delegatedWorkingDirectory,
    anchored: isAnchoredDelegatedWorkingDirectory(delegatedWorkingDirectory.path),
  };
}

export function isAnchoredDelegatedWorkingDirectory(path: string): boolean {
  const normalized = path.trim();
  if (normalized.length === 0) return false;
  if (normalized.startsWith("/")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) return true;
  if (normalized.startsWith("~")) return true;
  return false;
}

export function stepRequiresStructuredDelegatedFilesystemScope(
  step: PipelinePlannerSubagentStep,
): boolean {
  return Boolean(
    step.executionContext?.workspaceRoot?.trim().length ||
      step.executionContext?.allowedReadRoots?.length ||
      step.executionContext?.allowedWriteRoots?.length ||
      step.executionContext?.requiredSourceArtifacts?.length ||
      step.executionContext?.targetArtifacts?.length,
  );
}

export function resolvePlannerStepWorkingDirectory(
  step: PipelinePlannerSubagentStep,
  pipeline: Pipeline,
  hostWorkspaceRoot?: string | null,
): {
  readonly path: string;
  readonly anchored: boolean;
  readonly source?: DelegatedWorkingDirectoryResolution["source"];
} | undefined {
  void pipeline;
  void hostWorkspaceRoot;
  const canonicalScope = buildCanonicalDelegatedFilesystemScope({
    workspaceRoot: step.executionContext?.workspaceRoot,
    allowedReadRoots: step.executionContext?.allowedReadRoots,
    allowedWriteRoots: step.executionContext?.allowedWriteRoots,
    inputArtifacts: step.executionContext?.inputArtifacts,
    requiredSourceArtifacts: step.executionContext?.requiredSourceArtifacts,
    targetArtifacts: step.executionContext?.targetArtifacts,
  });
  if (canonicalScope.workspaceRoot) {
    return {
      path: canonicalScope.workspaceRoot,
      anchored: isAnchoredDelegatedWorkingDirectory(
        canonicalScope.workspaceRoot,
      ),
      source: "execution_envelope",
    };
  }

  return undefined;
}

export function buildEffectiveContextRequirements(
  step: PipelinePlannerSubagentStep,
): readonly string[] {
  return sanitizeDelegationContextRequirements(step.contextRequirements);
}

/* ------------------------------------------------------------------ */
/*  High risk capabilities check                                       */
/* ------------------------------------------------------------------ */

export function hasHighRiskCapabilities(capabilities: readonly string[]): boolean {
  for (const capability of capabilities) {
    const normalized = capability.trim().toLowerCase();
    if (!normalized) continue;
    if (
      normalized.startsWith("wallet.") ||
      normalized.startsWith("solana.") ||
      normalized.startsWith("agenc.") ||
      normalized.startsWith("desktop.") ||
      normalized === "system.delete" ||
      normalized === "system.execute" ||
      normalized === "system.open" ||
      normalized === "system.applescript" ||
      normalized === "system.notification"
    ) {
      return true;
    }
  }
  return false;
}
