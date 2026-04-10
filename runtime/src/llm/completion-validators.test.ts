import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildStopHookRuntime } from "./hooks/stop-hooks.js";
import { buildCompletionValidators } from "./completion-validators.js";
import type { ExecutionContext, ToolCallRecord } from "./chat-executor-types.js";
import { createRuntimeContractSnapshot } from "../runtime-contract/types.js";
import type { RuntimeContractFlags } from "../runtime-contract/types.js";

function makeFlags(
  overrides: Partial<RuntimeContractFlags> = {},
): RuntimeContractFlags {
  return {
    runtimeContractV2: false,
    stopHooksEnabled: false,
    asyncTasksEnabled: false,
    persistentWorkersEnabled: false,
    mailboxEnabled: false,
    verifierRuntimeRequired: false,
    verifierProjectBootstrap: false,
    workerIsolationWorktree: false,
    workerIsolationRemote: false,
    ...overrides,
  };
}

function makeCtx(params: {
  readonly workspaceRoot?: string;
  readonly allToolCalls?: readonly ToolCallRecord[];
  readonly activeToolHandler?: ExecutionContext["activeToolHandler"];
  readonly finalContent?: string;
  readonly targetArtifacts?: readonly string[];
  readonly flags?: RuntimeContractFlags;
}): ExecutionContext {
  const flags = params.flags ?? makeFlags();
  return {
    sessionId: "session-1",
    messageText: "Implement the feature",
    runtimeWorkspaceRoot: params.workspaceRoot,
    allToolCalls: [...(params.allToolCalls ?? [])],
    activeToolHandler: params.activeToolHandler,
    response: {
      content: params.finalContent ?? "done",
      toolCalls: [],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "test-model",
      finishReason: "stop",
    },
    stopReason: "completed",
    completionState: "completed",
    turnExecutionContract: {
      targetArtifacts: params.targetArtifacts ?? [],
    },
    runtimeContractSnapshot: createRuntimeContractSnapshot(flags),
  } as unknown as ExecutionContext;
}

function successfulWrite(path: string): ToolCallRecord {
  return {
    name: "system.writeFile",
    args: { path, content: "hello" },
    result: JSON.stringify({ ok: true, path }),
    isError: false,
    durationMs: 1,
  };
}

describe("completion-validators", () => {
  it("uses the stop-hook runtime for the stop validator when enabled", async () => {
    const flags = makeFlags({ stopHooksEnabled: true });
    const validators = buildCompletionValidators({
      ctx: makeCtx({ flags }),
      runtimeContractFlags: flags,
      stopHookRuntime: buildStopHookRuntime({
        enabled: true,
        maxAttempts: 3,
        handlers: [
          {
            id: "stop-block",
            phase: "Stop",
            kind: "command",
            target: "printf '{\"blockingError\":\"configured block\"}'",
          },
        ],
      }),
    });

    const stopValidator = validators.find(
      (validator) => validator.id === "turn_end_stop_gate",
    );
    const result = await stopValidator!.execute();

    expect(result.outcome).toBe("retry_with_blocking_message");
    expect(result.reason).toBe("stop-block");
    expect(result.blockingMessage).toBe("configured block");
    expect(result.maxAttempts).toBe(3);
    expect(result.stopHookResult?.phase).toBe("Stop");
  });

  it("gates the verification stage before deterministic probes run", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "verification-ready-"));
    writeFileSync(join(workspaceRoot, "Makefile"), "all:\n\t@true\n");
    const toolHandler = vi.fn(async () =>
      JSON.stringify({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        durationMs: 1,
        truncated: false,
      }),
    );
    const flags = makeFlags({
      runtimeContractV2: true,
      stopHooksEnabled: true,
      verifierRuntimeRequired: true,
    });
    const validators = buildCompletionValidators({
      ctx: makeCtx({
        workspaceRoot,
        activeToolHandler: toolHandler,
        allToolCalls: [successfulWrite(join(workspaceRoot, "src/main.c"))],
        targetArtifacts: [join(workspaceRoot, "src/main.c")],
        flags,
      }),
      runtimeContractFlags: flags,
      stopHookRuntime: buildStopHookRuntime({
        enabled: true,
        handlers: [
          {
            id: "verification-block",
            phase: "VerificationReady",
            kind: "command",
            target: "printf '{\"blockingError\":\"verification blocked\"}'",
          },
        ],
      }),
    });

    const deterministic = validators.find(
      (validator) => validator.id === "deterministic_acceptance_probes",
    );
    const topLevel = validators.find(
      (validator) => validator.id === "top_level_verifier",
    );
    const deterministicResult = await deterministic!.execute();
    const topLevelResult = await topLevel!.execute();

    expect(deterministicResult.outcome).toBe("retry_with_blocking_message");
    expect(deterministicResult.blockingMessage).toBe("verification blocked");
    expect(deterministicResult.stopHookResult?.phase).toBe("VerificationReady");
    expect(topLevelResult.outcome).toBe("retry_with_blocking_message");
    expect(toolHandler).not.toHaveBeenCalled();
  });
});
