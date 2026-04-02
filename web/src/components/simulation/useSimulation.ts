/**
 * React hook for bridge-owned simulation state.
 *
 * Connects to the Concordia bridge's per-simulation APIs:
 * 1. Server-sent events for replay + live event streaming
 * 2. Bridge HTTP for agent state and lifecycle control
 *
 * Phase 3 of the CONCORDIA_TODO.MD implementation plan.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";

export interface SimulationCheckpointStatus {
  checkpoint_id: string;
  checkpoint_path: string;
  schema_version: number;
  created_at: number;
  step: number;
  source: string;
  simulation_id: string;
  lineage_id: string | null;
  world_id: string;
  workspace_id: string;
  runtime_cursor: {
    current_step: number;
    start_step: number;
    max_steps: number | null;
    last_step_outcome: string | null;
  };
}

export interface SimulationSummary {
  simulation_id: string;
  world_id: string;
  workspace_id: string;
  lineage_id: string | null;
  parent_simulation_id: string | null;
  status:
    | "launching"
    | "running"
    | "paused"
    | "stopping"
    | "stopped"
    | "finished"
    | "failed"
    | "archived"
    | "deleted";
  reason: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
  agent_ids: string[];
  current_alias: boolean;
  pid: number | null;
  last_completed_step: number;
  last_step_outcome: string | null;
  replay_event_count: number;
  checkpoint: SimulationCheckpointStatus | null;
}

export interface SimulationRecord extends SimulationSummary {
  agents: Array<{
    agent_id: string;
    agent_name: string;
    personality: string;
    goal: string;
  }>;
  premise: string;
  max_steps: number | null;
  gm_model?: string;
  gm_provider?: string;
}

export interface SimulationEvent {
  event_id?: string;
  type: string;
  step: number;
  timestamp?: number;
  simulation_id: string;
  world_id: string;
  workspace_id: string;
  agent_name?: string;
  content?: string;
  action_spec?: Record<string, unknown> | null;
  resolved_event?: string | null;
  scene?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AgentState {
  identity: {
    name: string;
    personality: string;
    learnedTraits: string[];
    beliefs: Record<string, { belief: string; confidence: number }>;
  } | null;
  memoryCount: number;
  recentMemories: Array<{ content: string; role: string; timestamp: number }>;
  relationships: Array<{
    otherAgentId: string;
    sentiment: number;
    interactionCount: number;
  }>;
  worldFacts: Array<{ content: string; observedBy: string; confirmations: number }>;
  turnCount: number;
  lastAction: string | null;
}

export interface SimulationStatus {
  simulation_id: string;
  world_id: string;
  workspace_id: string;
  status:
    | "launching"
    | "running"
    | "paused"
    | "stopping"
    | "stopped"
    | "finished"
    | "failed"
    | "archived"
    | "deleted";
  reason: string | null;
  error: string | null;
  step: number;
  max_steps: number | null;
  running: boolean;
  paused: boolean;
  agent_count: number;
  started_at: number | null;
  ended_at: number | null;
  updated_at: number;
  last_step_outcome: string | null;
  terminal_reason: string | null;
  checkpoint: SimulationCheckpointStatus | null;
}

export type SimulationTransportState =
  | "idle"
  | "replay-hydrating"
  | "live"
  | "reconnecting"
  | "disconnected";

export interface SimulationState {
  events: SimulationEvent[];
  agentStates: Record<string, AgentState>;
  status: SimulationStatus;
  connected: boolean;
  error: string | null;
  notFound: boolean;
  transportState: SimulationTransportState;
}

type SimAction =
  | { type: "RESET" }
  | { type: "ADD_EVENT"; event: SimulationEvent }
  | { type: "SET_AGENT_STATE"; agentId: string; state: AgentState }
  | { type: "SET_STATUS"; status: SimulationStatus }
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_NOT_FOUND"; notFound: boolean }
  | { type: "SET_TRANSPORT_STATE"; transportState: SimulationTransportState };

const initialStatus: SimulationStatus = {
  simulation_id: "",
  world_id: "",
  workspace_id: "",
  status: "launching",
  reason: null,
  error: null,
  step: 0,
  max_steps: null,
  running: false,
  paused: false,
  agent_count: 0,
  started_at: null,
  ended_at: null,
  updated_at: 0,
  last_step_outcome: null,
  terminal_reason: null,
  checkpoint: null,
};

const initialState: SimulationState = {
  events: [],
  agentStates: {},
  status: initialStatus,
  connected: false,
  error: null,
  notFound: false,
  transportState: "idle",
};

function reducer(state: SimulationState, action: SimAction): SimulationState {
  switch (action.type) {
    case "RESET":
      return initialState;
    case "ADD_EVENT":
      return {
        ...state,
        events: [...state.events.slice(-999), action.event],
      };
    case "SET_AGENT_STATE":
      return {
        ...state,
        agentStates: { ...state.agentStates, [action.agentId]: action.state },
      };
    case "SET_STATUS":
      return {
        ...state,
        status: action.status,
        notFound: false,
      };
    case "SET_CONNECTED":
      return { ...state, connected: action.connected };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_NOT_FOUND":
      return { ...state, notFound: action.notFound };
    case "SET_TRANSPORT_STATE":
      return { ...state, transportState: action.transportState };
    default:
      return state;
  }
}

export function useSimulation(config: {
  simulationId?: string | null;
  bridgeUrl?: string;
  agentIds?: string[];
  pollIntervalMs?: number;
  active?: boolean;
}) {
  const {
    simulationId = null,
    bridgeUrl = "http://localhost:3200",
    agentIds = [],
    pollIntervalMs = 2000,
    active = true,
  } = config;

  const [state, dispatch] = useReducer(reducer, initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    lastEventIdRef.current = null;
    seenEventIdsRef.current.clear();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    dispatch({ type: "RESET" });
  }, [simulationId]);

  useEffect(() => {
    if (!simulationId) {
      dispatch({ type: "SET_CONNECTED", connected: false });
      dispatch({ type: "SET_TRANSPORT_STATE", transportState: "idle" });
      dispatch({ type: "SET_NOT_FOUND", notFound: false });
      return;
    }
    if (!active) {
      dispatch({ type: "SET_CONNECTED", connected: false });
      dispatch({ type: "SET_TRANSPORT_STATE", transportState: "disconnected" });
      return;
    }
    dispatch({ type: "SET_TRANSPORT_STATE", transportState: "replay-hydrating" });
  }, [active, simulationId]);

  useEffect(() => {
    if (!simulationId || !active) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let disposed = false;
    let reconnectDelayMs = 1000;

    const connect = () => {
      if (disposed) {
        return;
      }

      const streamUrl = new URL(
        `/simulations/${encodeURIComponent(simulationId)}/events/stream`,
        bridgeUrl,
      );
      if (lastEventIdRef.current) {
        streamUrl.searchParams.set("cursor", lastEventIdRef.current);
      }

      const source = new EventSource(streamUrl.toString());
      eventSourceRef.current = source;

      source.onopen = () => {
        if (disposed) {
          return;
        }
        reconnectDelayMs = 1000;
        dispatch({ type: "SET_CONNECTED", connected: true });
        dispatch({ type: "SET_ERROR", error: null });
        dispatch({ type: "SET_TRANSPORT_STATE", transportState: "live" });
      };

      source.onerror = () => {
        dispatch({ type: "SET_CONNECTED", connected: false });
        dispatch({ type: "SET_TRANSPORT_STATE", transportState: "reconnecting" });
        source.close();
        eventSourceRef.current = null;
        if (disposed) {
          return;
        }
        reconnectTimerRef.current = setTimeout(connect, reconnectDelayMs);
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
      };

      source.onmessage = (message) => {
        if (disposed) {
          return;
        }
        try {
          const event = JSON.parse(message.data) as SimulationEvent;
          const eventId = event.event_id ?? message.lastEventId ?? null;
          if (eventId) {
            if (seenEventIdsRef.current.has(eventId)) {
              return;
            }
            seenEventIdsRef.current.add(eventId);
            lastEventIdRef.current = eventId;
            event.event_id = eventId;
          }
          dispatch({ type: "ADD_EVENT", event });
        } catch {
          // Ignore malformed stream payloads.
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [active, bridgeUrl, simulationId]);

  useEffect(() => {
    if (!simulationId || !active) {
      return;
    }

    let disposed = false;
    const controllers = new Set<AbortController>();

    const pollStatus = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const resp = await fetch(
          `${bridgeUrl}/simulations/${encodeURIComponent(simulationId)}/status`,
          { signal: controller.signal },
        );
        if (resp.status === 404) {
          dispatch({ type: "SET_NOT_FOUND", notFound: true });
          dispatch({ type: "SET_CONNECTED", connected: false });
          dispatch({ type: "SET_TRANSPORT_STATE", transportState: "disconnected" });
          return;
        }
        if (!resp.ok || disposed) {
          return;
        }
        const status = (await resp.json()) as SimulationStatus;
        dispatch({ type: "SET_STATUS", status });
      } catch {
        if (!disposed) {
          dispatch({ type: "SET_CONNECTED", connected: false });
        }
      } finally {
        controllers.delete(controller);
      }
    };

    void pollStatus();
    const interval = setInterval(() => {
      void pollStatus();
    }, pollIntervalMs);

    return () => {
      disposed = true;
      clearInterval(interval);
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    };
  }, [active, bridgeUrl, pollIntervalMs, simulationId]);

  useEffect(() => {
    if (!simulationId || !active || agentIds.length === 0) {
      return;
    }

    let disposed = false;
    const controllers = new Set<AbortController>();

    const pollAgentStates = async () => {
      await Promise.all(agentIds.map(async (agentId) => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const resp = await fetch(
            `${bridgeUrl}/simulations/${encodeURIComponent(simulationId)}/agents/${encodeURIComponent(agentId)}/state`,
            { signal: controller.signal },
          );
          if (!resp.ok || disposed) {
            return;
          }
          const agentState = (await resp.json()) as AgentState;
          dispatch({ type: "SET_AGENT_STATE", agentId, state: agentState });
        } catch {
          // Non-blocking
        } finally {
          controllers.delete(controller);
        }
      }));
    };

    void pollAgentStates();
    const interval = setInterval(() => {
      void pollAgentStates();
    }, pollIntervalMs);

    return () => {
      disposed = true;
      clearInterval(interval);
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    };
  }, [active, agentIds, bridgeUrl, pollIntervalMs, simulationId]);

  const sendControlCommand = useCallback(async (command: "play" | "pause" | "step" | "stop") => {
    if (!simulationId) {
      return;
    }
    try {
      const resp = await fetch(
        `${bridgeUrl}/simulations/${encodeURIComponent(simulationId)}/${command}`,
        { method: "POST" },
      );
      if (!resp.ok) {
        throw new Error(`Control command failed: ${resp.status}`);
      }
      const payload = await resp.json() as { simulation?: SimulationStatus };
      if (payload.simulation) {
        dispatch({ type: "SET_STATUS", status: payload.simulation });
      }
      dispatch({ type: "SET_ERROR", error: null });
    } catch (error) {
      dispatch({
        type: "SET_ERROR",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [bridgeUrl, simulationId]);

  const play = useCallback(async () => {
    await sendControlCommand("play");
  }, [sendControlCommand]);

  const pause = useCallback(async () => {
    await sendControlCommand("pause");
  }, [sendControlCommand]);

  const step = useCallback(async () => {
    await sendControlCommand("step");
  }, [sendControlCommand]);

  const stop = useCallback(async () => {
    await sendControlCommand("stop");
  }, [sendControlCommand]);

  return { state, play, pause, step, stop };
}
