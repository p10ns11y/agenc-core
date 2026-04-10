import {
  checkFilesystemArtifacts,
  evaluateArtifactEvidenceGate,
  evaluateTurnEndStopGate,
} from "./chat-executor-stop-gate.js";
import {
  runDeterministicAcceptanceProbes,
} from "./deterministic-acceptance-probes.js";
import type {
  ChatExecutorConfig,
  ExecutionContext,
  ToolCallRecord,
} from "./chat-executor-types.js";
import type {
  CompletionValidatorResult,
  CompletionValidatorId,
  RuntimeContractFlags,
} from "../runtime-contract/types.js";
import { runTopLevelVerifierValidation } from "../gateway/top-level-verifier.js";

export interface CompletionValidatorExecutionResult
  extends CompletionValidatorResult {
  readonly probeRuns?: readonly ToolCallRecord[];
}

export interface CompletionValidator {
  readonly id: CompletionValidatorId;
  readonly enabled: boolean;
  execute(): Promise<CompletionValidatorExecutionResult>;
}

export function buildCompletionValidators(params: {
  readonly ctx: ExecutionContext;
  readonly runtimeContractFlags: RuntimeContractFlags;
  readonly completionValidation?: ChatExecutorConfig["completionValidation"];
}): readonly CompletionValidator[] {
  return [
    {
      id: "artifact_evidence",
      enabled: true,
      async execute(): Promise<CompletionValidatorExecutionResult> {
        const decision = evaluateArtifactEvidenceGate({
          requiredToolEvidence: params.ctx.requiredToolEvidence,
          runtimeContext: {
            workspaceRoot: params.ctx.runtimeWorkspaceRoot,
          },
          allToolCalls: params.ctx.allToolCalls,
        });
        if (!decision.shouldIntervene) {
          return { id: "artifact_evidence", outcome: "pass" };
        }
        return {
          id: "artifact_evidence",
          outcome: "retry_with_blocking_message",
          reason: decision.validationCode ?? "artifact_evidence_gate",
          blockingMessage: decision.blockingMessage,
          evidence: decision.evidence,
          maxAttempts: params.ctx.requiredToolEvidence?.maxCorrectionAttempts ?? 0,
          exhaustedDetail:
            decision.stopReasonDetail ??
            "Artifact-evidence recovery exhausted.",
          validationCode: decision.validationCode,
        };
      },
    },
    {
      id: "turn_end_stop_gate",
      enabled: true,
      async execute(): Promise<CompletionValidatorExecutionResult> {
        const decision = evaluateTurnEndStopGate({
          finalContent: params.ctx.response?.content ?? "",
          allToolCalls: params.ctx.allToolCalls,
        });
        if (!decision.shouldIntervene) {
          return { id: "turn_end_stop_gate", outcome: "pass" };
        }
        return {
          id: "turn_end_stop_gate",
          outcome: "retry_with_blocking_message",
          reason: decision.reason ?? "turn_end_stop_gate",
          blockingMessage: decision.blockingMessage,
          evidence: decision.evidence,
          maxAttempts: 1,
          exhaustedDetail:
            decision.reason === "narrated_future_tool_work"
              ? "Stop-gate recovery exhausted: the model kept narrating future work instead of calling tools."
              : "Stop-gate recovery exhausted after the model continued to emit an invalid completion summary.",
        };
      },
    },
    {
      id: "filesystem_artifact_verification",
      enabled: true,
      async execute(): Promise<CompletionValidatorExecutionResult> {
        const check = await checkFilesystemArtifacts({
          finalContent: params.ctx.response?.content ?? "",
          allToolCalls: params.ctx.allToolCalls,
        });
        if (!check.shouldIntervene) {
          return { id: "filesystem_artifact_verification", outcome: "pass" };
        }
        return {
          id: "filesystem_artifact_verification",
          outcome: "retry_with_blocking_message",
          reason: "filesystem_artifact_verification",
          blockingMessage: check.blockingMessage,
          evidence: {
            emptyFiles: check.emptyFiles,
            missingFiles: check.missingFiles,
            checkedFiles: check.checkedFiles,
          },
          maxAttempts: 1,
          exhaustedDetail:
            "Filesystem artifact verification failed after recovery; missing or empty artifacts remain on disk.",
        };
      },
    },
    {
      id: "deterministic_acceptance_probes",
      enabled: true,
      async execute(): Promise<CompletionValidatorExecutionResult> {
        const decision = await runDeterministicAcceptanceProbes({
          workspaceRoot: params.ctx.runtimeWorkspaceRoot,
          targetArtifacts: params.ctx.turnExecutionContract.targetArtifacts,
          allToolCalls: params.ctx.allToolCalls,
          activeToolHandler: params.ctx.activeToolHandler,
        });
        if (!decision.shouldIntervene) {
          return {
            id: "deterministic_acceptance_probes",
            outcome: "pass",
            ...(decision.probeRuns.length > 0 ? { probeRuns: decision.probeRuns } : {}),
          };
        }
        return {
          id: "deterministic_acceptance_probes",
          outcome: "retry_with_blocking_message",
          reason:
            decision.validationCode ??
            "deterministic_acceptance_probe_failed",
          blockingMessage: decision.blockingMessage,
          evidence: decision.evidence,
          maxAttempts: 1,
          exhaustedDetail:
            decision.stopReasonDetail ??
            "Deterministic acceptance-probe recovery exhausted.",
          validationCode: decision.validationCode,
          probeRuns: decision.probeRuns,
        };
      },
    },
    {
      id: "top_level_verifier",
      enabled:
        params.runtimeContractFlags.runtimeContractV2 &&
        params.runtimeContractFlags.verifierRuntimeRequired,
      async execute(): Promise<CompletionValidatorExecutionResult> {
        if (
          !params.runtimeContractFlags.runtimeContractV2 ||
          !params.runtimeContractFlags.verifierRuntimeRequired
        ) {
          return { id: "top_level_verifier", outcome: "skipped" };
        }
        const validation = await runTopLevelVerifierValidation({
          sessionId: params.ctx.sessionId,
          userRequest: params.ctx.messageText,
          result: {
            content: params.ctx.response?.content ?? "",
            stopReason: params.ctx.stopReason,
            completionState: params.ctx.completionState,
            turnExecutionContract: params.ctx.turnExecutionContract,
            toolCalls: params.ctx.allToolCalls,
            stopReasonDetail: params.ctx.stopReasonDetail,
            validationCode: params.ctx.validationCode,
            completionProgress: undefined,
            runtimeContractSnapshot: params.ctx.runtimeContractSnapshot,
          },
          subAgentManager:
            params.completionValidation?.topLevelVerifier?.subAgentManager ??
            null,
          verifierService:
            params.completionValidation?.topLevelVerifier?.verifierService ??
            null,
          agentDefinitions:
            params.completionValidation?.topLevelVerifier?.agentDefinitions,
          logger: params.completionValidation?.topLevelVerifier?.logger,
        });
        return {
          id: "top_level_verifier",
          outcome: validation.outcome,
          reason: "top_level_verifier",
          blockingMessage: validation.blockingMessage,
          maxAttempts: params.ctx.requiredToolEvidence?.maxCorrectionAttempts ?? 1,
          exhaustedDetail: validation.exhaustedDetail,
          verifier: validation.runtimeVerifier,
        };
      },
    },
  ];
}
