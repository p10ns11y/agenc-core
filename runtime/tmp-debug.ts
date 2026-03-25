import { SubAgentOrchestrator } from "./src/gateway/subagent-orchestrator.ts";
import type { Pipeline, PipelineResult } from "./src/workflow/pipeline.ts";
import type { DeterministicPipelineExecutor } from "./src/llm/chat-executor.ts";
import type { SubAgentConfig, SubAgentResult } from "./src/gateway/sub-agent.ts";

class FakeSubAgentManager {
  private seq = 0;
  private readonly entries = new Map<string, {
    readyAt: number;
    result: SubAgentResult;
  }>();
  public readonly spawnCalls: SubAgentConfig[] = [];

  constructor(
    private readonly delayMs: number,
    private readonly shouldSucceed = true,
  ) {}

  async spawn(config: SubAgentConfig): Promise<string> {
    const id = `sub-${++this.seq}`;
    this.spawnCalls.push(config);
    const contextText = [
      config.delegationSpec?.objective ?? "",
      config.delegationSpec?.inputContract ?? "",
      ...(config.delegationSpec?.acceptanceCriteria ?? []),
    ]
      .join(" ")
      .toLowerCase();

    const writeTool = config.tools?.find((tool) =>
      tool === "system.writeFile" ||
      tool === "system.appendFile" ||
      tool === "mcp.neovim.vim_buffer_save" ||
      tool === "mcp.neovim.vim_search_replace" ||
      tool === "desktop.text_editor"
    );
    const readTool = config.tools?.find((tool) => tool === "system.readFile");
    const bashTool = config.tools?.find((tool) =>
      tool === "system.bash" || tool === "desktop.bash"
    );
    const calls: any[] = [];

    if (writeTool) {
      calls.push({
        name: writeTool,
        args: {
          path: "/workspace/packages/cli/src/cli.ts",
          content: "export const ok = true;\n",
        },
        result: "{\"path\":\"/workspace/packages/cli/src/cli.ts\",\"bytesWritten\":24}",
        isError: false,
        durationMs: 1,
      });
    }
    if (readTool) {
      calls.push({
        name: readTool,
        args: { path: "/workspace/packages/cli/src/cli.ts" },
        result: "contents",
        isError: false,
        durationMs: 1,
      });
    }
    if (bashTool && /build|compile|test|verify|workspace/i.test(contextText)) {
      calls.push({
        name: bashTool,
        args: { command: "npm", args: ["run", "build"] },
        result: "{\"stdout\":\"build ok\",\"stderr\":\"\",\"exitCode\":0}",
        isError: false,
        durationMs: 1,
      });
    }

    this.entries.set(id, {
      readyAt: Date.now() + this.delayMs,
      result: {
        sessionId: id,
        output: this.shouldSucceed
          ? `${(config.delegationSpec?.acceptanceCriteria ?? []).join("\n")}\n${config.delegationSpec?.objective ?? id}`
          : "Tool call validation failed: missing required argument 'command' for system.bash",
        success: this.shouldSucceed,
        durationMs: this.delayMs,
        toolCalls: calls,
      },
    });
    return id;
  }

  getResult(sessionId: string): SubAgentResult | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (Date.now() < entry.readyAt) return null;
    return entry.result;
  }

  cancel(): boolean {
    return true;
  }
}

class SequencedSubAgentManager {
  private seq = 0;
  private readonly entries = new Map<string, {
    readyAt: number;
    result: SubAgentResult;
  }>();
  public readonly spawnCalls: SubAgentConfig[] = [];

  constructor(
    private readonly outcomes: readonly {
      delayMs: number;
      result: Omit<SubAgentResult, "sessionId">;
    }[],
  ) {}

  async spawn(config: SubAgentConfig): Promise<string> {
    const id = `seq-${++this.seq}`;
    const template = this.outcomes[Math.min(this.seq - 1, this.outcomes.length - 1)]!;
    this.spawnCalls.push(config);
    this.entries.set(id, {
      readyAt: Date.now() + template.delayMs,
      result: {
        ...template.result,
        sessionId: id,
      },
    });
    return id;
  }

  getResult(sessionId: string): SubAgentResult | null {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (Date.now() < entry.readyAt) return null;
    return entry.result;
  }

  cancel(): boolean {
    return true;
  }
}

function createFallbackExecutor(
  impl: (pipeline: Pipeline) => Promise<PipelineResult>,
): DeterministicPipelineExecutor {
  return { execute: impl };
}

async function run() {
  const fallback = createFallbackExecutor(async (pipeline) => ({
    status: "completed",
    context: pipeline.context,
    completedSteps: pipeline.steps.length,
    totalSteps: pipeline.steps.length,
  }));

  const tokenManager = new SequencedSubAgentManager([
    {
      delayMs: 5,
      result: {
        output: "Included findings from phase one",
        success: true,
        durationMs: 10,
        toolCalls: [{
          name: "system.writeFile",
          args: { path: "/tmp/phase-one.ts", content: "export const phaseOne = true;\n" },
          result: "{\"path\":\"/tmp/phase-one.ts\",\"bytesWritten\":31}",
          isError: false,
          durationMs: 1,
        }],
        tokenUsage: {
          promptTokens: 180_000,
          completionTokens: 20_000,
          totalTokens: 200_000,
        },
      },
    },
    {
      delayMs: 5,
      result: {
        output: "Included findings from phase two",
        success: true,
        durationMs: 10,
        toolCalls: [{
          name: "system.writeFile",
          args: { path: "/tmp/phase-two.ts", content: "export const phaseTwo = true;\n" },
          result: "{\"path\":\"/tmp/phase-two.ts\",\"bytesWritten\":31}",
          isError: false,
          durationMs: 1,
        }],
        tokenUsage: {
          promptTokens: 180_000,
          completionTokens: 20_000,
          totalTokens: 200_000,
        },
      },
    },
  ]);
  const tokenOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: fallback,
    resolveSubAgentManager: () => tokenManager as any,
    maxCumulativeTokensPerRequestTree: 0,
    maxCumulativeTokensPerRequestTreeExplicitlyConfigured: true,
    pollIntervalMs: 5,
  });
  const tokenResult = await tokenOrchestrator.execute({
    id: "planner:session-token-unlimited:1",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "delegate_phase_one",
        stepType: "subagent_task",
        objective: "Implement phase one",
        inputContract: "Return findings",
        acceptanceCriteria: ["Include findings"],
        requiredToolCapabilities: ["system.writeFile"],
        contextRequirements: ["workspace_files"],
        maxBudgetHint: "5m",
        canRunParallel: true,
      },
      {
        name: "delegate_phase_two",
        stepType: "subagent_task",
        objective: "Implement phase two",
        inputContract: "Return findings",
        acceptanceCriteria: ["Include findings"],
        requiredToolCapabilities: ["system.writeFile"],
        contextRequirements: ["workspace_files"],
        maxBudgetHint: "5m",
        canRunParallel: true,
        dependsOn: ["delegate_phase_one"],
      },
    ],
  } as any);

  const memoryManager = new FakeSubAgentManager(20, true);
  const memoryOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: fallback,
    resolveSubAgentManager: () => memoryManager as any,
    pollIntervalMs: 10,
  });
  const memoryResult = await memoryOrchestrator.execute({
    id: "planner:session-no-memory-default:123",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "delegate_repo_task",
        stepType: "subagent_task",
        objective: "Implement the CLI entrypoint from the existing package layout",
        inputContract: "Use the repo files only and return a concise summary",
        acceptanceCriteria: ["CLI entrypoint created"],
        requiredToolCapabilities: ["system.writeFile"],
        contextRequirements: ["repo_context"],
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
    ],
    plannerContext: {
      parentRequest: "Build the CLI package and keep scope inside the repo.",
      history: [{ role: "user", content: "Please implement the CLI package." }],
      memory: [
        {
          source: "memory_semantic",
          content: "Solana validator RPC defaults to devnet in a different project.",
        },
        {
          source: "memory_episodic",
          content: "We discussed wallet adapter UX yesterday.",
        },
      ],
      toolOutputs: [],
    },
  } as any);

  const toolScopeManager = new FakeSubAgentManager(20, true);
  const toolScopeOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: fallback,
    resolveSubAgentManager: () => toolScopeManager as any,
    pollIntervalMs: 10,
    childToolAllowlistStrategy: "inherit_intersection",
    allowedParentTools: ["system.readFile", "system.listFiles", "system.bash"],
    forbiddenParentTools: ["system.bash"],
    resolveAvailableToolNames: () => [
      "system.readFile",
      "system.bash",
      "system.listFiles",
    ],
  });
  const toolScopeResult = await toolScopeOrchestrator.execute({
    id: "planner:session-toolscope:123",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "delegate_scope",
        stepType: "subagent_task",
        objective: "Analyze failure clusters",
        inputContract: "Return summary",
        acceptanceCriteria: ["summary"],
        requiredToolCapabilities: [
          "system.readFile",
          "system.bash",
          "system.httpGet",
        ],
        contextRequirements: ["ci_logs"],
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
    ],
    plannerContext: {
      parentRequest: "Analyze CI failures",
      history: [],
      memory: [],
      toolOutputs: [],
      parentAllowedTools: ["system.readFile", "system.bash"],
    },
  } as any);

  const toolMisuseManager = new SequencedSubAgentManager([
    {
      delayMs: 5,
      result: {
        output:
          "Tool call validation failed: missing required argument 'command' for system.bash",
        success: false,
        durationMs: 12,
        toolCalls: [],
      },
    },
  ]);
  const toolMisuseOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: fallback,
    resolveSubAgentManager: () => toolMisuseManager as any,
    pollIntervalMs: 5,
    fallbackBehavior: "fail_request",
  });
  const toolMisuseResult = await toolMisuseOrchestrator.execute({
    id: "planner:session-c4-tool-misuse:1",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "delegate_tool_misuse",
        stepType: "subagent_task",
        objective: "Analyze logs",
        inputContract: "Return findings",
        acceptanceCriteria: ["Include findings"],
        requiredToolCapabilities: ["system.bash"],
        contextRequirements: ["ci_logs"],
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
    ],
  } as any);

  console.log(JSON.stringify({
    tokenResult,
    tokenSpawnTools: tokenManager.spawnCalls.map((call) => call.tools),
    memoryResult,
    memorySpawnTools: memoryManager.spawnCalls.map((call) => call.tools),
    memorySpawnPrompt: memoryManager.spawnCalls[0]?.task,
    toolScopeResult,
    toolScopeSpawnTools: toolScopeManager.spawnCalls.map((call) => call.tools),
    toolMisuseResult,
    toolMisuseSpawnTools: toolMisuseManager.spawnCalls.map((call) => call.tools),
  }, null, 2));

  const acceptanceWorkspaceRoot = "/tmp/agenc-debug-acceptance";
  const acceptanceFallback = createFallbackExecutor(async (pipeline) => {
    const step = pipeline.steps[0]!;
    if (step.name === "npm_install") {
      return {
        status: "completed",
        context: {
          results: {
            ...pipeline.context.results,
            [step.name]: "{\"exitCode\":0,\"stdout\":\"installed\",\"stderr\":\"\"}",
          },
        },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    if (step.name.startsWith("acceptance_probe_build")) {
      if (!("count" in acceptanceFallback)) {
        (acceptanceFallback as any).count = 0;
      }
      (acceptanceFallback as any).count += 1;
      if ((acceptanceFallback as any).count === 1) {
        return {
          status: "failed",
          context: pipeline.context,
          completedSteps: 0,
          totalSteps: 1,
          error: "Command failed: npm run build\nsrc/index.ts(2,21): error TS2307: Cannot find module 'fs'.",
          stopReasonHint: "validation_error",
        };
      }
      return {
        status: "completed",
        context: {
          results: {
            ...pipeline.context.results,
            [step.name]: "{\"exitCode\":0,\"stdout\":\"build ok\",\"stderr\":\"\"}",
          },
        },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    if (step.name === "run_build") {
      return {
        status: "completed",
        context: {
          results: {
            ...pipeline.context.results,
            [step.name]: "{\"exitCode\":0,\"stdout\":\"root build ok\",\"stderr\":\"\"}",
          },
        },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    return {
      status: "completed",
      context: pipeline.context,
      completedSteps: pipeline.steps.length,
      totalSteps: pipeline.steps.length,
    };
  });
  const acceptanceManager = new SequencedSubAgentManager([
    {
      delayMs: 5,
      result: {
        output: "**Phase `implement_data_package` completed.** Authored `/tmp/agenc-debug-acceptance/packages/data/src/index.ts` for the package.",
        success: true,
        durationMs: 12,
        toolCalls: [{
          name: "system.writeFile",
          args: {
            path: "/tmp/agenc-debug-acceptance/packages/data/src/index.ts",
            content: "import * as fs from 'fs';\nexport const broken = true;\n",
          },
          result: "{\"path\":\"/tmp/agenc-debug-acceptance/packages/data/src/index.ts\",\"bytesWritten\":52}",
          isError: false,
          durationMs: 2,
        }],
        stopReason: "completed",
      },
    },
    {
      delayMs: 5,
      result: {
        output: "**Phase `implement_data_package` completed.** Authored `/tmp/agenc-debug-acceptance/packages/data/src/index.ts` with host-compatible exports.",
        success: true,
        durationMs: 11,
        toolCalls: [{
          name: "system.writeFile",
          args: {
            path: "/tmp/agenc-debug-acceptance/packages/data/src/index.ts",
            content: "export const fixed = true;\n",
          },
          result: "{\"path\":\"/tmp/agenc-debug-acceptance/packages/data/src/index.ts\",\"bytesWritten\":26}",
          isError: false,
          durationMs: 2,
        }],
        stopReason: "completed",
      },
    },
  ]);
  const acceptanceOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: acceptanceFallback,
    resolveSubAgentManager: () => acceptanceManager as any,
    pollIntervalMs: 5,
    fallbackBehavior: "fail_request",
  });
  const acceptanceResult = await acceptanceOrchestrator.execute({
    id: "planner:session-acceptance-probe:1",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "npm_install",
        stepType: "deterministic_tool",
        tool: "system.bash",
        args: { command: "npm", args: ["install"], cwd: acceptanceWorkspaceRoot },
        onError: "abort",
      },
      {
        name: "implement_data_package",
        stepType: "subagent_task",
        dependsOn: ["npm_install"],
        objective: "Implement the data package in the prepared workspace.",
        inputContract: "Workspace dependencies are installed.",
        acceptanceCriteria: ["Author the package source files."],
        requiredToolCapabilities: ["system.writeFile", "system.readFile"],
        contextRequirements: [`cwd=${acceptanceWorkspaceRoot}/packages/data`],
        maxBudgetHint: "2m",
        canRunParallel: true,
      },
      {
        name: "run_build",
        stepType: "deterministic_tool",
        dependsOn: ["implement_data_package"],
        tool: "system.bash",
        args: { command: "npm", args: ["run", "build"], cwd: acceptanceWorkspaceRoot },
        onError: "abort",
      },
    ],
  } as any);

  const skipFallback = createFallbackExecutor(async (pipeline) => {
    const step = pipeline.steps[0]!;
    if (step.name === "diagnose_build") {
      return {
        status: "completed",
        context: { results: { ...pipeline.context.results, diagnose_build: "SKIPPED: Command failed: npm run build" } },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    if (step.name === "run_build") {
      return {
        status: "completed",
        context: { results: { ...pipeline.context.results, run_build: "{\"exitCode\":0,\"stdout\":\"build ok\"}" } },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    if (step.name === "run_test") {
      return {
        status: "completed",
        context: { results: { ...pipeline.context.results, run_test: "{\"exitCode\":0,\"stdout\":\"tests ok\"}" } },
        completedSteps: 1,
        totalSteps: 1,
      };
    }
    throw new Error(`Unexpected deterministic step ${step.name}`);
  });
  const skipManager = new SequencedSubAgentManager([
    {
      delayMs: 5,
      result: {
        output: "**repair_core complete** Updated `packages/core/src/index.ts` and verified build succeeds cleanly.",
        success: true,
        durationMs: 18,
        toolCalls: [
          {
            name: "system.writeFile",
            args: {
              path: "/tmp/agenc-debug-skip/packages/core/src/index.ts",
              content: "export const repaired = true;\n",
            },
            result: "{\"path\":\"/tmp/agenc-debug-skip/packages/core/src/index.ts\",\"bytesWritten\":30}",
            isError: false,
            durationMs: 2,
          },
          {
            name: "system.bash",
            args: {
              command: "npm",
              args: ["run", "build"],
            },
            result: "{\"stdout\":\"build ok\",\"stderr\":\"\",\"exitCode\":0}",
            isError: false,
            durationMs: 4,
          },
        ],
        stopReason: "completed",
      },
    },
  ]);
  const skipOrchestrator = new SubAgentOrchestrator({
    fallbackExecutor: skipFallback,
    resolveSubAgentManager: () => skipManager as any,
    pollIntervalMs: 5,
  });
  const skipResult = await skipOrchestrator.execute({
    id: "planner:session-skip-repair:1",
    createdAt: Date.now(),
    context: { results: {} },
    steps: [],
    plannerSteps: [
      {
        name: "diagnose_build",
        stepType: "deterministic_tool",
        tool: "system.bash",
        args: { command: "npm", args: ["run", "build"], cwd: "/tmp/agenc-debug-skip" },
        onError: "skip",
      },
      {
        name: "repair_core",
        stepType: "subagent_task",
        dependsOn: ["diagnose_build"],
        objective: "Fix TS compilation errors in packages/core only; correct engine logic, types, and exports without full rewrite.",
        inputContract: "Partially built monorepo with core/cli/web; keep existing files.",
        acceptanceCriteria: ["Build succeeds cleanly", "Core tsc passes"],
        requiredToolCapabilities: ["system.bash", "system.readFile", "system.writeFile", "system.listDir"],
        contextRequirements: ["cwd=/workspace/transit-weave-ts"],
        executionContext: {
          workspaceRoot: "/tmp/agenc-debug-skip",
          allowedReadRoots: ["/tmp/agenc-debug-skip"],
          allowedWriteRoots: ["/tmp/agenc-debug-skip"],
        },
        maxBudgetHint: "2m",
        canRunParallel: false,
      },
      {
        name: "run_build",
        stepType: "deterministic_tool",
        dependsOn: ["repair_core"],
        tool: "system.bash",
        args: { command: "npm", args: ["run", "build"], cwd: "/tmp/agenc-debug-skip" },
      },
      {
        name: "run_test",
        stepType: "deterministic_tool",
        dependsOn: ["run_build"],
        tool: "system.bash",
        args: { command: "npm", args: ["test"], cwd: "/tmp/agenc-debug-skip" },
      },
    ],
    edges: [
      { from: "diagnose_build", to: "repair_core" },
      { from: "repair_core", to: "run_build" },
      { from: "run_build", to: "run_test" },
    ],
  } as any);

  console.log(JSON.stringify({
    acceptanceResult,
    acceptanceSpawnTools: acceptanceManager.spawnCalls.map((call) => call.tools),
    acceptanceCriteria: acceptanceManager.spawnCalls[0]?.delegationSpec?.acceptanceCriteria,
    acceptanceRetryPrompt: acceptanceManager.spawnCalls[1]?.task,
    skipResult,
    skipSpawnTools: skipManager.spawnCalls.map((call) => call.tools),
    skipCriteria: skipManager.spawnCalls[0]?.delegationSpec?.acceptanceCriteria,
    skipExecutionContext: skipManager.spawnCalls[0]?.delegationSpec?.executionContext,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
