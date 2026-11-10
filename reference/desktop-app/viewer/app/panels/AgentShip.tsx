import { useSyncExternalStore } from 'react';
import { debugStore, dismissAgentShip, followAgentShip } from '../debug.ts';
import '../../styles/agent-show.css';

// Offers the agent's debug run as a ship the user can follow; for users who follow the agent it is followed already.
export function AgentShip() {
  const { agentShip, runtime: r } = useSyncExternalStore(debugStore.subscribe, debugStore.get);
  if (!agentShip || agentShip.session !== r.session) return null;
  const target = r.configuration || r.entry || 'the project';
  const top = r.frames[0];
  const where =
    r.status === 'paused' && top
      ? ` · paused at ${top.file}:${top.line}`
      : r.trace
        ? ` · ${r.trace.file}:${r.trace.line}`
        : '';
  const active = ['starting', 'running', 'paused'].includes(r.status);
  const verb = active ? 'is debugging' : 'debugged';
  return (
    <aside id="agentShip" role="status" aria-live="polite" data-following={agentShip.following}>
      <div>
        <strong>
          {r.agent || 'The agent'} {verb} {target}
        </strong>
        <p>
          {agentShip.following
            ? 'Following its execution ship'
            : active
              ? 'Its execution ship is flying'
              : 'Its execution ship stopped'}
          {where}
          {r.exception ? ` · ${r.exception}` : ''}
        </p>
      </div>
      {!agentShip.following && <button onClick={followAgentShip}>Follow ship</button>}
      <button onClick={dismissAgentShip}>{agentShip.following ? 'Stop following' : 'Dismiss'}</button>
    </aside>
  );
}
