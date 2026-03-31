/**
 * Main simulation viewer — composes all sub-components.
 * Phase 4 of CONCORDIA_TODO.MD.
 */

import { useSimulation } from "./useSimulation";
import { SimulationControls } from "./SimulationControls";
import { AgentCard } from "./AgentCard";
import { EventTimeline } from "./EventTimeline";
import { WorldStatePanel } from "./WorldStatePanel";

interface SimulationViewerProps {
  eventWsUrl?: string;
  bridgeUrl?: string;
  controlUrl?: string;
  agentIds?: string[];
}

export function SimulationViewer({
  eventWsUrl = "ws://localhost:3201",
  bridgeUrl = "http://localhost:3200",
  controlUrl = "http://localhost:3202",
  agentIds = [],
}: SimulationViewerProps) {
  const { state, play, pause, step, stop } = useSimulation({
    eventWsUrl,
    bridgeUrl,
    controlUrl,
    agentIds,
  });

  return (
    <div className="flex flex-col h-screen bg-black text-green-400 font-mono">
      {/* Controls */}
      <SimulationControls
        status={state.status}
        onPlay={play}
        onPause={pause}
        onStep={step}
        onStop={stop}
      />

      {/* Connection status */}
      {!state.connected && (
        <div className="bg-red-900 text-red-300 text-xs px-2 py-1 text-center">
          Disconnected from event stream — waiting for reconnection...
        </div>
      )}
      {state.error && (
        <div className="bg-yellow-900 text-yellow-300 text-xs px-2 py-1 text-center">
          {state.error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Agent cards */}
        <div className="w-64 border-r border-green-800 overflow-y-auto p-2">
          <div className="text-green-600 text-xs mb-2 font-bold">
            AGENTS ({Object.keys(state.agentStates).length})
          </div>
          {Object.entries(state.agentStates).map(([agentId, agentState]) => (
            <AgentCard key={agentId} agentId={agentId} agent={agentState} />
          ))}
          {Object.keys(state.agentStates).length === 0 && (
            <div className="text-green-800 text-xs">
              No agents connected yet.
              {agentIds.length > 0
                ? ` Polling for: ${agentIds.join(", ")}`
                : " Set agentIds prop to poll agent state."}
            </div>
          )}
        </div>

        {/* Right: Event timeline */}
        <div className="flex-1 flex flex-col">
          <EventTimeline events={state.events} />
        </div>
      </div>

      {/* Bottom: World state */}
      <WorldStatePanel
        agentStates={state.agentStates}
        worldId={state.status.world_id}
      />
    </div>
  );
}
