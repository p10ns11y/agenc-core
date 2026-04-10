import type { GatewayLLMConfig } from "../gateway/types.js";
import type { RuntimeContractFlags } from "./types.js";

export function resolveRuntimeContractFlags(
  llmConfig: GatewayLLMConfig | undefined,
): RuntimeContractFlags {
  return {
    runtimeContractV2: llmConfig?.runtimeContractV2 === true,
    stopHooksEnabled: llmConfig?.stopHooks?.enabled === true,
    asyncTasksEnabled: llmConfig?.asyncTasks?.enabled === true,
    persistentWorkersEnabled: llmConfig?.persistentWorkers?.enabled === true,
    mailboxEnabled: llmConfig?.mailbox?.enabled === true,
    verifierRuntimeRequired: llmConfig?.verifier?.runtimeRequired === true,
    verifierProjectBootstrap: llmConfig?.verifier?.projectBootstrap === true,
    workerIsolationWorktree: llmConfig?.workerIsolation?.worktree === true,
    workerIsolationRemote: llmConfig?.workerIsolation?.remote === true,
  };
}
