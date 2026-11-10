import { useSyncExternalStore } from 'react';
import { agentShowStore, dismissAgentShow, followAgentShow } from '../agent-show.ts';
import '../../styles/agent-show.css';

const AGENTS = { nemotron: 'Nemotron', codex: 'Codex', claude: 'Claude' };

export function AgentShow() {
  const { payload, offered, detail } = useSyncExternalStore(agentShowStore.subscribe, agentShowStore.get);
  if (!payload) return null;
  return (
    <aside id="agentShow" role="status" aria-live="polite" aria-atomic="true" data-offered={offered}>
      <div>
        <strong>
          {AGENTS[payload.provider]} · {payload.file}:{payload.line ?? 1}
        </strong>
        <p>{payload.message}</p>
        {detail && <small>{detail}</small>}
      </div>
      {offered && <button onClick={followAgentShow}>Show me</button>}
      <button onClick={dismissAgentShow}>Dismiss</button>
    </aside>
  );
}
