import {
  createExecutionEnvelope,
  isCompatibilityExecutionEnvelope,
  type ExecutionApprovalProfile,
  type ExecutionEffectClass,
  type ExecutionEnvelope,
  type ExecutionFallbackPolicy,
  type ExecutionResumePolicy,
  type ExecutionStepKind,
  type ExecutionVerificationMode,
} from "../workflow/execution-envelope.js";
import type { ImplementationCompletionContract } from "../workflow/completion-contract.js";
import { migrateExecutionEnvelope } from "../workflow/migrations.js";
import { buildCanonicalDelegatedFilesystemScope } from "../workflow/delegated-filesystem-scope.js";

export type DelegationExecutionContext = ExecutionEnvelope;

export {
  createExecutionEnvelope as createDelegationExecutionContext,
};

const LEGACY_DELEGATED_SCOPE_REQUIREMENT_RE =
  /^(?:cwd|working(?:[_ -]?directory))\s*(?:=|:)\s*/i;

export function isLegacyDelegatedScopeRequirement(
  value: string | undefined | null,
): boolean {
  if (typeof value !== "string") return false;
  return LEGACY_DELEGATED_SCOPE_REQUIREMENT_RE.test(value.trim());
}

export function sanitizeDelegationContextRequirements(
  contextRequirements?: readonly (string | undefined | null)[],
): readonly string[] {
  const sanitized: string[] = [];
  for (const rawValue of contextRequirements ?? []) {
    if (typeof rawValue !== "string") continue;
    const normalized = rawValue.trim();
    if (
      normalized.length === 0 ||
      isLegacyDelegatedScopeRequirement(normalized) ||
      sanitized.includes(normalized)
    ) {
      continue;
    }
    sanitized.push(normalized);
  }
  return sanitized;
}

export function extractLegacyDelegatedWorkspaceRoot(
  contextRequirements?: readonly (string | undefined | null)[],
): string | undefined {
  return (contextRequirements ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .find((value) => isLegacyDelegatedScopeRequirement(value))
    ?.replace(LEGACY_DELEGATED_SCOPE_REQUIREMENT_RE, "")
    .trim();
}

function isConcreteHostPath(path: string | undefined | null): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed === "/workspace" || trimmed.startsWith("/workspace/")) {
    return false;
  }
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

function legacyWorkspaceRootNeedsConcreteFallback(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return true;
  if (trimmed === "/workspace" || trimmed.startsWith("/workspace/")) {
    return true;
  }
  if (trimmed === "." || trimmed === "..") {
    return true;
  }
  return !(
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

export function coerceDelegationExecutionContext(
  value: unknown,
): DelegationExecutionContext | undefined {
  return migrateExecutionEnvelope(value).value;
}

export function buildDelegationExecutionContext(params: {
  readonly workspaceRoot?: string | null;
  readonly inheritedWorkspaceRoot?: string | null;
  readonly hostWorkspaceRoot?: string | null;
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
}): DelegationExecutionContext | undefined {
  const canonicalScope = buildCanonicalDelegatedFilesystemScope({
    workspaceRoot: params.workspaceRoot,
    inheritedWorkspaceRoot: params.inheritedWorkspaceRoot,
    hostWorkspaceRoot: params.hostWorkspaceRoot,
    allowedReadRoots: params.allowedReadRoots,
    allowedWriteRoots: params.allowedWriteRoots,
    inputArtifacts: params.inputArtifacts,
    requiredSourceArtifacts: params.requiredSourceArtifacts,
    targetArtifacts: params.targetArtifacts,
  });

  return createExecutionEnvelope({
    workspaceRoot: canonicalScope.workspaceRoot,
    allowedReadRoots: canonicalScope.allowedReadRoots,
    allowedWriteRoots: canonicalScope.allowedWriteRoots,
    allowedTools: params.allowedTools,
    inputArtifacts: canonicalScope.inputArtifacts,
    targetArtifacts: canonicalScope.targetArtifacts,
    requiredSourceArtifacts: canonicalScope.requiredSourceArtifacts,
    effectClass: params.effectClass,
    verificationMode: params.verificationMode,
    stepKind: params.stepKind,
    completionContract: params.completionContract,
    fallbackPolicy: params.fallbackPolicy,
    resumePolicy: params.resumePolicy,
    approvalProfile: params.approvalProfile,
  });
}

/**
 * Temporary ingestion-only compatibility adapter for legacy planner/tool
 * payloads that still express the workspace root through `context_requirements`.
 * Once converted, downstream runtime code must consume only the structured
 * execution envelope.
 */
export function buildLegacyDelegationExecutionContext(params: {
  readonly contextRequirements?: readonly (string | undefined | null)[];
  readonly inheritedWorkspaceRoot?: string | null;
  readonly hostWorkspaceRoot?: string | null;
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
}): DelegationExecutionContext | undefined {
  const legacyWorkspaceRoot = extractLegacyDelegatedWorkspaceRoot(
    params.contextRequirements,
  );
  if (!legacyWorkspaceRoot) {
    return undefined;
  }
  if (
    legacyWorkspaceRootNeedsConcreteFallback(legacyWorkspaceRoot) &&
    !isConcreteHostPath(params.inheritedWorkspaceRoot) &&
    !isConcreteHostPath(params.hostWorkspaceRoot)
  ) {
    return undefined;
  }
  const canonicalScope = buildCanonicalDelegatedFilesystemScope({
    workspaceRoot: legacyWorkspaceRoot,
    inheritedWorkspaceRoot: params.inheritedWorkspaceRoot,
    hostWorkspaceRoot: params.hostWorkspaceRoot,
    allowedReadRoots: params.allowedReadRoots,
    allowedWriteRoots: params.allowedWriteRoots,
    inputArtifacts: params.inputArtifacts,
    requiredSourceArtifacts: params.requiredSourceArtifacts,
    targetArtifacts: params.targetArtifacts,
  });
  return createExecutionEnvelope({
    workspaceRoot: canonicalScope.workspaceRoot,
    allowedReadRoots: canonicalScope.allowedReadRoots,
    allowedWriteRoots: canonicalScope.allowedWriteRoots,
    allowedTools: params.allowedTools,
    inputArtifacts: canonicalScope.inputArtifacts,
    targetArtifacts: canonicalScope.targetArtifacts,
    requiredSourceArtifacts: canonicalScope.requiredSourceArtifacts,
    effectClass: params.effectClass,
    verificationMode: params.verificationMode,
    stepKind: params.stepKind,
    completionContract: params.completionContract,
    fallbackPolicy: params.fallbackPolicy,
    resumePolicy: params.resumePolicy,
    approvalProfile: params.approvalProfile,
    compatibilitySource: "legacy_context_requirements",
  });
}

export function canonicalizeDelegationExecutionContext(
  context: DelegationExecutionContext | undefined,
  params: {
    readonly inheritedWorkspaceRoot?: string | null;
    readonly hostWorkspaceRoot?: string | null;
  } = {},
): DelegationExecutionContext | undefined {
  if (!context || isCompatibilityExecutionEnvelope(context)) {
    return undefined;
  }
  return buildDelegationExecutionContext({
    workspaceRoot: context.workspaceRoot,
    inheritedWorkspaceRoot: params.inheritedWorkspaceRoot,
    hostWorkspaceRoot: params.hostWorkspaceRoot,
    allowedReadRoots: context.allowedReadRoots,
    allowedWriteRoots: context.allowedWriteRoots,
    allowedTools: context.allowedTools,
    inputArtifacts: context.inputArtifacts,
    targetArtifacts: context.targetArtifacts,
    requiredSourceArtifacts: context.requiredSourceArtifacts,
    effectClass: context.effectClass,
    verificationMode: context.verificationMode,
    stepKind: context.stepKind,
    completionContract: context.completionContract,
    fallbackPolicy: context.fallbackPolicy,
    resumePolicy: context.resumePolicy,
    approvalProfile: context.approvalProfile,
  });
}
