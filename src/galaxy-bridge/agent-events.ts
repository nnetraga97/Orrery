// The agent's work in the scene: each tool call becomes the provider-neutral v1 event the copied cannon understands
// (galaxy/viewer/agents/agent-events.js; reference/desktop-app/docs/agent-integration.md). Reads and searches fly
// ships to their files; an accepted edit fires the cannon at the file, and the planet rebuilds from the edited text
// (the workspace is the copied code's source override). Questions raise a beacon; the replay a probe.
import { galaxyState } from './galaxy-session.js';

type Action = 'read' | 'search' | 'edit' | 'create' | 'question' | 'debug' | 'task' | 'ui' | 'other';
const ACTIONS: Record<string, Action> = {
  read_file: 'read',
  list_files: 'search',
  search: 'search',
  replace_in_file: 'edit',
  write_file: 'edit',
  ask_user: 'question',
  run_replay: 'debug',
  update_plan: 'task',
  show_user: 'ui',
};

/** The files a tool call is about. */
function filesOf(name: string, input: Record<string, unknown>): string[] {
  const path = (input.path ?? input.file) as string | undefined;
  if (name === 'search' || name === 'list_files') return path && galaxyState.nodes.some(n => n.path === path) ? [path] : [];
  return path ? [path] : [];
}

export function createAgentEvents(provider: string) {
  let session = '',
    turn = 0,
    seq = 0;
  const ingest = (type: string, payload: Record<string, unknown>, operationId?: string) => {
    const cannon = (galaxyState.view as { cannon?: { ingest(ev: unknown): void } } | null)?.cannon;
    if (!cannon || !session) return;
    try {
      cannon.ingest({
        version: 1,
        id: `${session}.${++seq}`,
        timestamp: Date.now(),
        provider,
        sessionId: session,
        workspaceRoot: `/projects/${galaxyState.dataset ?? 'project'}`,
        turnId: `turn${turn}`,
        ...(operationId ? { operationId } : {}),
        type,
        payload,
      });
    } catch (e) {
      // The scene's presentation never stops the agent.
      console.warn('[orrery] the cannon could not show an agent event', e);
    }
  };
  return {
    /** A new chat (or a restored one) starts a session. */
    session(id: string, displayName: string) {
      session = id.replace(/[^\w.-]/g, '_').slice(0, 120);
      ingest('session.started', { displayName });
    },
    turnStarted(text: string) {
      turn++;
      ingest('turn.started', { text: text.slice(0, 2000) });
    },
    toolStarted(id: string, name: string, input: Record<string, unknown>) {
      const action = ACTIONS[name] ?? 'other';
      // An edit fires only once accepted (toolStarted is called when it runs, after approval).
      ingest('operation.started', { action, tool: name, label: name.replace(/_/g, ' '), files: filesOf(name, input) }, id);
    },
    toolFinished(id: string, name: string, input: Record<string, unknown>, ok: boolean) {
      ingest('operation.finished', { ok, action: ACTIONS[name] ?? 'other', tool: name, files: filesOf(name, input) }, id);
    },
    message(role: 'assistant' | 'reasoning' | 'error', text: string) {
      if (text.trim()) ingest('message', { role, text: text.slice(0, 4000) });
    },
    /** The tokens the last request filled (no model capacity is guessed: the gauge shows what was reported). */
    usage(context: number) {
      ingest('usage', { context });
    },
    turnFinished(outcome: 'completed' | 'failed' | 'interrupted') {
      ingest('turn.finished', { outcome });
    },
    /** Rebuilds a file's planet from its edited text. */
    refresh(path: string) {
      const view = galaxyState.view as { update?(o: { refresh: Set<string> }): void } | null;
      try {
        view?.update?.({ refresh: new Set([path]) });
      } catch (e) {
        console.warn('[orrery] could not rebuild', path, e);
      }
    },
  };
}
export type AgentEvents = ReturnType<typeof createAgentEvents>;
