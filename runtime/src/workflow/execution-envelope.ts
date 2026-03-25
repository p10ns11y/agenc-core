import {
  normalizeArtifactPaths,
  normalizeEnvelopeRoots,
  normalizeWorkspaceRoot,
} from "./path-normalization.js";
import type { ImplementationCompletionContract } from "./completion-contract.js";

export type ExecutionEnvelopeVersion = "v1";
export type ExecutionEffectClass =
  | "read_only"
  | "filesystem_write"
  | "filesystem_scaffold"
  | "shell"
  | "mixed";
export type ExecutionVerificationMode =
  | "none"
  | "grounded_read"
  | "mutation_required"
  | "deterministic_followup";
export type ExecutionStepKind =
  | "delegated_research"
  | "delegated_review"
  | "delegated_write"
  | "delegated_scaffold"
  | "delegated_validation";
export type ExecutionFallbackPolicy =
  | "continue_without_delegation"
  | "fail_request";
export type ExecutionResumePolicy = "stateless_retry" | "checkpoint_resume";
export type ExecutionApprovalProfile =
  | "inherit"
  | "read_only"
  | "filesystem_write"
  | "shell";

export interface ExecutionEnvelope {
  readonly version?: ExecutionEnvelopeVersion;
  readonly workspaceRoot?: string;
  readonly allowedReadRoots?: readonly string[];
  readonly allowedWriteRoots?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly inputArtifacts?: readonly string[];
  readonly targetArtifacts?: readonly string[];
  readonly requiredSourceArtifacts?: readonly string[];
  readonly effectClass?: ExecutionEffectClass;
  readonly verificationMode?: ExecutionVerificationMode;
  readonly stepKind?: ExecutionStepKind;
  readonly completionContract?: ImplementationCompletionContract;
  readonly fallbackPolicy?: ExecutionFallbackPolicy;
  readonly resumePolicy?: ExecutionResumePolicy;
  readonly approvalProfile?: ExecutionApprovalProfile;
  readonly compatibilitySource?:
    | "legacy_context_requirements"
    | "legacy_persisted_checkpoint";
}

export function isCompatibilityExecutionEnvelope(
  envelope: ExecutionEnvelope | undefined,
): boolean {
  return (
    envelope?.compatibilitySource === "legacy_context_requirements" ||
    envelope?.compatibilitySource === "legacy_persisted_checkpoint"
  );
}

export function createExecutionEnvelope(params: {
  readonly workspaceRoot?: string | null;
  readonly allowedReadRoots?: readonly (string | undefined | null)[];
  readonly allowedWriteRoots?: readonly (string | undefined | null)[];
  readonly allowedTools?: readonly (string | undefined | null)[];
  readonly inputArtifacts?: readonly (string | undefined | null)[];
  readonly targetArtifacts?: readonly (string | undefined | null)[];
  readonly requiredSourceArtifacts?: readonly (string | undefined | null)[];
  readonly effectClass?: ExecutionEffectClass;
  readonly verificationMode?: ExecutionVerificationMode;
  readonly stepKind?: ExecutionStepKind;
  readonly completionContract?: ImplementationCompletionContract;
  readonly fallbackPolicy?: ExecutionFallbackPolicy;
  readonly resumePolicy?: ExecutionResumePolicy;
  readonly approvalProfile?: ExecutionApprovalProfile;
  readonly compatibilitySource?:
    | "legacy_context_requirements"
    | "legacy_persisted_checkpoint";
}): ExecutionEnvelope | undefined {
  const workspaceRoot = normalizeWorkspaceRoot(params.workspaceRoot);
  const allowedReadRoots = normalizeEnvelopeRoots(
    params.allowedReadRoots ?? [],
    workspaceRoot,
  );
  const allowedWriteRoots = normalizeEnvelopeRoots(
    params.allowedWriteRoots ?? [],
    workspaceRoot,
  );
  const allowedTools = [...new Set(
    (params.allowedTools ?? [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  )];
  const inputArtifacts = normalizeArtifactPaths(
    params.inputArtifacts ?? [],
    workspaceRoot,
  );
  const requiredSourceArtifacts = normalizeArtifactPaths(
    params.requiredSourceArtifacts ?? params.inputArtifacts ?? [],
    workspaceRoot,
  );
  const targetArtifacts = normalizeArtifactPaths(
    params.targetArtifacts ?? [],
    workspaceRoot,
  );

  if (
    !workspaceRoot &&
    allowedReadRoots.length === 0 &&
    allowedWriteRoots.length === 0 &&
    allowedTools.length === 0 &&
    inputArtifacts.length === 0 &&
    requiredSourceArtifacts.length === 0 &&
    targetArtifacts.length === 0 &&
    !params.effectClass &&
    !params.verificationMode &&
    !params.stepKind &&
    !params.completionContract &&
    !params.fallbackPolicy &&
    !params.resumePolicy &&
    !params.approvalProfile
  ) {
    return undefined;
  }

  return {
    version: "v1",
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(allowedReadRoots.length > 0 ? { allowedReadRoots } : {}),
    ...(allowedWriteRoots.length > 0 ? { allowedWriteRoots } : {}),
    ...(allowedTools.length > 0 ? { allowedTools } : {}),
    ...(inputArtifacts.length > 0 ? { inputArtifacts } : {}),
    ...(requiredSourceArtifacts.length > 0 ? { requiredSourceArtifacts } : {}),
    ...(targetArtifacts.length > 0 ? { targetArtifacts } : {}),
    ...(params.effectClass ? { effectClass: params.effectClass } : {}),
    ...(params.verificationMode ? { verificationMode: params.verificationMode } : {}),
    ...(params.stepKind ? { stepKind: params.stepKind } : {}),
    ...(params.completionContract
      ? {
        completionContract: {
          taskClass: params.completionContract.taskClass,
          placeholdersAllowed: params.completionContract.placeholdersAllowed,
          partialCompletionAllowed:
            params.completionContract.partialCompletionAllowed,
          ...(params.completionContract.placeholderTaxonomy
            ? {
              placeholderTaxonomy:
                params.completionContract.placeholderTaxonomy,
            }
            : {}),
        },
      }
      : {}),
    ...(params.fallbackPolicy ? { fallbackPolicy: params.fallbackPolicy } : {}),
    ...(params.resumePolicy ? { resumePolicy: params.resumePolicy } : {}),
    ...(params.approvalProfile ? { approvalProfile: params.approvalProfile } : {}),
    ...(params.compatibilitySource
      ? { compatibilitySource: params.compatibilitySource }
      : {}),
  };
}
