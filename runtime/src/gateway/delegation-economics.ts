/**
 * Delegation economics — collapsed stub (Cut 4.4).
 *
 * Replaces the previous 500-LOC weighted scoring pipeline that
 * computed delegation utility from step analysis, artifact relations,
 * dependency depth, parallel gain, tool overlap, verifier cost, and
 * retry cost. The planner-era arbitration that consumed this output
 * has been deleted; `delegation-admission.ts` only checks hard
 * rejection rules now (fanout caps, depth caps, shared writer
 * conflicts) and treats every delegation as economically positive.
 *
 * The exported types are preserved as opaque shapes so the
 * delegation-admission consumer still type-checks.
 *
 * @module
 */

import type { DelegationExecutionContext } from "../utils/delegation-execution-context.js";
import type { WorkflowArtifactRelation } from "../workflow/execution-envelope.js";

export interface DelegationCandidateStep {
  readonly name: string;
  readonly objective?: string;
  readonly inputContract?: string;
  readonly dependsOn?: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly requiredToolCapabilities: readonly string[];
  readonly contextRequirements: readonly string[];
  readonly executionContext?: DelegationExecutionContext;
  readonly maxBudgetHint: string;
  readonly canRunParallel: boolean;
}

export interface DelegationStepAnalysis {
  readonly step: DelegationCandidateStep;
  readonly artifactRelations: readonly WorkflowArtifactRelation[];
  readonly ownedArtifacts: readonly string[];
  readonly referencedArtifacts: readonly string[];
  readonly mutable: boolean;
  readonly readOnly: boolean;
  readonly shellObservationOnly: boolean;
  readonly budgetMinutes: number;
}

export interface DelegationEconomics {
  readonly stepAnalyses: readonly DelegationStepAnalysis[];
  readonly contextFootprint: number;
  readonly dependencyDepth: number;
  readonly dependencyCoupling: number;
  readonly parallelGain: number;
  readonly toolOverlap: number;
  readonly verifierCost: number;
  readonly retryCost: number;
  readonly utilityScore: number;
  readonly explicitOwnershipCoverage: number;
  readonly ownershipOverlap: number;
  readonly parallelizableCount: number;
}

function buildAnalysis(step: DelegationCandidateStep): DelegationStepAnalysis {
  return {
    step,
    artifactRelations: [],
    ownedArtifacts: [],
    referencedArtifacts: [],
    mutable: false,
    readOnly: true,
    shellObservationOnly: false,
    budgetMinutes: 5,
  };
}

export function deriveDelegationEconomics(
  input: Record<string, unknown> & {
    readonly steps: readonly DelegationCandidateStep[];
  },
): DelegationEconomics {
  return {
    stepAnalyses: input.steps.map(buildAnalysis),
    contextFootprint: 0,
    dependencyDepth: 0,
    dependencyCoupling: 0,
    parallelGain: 0,
    toolOverlap: 0,
    verifierCost: 0,
    retryCost: 0,
    utilityScore: 1,
    explicitOwnershipCoverage: 0,
    ownershipOverlap: 0,
    parallelizableCount: input.steps.filter((step) => step.canRunParallel).length,
  };
}
