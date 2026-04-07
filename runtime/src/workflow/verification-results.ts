/**
 * Workflow verification results — opaque type stub (Cut 1.1).
 *
 * The planner-era channel-decision builder API has been deleted. Only the
 * opaque decision type remains so that the verification-contract stub can
 * still advertise a no-op return shape to its sole consumer
 * (eval/implementation-gate-suite.ts).
 *
 * @module
 */

import type { DelegationOutputValidationCode } from "../utils/delegation-validation.js";

export interface RuntimeVerificationDiagnostic {
  readonly code: DelegationOutputValidationCode;
  readonly message: string;
}

interface RuntimeVerificationChannelDecision {
  readonly channel: "artifact_state" | "placeholder_stub" | "executable_outcome" | "rubric";
  readonly ok: boolean;
  readonly message: string;
  readonly evidence?: readonly string[];
  readonly diagnostic?: RuntimeVerificationDiagnostic;
}

export interface RuntimeVerificationDecision {
  readonly ok: boolean;
  readonly compatibilityFallbackSuggested?: boolean;
  readonly diagnostic?: RuntimeVerificationDiagnostic;
  readonly channels: readonly RuntimeVerificationChannelDecision[];
}
