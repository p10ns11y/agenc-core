import type { LLMUsage } from "./types.js";

export type RuntimeBudgetMode = "report_only" | "enforce";

export type RuntimeRunClass =
  | "planner"
  | "executor"
  | "verifier"
  | "child";

export interface RuntimeRunBudget {
  readonly runClass: RuntimeRunClass;
  readonly tokenCeiling: number;
  readonly latencyCeilingMs: number;
  readonly spendCeilingUnits: number;
  readonly downgradeTokenRatio: number;
  readonly downgradeSpendRatio: number;
  readonly downgradeLatencyRatio: number;
}

export interface RuntimeRouteTelemetry {
  readonly runClass: RuntimeRunClass;
  readonly phase: string;
  readonly provider: string;
  readonly model?: string;
  readonly rerouted: boolean;
  readonly downgraded: boolean;
  readonly reason?: string;
}

export interface RuntimeRunBudgetLedger {
  readonly runClass: RuntimeRunClass;
  tokens: number;
  latencyMs: number;
  spendUnits: number;
  calls: number;
  reroutes: number;
  downgrades: number;
  ceilingBreaches: number;
  denialCount: number;
  lastProvider?: string;
  lastModel?: string;
}

export interface RuntimeEconomicsPolicy {
  readonly mode: RuntimeBudgetMode;
  readonly budgets: Readonly<Record<RuntimeRunClass, RuntimeRunBudget>>;
  readonly childFanoutSoftCap: number;
  readonly negativeDelegationMarginUnits: number;
  readonly negativeDelegationMarginTokens: number;
}

export interface RuntimeEconomicsState {
  readonly perRunClass: Record<RuntimeRunClass, RuntimeRunBudgetLedger>;
  readonly routes: RuntimeRouteTelemetry[];
  totalTokens: number;
  totalLatencyMs: number;
  totalSpendUnits: number;
  rerouteCount: number;
  downgradeCount: number;
  denialCount: number;
  budgetViolationCount: number;
}

export interface RuntimeBudgetPressure {
  readonly tokenRatio: number;
  readonly latencyRatio: number;
  readonly spendRatio: number;
  readonly hardExceeded: boolean;
  readonly shouldDowngrade: boolean;
}

export interface RuntimeRunBudgetSummary {
  readonly budget: RuntimeRunBudget;
  readonly usage: {
    readonly tokens: number;
    readonly latencyMs: number;
    readonly spendUnits: number;
    readonly calls: number;
    readonly reroutes: number;
    readonly downgrades: number;
    readonly ceilingBreaches: number;
    readonly denials: number;
  };
  readonly pressure: RuntimeBudgetPressure;
  readonly lastProvider?: string;
  readonly lastModel?: string;
}

export interface RuntimeEconomicsSummary {
  readonly mode: RuntimeBudgetMode;
  readonly totalTokens: number;
  readonly totalLatencyMs: number;
  readonly totalSpendUnits: number;
  readonly rerouteCount: number;
  readonly downgradeCount: number;
  readonly denialCount: number;
  readonly budgetViolationCount: number;
  readonly runClasses: Readonly<Record<RuntimeRunClass, RuntimeRunBudgetSummary>>;
  readonly routes: readonly RuntimeRouteTelemetry[];
}

export interface DelegationBudgetSnapshot {
  readonly mode: RuntimeBudgetMode;
  readonly childBudget: RuntimeRunBudget;
  readonly remainingTokens: number;
  readonly remainingLatencyMs: number;
  readonly remainingSpendUnits: number;
  readonly parentTokenRatio: number;
  readonly parentLatencyRatio: number;
  readonly parentSpendRatio: number;
  readonly childFanoutSoftCap: number;
  readonly negativeDelegationMarginUnits: number;
  readonly negativeDelegationMarginTokens: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeCeiling(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.floor(value));
}

export function mapPhaseToRunClass(phase: string): RuntimeRunClass {
  switch (phase) {
    case "planner":
    case "planner_synthesis":
      return "planner";
    case "planner_verifier":
    case "evaluator":
    case "evaluator_retry":
      return "verifier";
    default:
      return "executor";
  }
}

export function buildRuntimeEconomicsPolicy(params: {
  readonly sessionTokenBudget?: number;
  readonly plannerMaxTokens?: number;
  readonly requestTimeoutMs?: number;
  readonly childTimeoutMs?: number;
  readonly childTokenBudget?: number;
  readonly maxFanoutPerTurn?: number;
  readonly mode?: RuntimeBudgetMode;
}): RuntimeEconomicsPolicy {
  const sessionTokenBudget = normalizeCeiling(
    params.sessionTokenBudget ?? 120_000,
    16_384,
  );
  const plannerMaxTokens = normalizeCeiling(
    params.plannerMaxTokens ?? Math.max(2_048, Math.floor(sessionTokenBudget * 0.1)),
    512,
  );
  const requestTimeoutMs = normalizeCeiling(
    params.requestTimeoutMs ?? 120_000,
    10_000,
  );
  const childTimeoutMs = normalizeCeiling(
    params.childTimeoutMs ?? 120_000,
    10_000,
  );
  const childTokenBudget = normalizeCeiling(
    params.childTokenBudget ?? Math.floor(sessionTokenBudget * 0.2),
    8_192,
  );
  const maxFanoutPerTurn = normalizeCeiling(params.maxFanoutPerTurn ?? 4, 1);

  const plannerBudget: RuntimeRunBudget = {
    runClass: "planner",
    tokenCeiling: normalizeCeiling(
      Math.min(sessionTokenBudget, Math.max(plannerMaxTokens * 4, Math.floor(sessionTokenBudget * 0.28))),
      2_048,
    ),
    latencyCeilingMs: Math.min(requestTimeoutMs, Math.max(20_000, Math.floor(requestTimeoutMs * 0.45))),
    spendCeilingUnits: Math.max(6, Number((Math.max(plannerMaxTokens * 4, sessionTokenBudget * 0.18) / 1_000 * 1.35).toFixed(3))),
    downgradeTokenRatio: 0.82,
    downgradeSpendRatio: 0.72,
    downgradeLatencyRatio: 0.85,
  };

  const executorBudget: RuntimeRunBudget = {
    runClass: "executor",
    tokenCeiling: sessionTokenBudget,
    latencyCeilingMs: requestTimeoutMs,
    spendCeilingUnits: Math.max(10, Number((sessionTokenBudget / 1_000 * 0.95).toFixed(3))),
    downgradeTokenRatio: 0.88,
    downgradeSpendRatio: 0.78,
    downgradeLatencyRatio: 0.88,
  };

  const verifierBudget: RuntimeRunBudget = {
    runClass: "verifier",
    tokenCeiling: normalizeCeiling(
      Math.min(sessionTokenBudget, Math.max(plannerMaxTokens * 2, Math.floor(sessionTokenBudget * 0.16))),
      1_024,
    ),
    latencyCeilingMs: Math.min(requestTimeoutMs, Math.max(10_000, Math.floor(requestTimeoutMs * 0.25))),
    spendCeilingUnits: Math.max(4, Number((Math.max(plannerMaxTokens * 2, sessionTokenBudget * 0.1) / 1_000 * 1.1).toFixed(3))),
    downgradeTokenRatio: 0.75,
    downgradeSpendRatio: 0.68,
    downgradeLatencyRatio: 0.8,
  };

  const childBudget: RuntimeRunBudget = {
    runClass: "child",
    tokenCeiling: childTokenBudget,
    latencyCeilingMs: childTimeoutMs,
    spendCeilingUnits: Math.max(5, Number((childTokenBudget / 1_000 * 0.8).toFixed(3))),
    downgradeTokenRatio: 0.72,
    downgradeSpendRatio: 0.65,
    downgradeLatencyRatio: 0.75,
  };

  return {
    mode: params.mode ?? "enforce",
    budgets: {
      planner: plannerBudget,
      executor: executorBudget,
      verifier: verifierBudget,
      child: childBudget,
    },
    childFanoutSoftCap: Math.max(
      1,
      Math.min(maxFanoutPerTurn, Math.floor(childBudget.spendCeilingUnits / 2)),
    ),
    negativeDelegationMarginUnits: Number(
      Math.max(0.5, childBudget.spendCeilingUnits * 0.12).toFixed(3),
    ),
    negativeDelegationMarginTokens: Math.max(
      512,
      Math.floor(childBudget.tokenCeiling * 0.12),
    ),
  };
}

function createLedger(runClass: RuntimeRunClass): RuntimeRunBudgetLedger {
  return {
    runClass,
    tokens: 0,
    latencyMs: 0,
    spendUnits: 0,
    calls: 0,
    reroutes: 0,
    downgrades: 0,
    ceilingBreaches: 0,
    denialCount: 0,
  };
}

export function createRuntimeEconomicsState(): RuntimeEconomicsState {
  return {
    perRunClass: {
      planner: createLedger("planner"),
      executor: createLedger("executor"),
      verifier: createLedger("verifier"),
      child: createLedger("child"),
    },
    routes: [],
    totalTokens: 0,
    totalLatencyMs: 0,
    totalSpendUnits: 0,
    rerouteCount: 0,
    downgradeCount: 0,
    denialCount: 0,
    budgetViolationCount: 0,
  };
}

export function estimateSpendUnitsForUsage(params: {
  readonly provider: string;
  readonly model?: string;
  readonly usage: LLMUsage;
}): number {
  const model = params.model?.toLowerCase() ?? "";
  const provider = params.provider.toLowerCase();
  let perThousand = 0.9;
  if (provider === "ollama") {
    perThousand = 0.18;
  } else if (model.includes("reasoning") && !model.includes("non-reasoning")) {
    perThousand = 1.45;
  } else if (model.includes("non-reasoning") || model.includes("fast")) {
    perThousand = 0.7;
  }
  const promptUnits = (Math.max(0, params.usage.promptTokens) / 1_000) * perThousand;
  const completionUnits =
    (Math.max(0, params.usage.completionTokens) / 1_000) * perThousand * 1.15;
  return Number((promptUnits + completionUnits).toFixed(4));
}

export function getRuntimeBudgetPressure(
  policy: RuntimeEconomicsPolicy,
  state: RuntimeEconomicsState,
  runClass: RuntimeRunClass,
): RuntimeBudgetPressure {
  const budget = policy.budgets[runClass];
  const ledger = state.perRunClass[runClass];
  const tokenRatio = budget.tokenCeiling > 0
    ? clamp01(ledger.tokens / budget.tokenCeiling)
    : 0;
  const latencyRatio = budget.latencyCeilingMs > 0
    ? clamp01(ledger.latencyMs / budget.latencyCeilingMs)
    : 0;
  const spendRatio = budget.spendCeilingUnits > 0
    ? clamp01(ledger.spendUnits / budget.spendCeilingUnits)
    : 0;
  const hardExceeded =
    ledger.tokens >= budget.tokenCeiling ||
    ledger.latencyMs >= budget.latencyCeilingMs ||
    ledger.spendUnits >= budget.spendCeilingUnits;
  const shouldDowngrade =
    tokenRatio >= budget.downgradeTokenRatio ||
    latencyRatio >= budget.downgradeLatencyRatio ||
    spendRatio >= budget.downgradeSpendRatio;
  return {
    tokenRatio,
    latencyRatio,
    spendRatio,
    hardExceeded,
    shouldDowngrade,
  };
}

export function recordRuntimeModelCall(params: {
  readonly policy: RuntimeEconomicsPolicy;
  readonly state: RuntimeEconomicsState;
  readonly runClass: RuntimeRunClass;
  readonly provider: string;
  readonly model?: string;
  readonly usage: LLMUsage;
  readonly durationMs: number;
  readonly rerouted: boolean;
  readonly downgraded: boolean;
  readonly phase: string;
  readonly reason?: string;
}): void {
  const ledger = params.state.perRunClass[params.runClass];
  const spendUnits = estimateSpendUnitsForUsage({
    provider: params.provider,
    model: params.model,
    usage: params.usage,
  });
  ledger.tokens += Math.max(0, params.usage.totalTokens);
  ledger.latencyMs += Math.max(0, Math.floor(params.durationMs));
  ledger.spendUnits = Number((ledger.spendUnits + spendUnits).toFixed(4));
  ledger.calls += 1;
  if (params.rerouted) {
    ledger.reroutes += 1;
    params.state.rerouteCount += 1;
  }
  if (params.downgraded) {
    ledger.downgrades += 1;
    params.state.downgradeCount += 1;
  }
  ledger.lastProvider = params.provider;
  ledger.lastModel = params.model;
  params.state.totalTokens += Math.max(0, params.usage.totalTokens);
  params.state.totalLatencyMs += Math.max(0, Math.floor(params.durationMs));
  params.state.totalSpendUnits = Number(
    (params.state.totalSpendUnits + spendUnits).toFixed(4),
  );

  const pressure = getRuntimeBudgetPressure(params.policy, params.state, params.runClass);
  if (pressure.hardExceeded) {
    ledger.ceilingBreaches += 1;
    params.state.budgetViolationCount += 1;
  }
  params.state.routes.push({
    runClass: params.runClass,
    phase: params.phase,
    provider: params.provider,
    model: params.model,
    rerouted: params.rerouted,
    downgraded: params.downgraded,
    ...(params.reason ? { reason: params.reason } : {}),
  });
}

export function recordRuntimeDenial(
  state: RuntimeEconomicsState,
  runClass: RuntimeRunClass,
): void {
  state.denialCount += 1;
  state.perRunClass[runClass].denialCount += 1;
}

export function buildDelegationBudgetSnapshot(
  policy: RuntimeEconomicsPolicy,
  state: RuntimeEconomicsState,
): DelegationBudgetSnapshot {
  const childBudget = policy.budgets.child;
  const childLedger = state.perRunClass.child;
  const parentPressure = getRuntimeBudgetPressure(policy, state, "executor");
  return {
    mode: policy.mode,
    childBudget,
    remainingTokens: Math.max(0, childBudget.tokenCeiling - childLedger.tokens),
    remainingLatencyMs: Math.max(
      0,
      childBudget.latencyCeilingMs - childLedger.latencyMs,
    ),
    remainingSpendUnits: Number(
      Math.max(0, childBudget.spendCeilingUnits - childLedger.spendUnits).toFixed(4),
    ),
    parentTokenRatio: parentPressure.tokenRatio,
    parentLatencyRatio: parentPressure.latencyRatio,
    parentSpendRatio: parentPressure.spendRatio,
    childFanoutSoftCap: policy.childFanoutSoftCap,
    negativeDelegationMarginUnits: policy.negativeDelegationMarginUnits,
    negativeDelegationMarginTokens: policy.negativeDelegationMarginTokens,
  };
}

export function buildRuntimeEconomicsSummary(
  policy: RuntimeEconomicsPolicy,
  state: RuntimeEconomicsState,
): RuntimeEconomicsSummary {
  return {
    mode: policy.mode,
    totalTokens: state.totalTokens,
    totalLatencyMs: state.totalLatencyMs,
    totalSpendUnits: Number(state.totalSpendUnits.toFixed(4)),
    rerouteCount: state.rerouteCount,
    downgradeCount: state.downgradeCount,
    denialCount: state.denialCount,
    budgetViolationCount: state.budgetViolationCount,
    runClasses: {
      planner: buildRunBudgetSummary(policy, state, "planner"),
      executor: buildRunBudgetSummary(policy, state, "executor"),
      verifier: buildRunBudgetSummary(policy, state, "verifier"),
      child: buildRunBudgetSummary(policy, state, "child"),
    },
    routes: state.routes.slice(),
  };
}

function buildRunBudgetSummary(
  policy: RuntimeEconomicsPolicy,
  state: RuntimeEconomicsState,
  runClass: RuntimeRunClass,
): RuntimeRunBudgetSummary {
  const budget = policy.budgets[runClass];
  const ledger = state.perRunClass[runClass];
  return {
    budget,
    usage: {
      tokens: ledger.tokens,
      latencyMs: ledger.latencyMs,
      spendUnits: Number(ledger.spendUnits.toFixed(4)),
      calls: ledger.calls,
      reroutes: ledger.reroutes,
      downgrades: ledger.downgrades,
      ceilingBreaches: ledger.ceilingBreaches,
      denials: ledger.denialCount,
    },
    pressure: getRuntimeBudgetPressure(policy, state, runClass),
    lastProvider: ledger.lastProvider,
    lastModel: ledger.lastModel,
  };
}
