// Provider-neutral events -> cannon presentation. Also reads existing local histories and fixtures.
import { workspaceFileEffect } from './workspace-effects.js';

const ammo = {
  read: 'tracer',
  search: 'flak',
  edit: 'shell',
  create: 'siege',
  delete: 'shell',
  command: 'mortar',
  delegate: 'drone',
  web: 'beam',
  task: 'belt',
  load: 'load',
  question: 'beacon',
  other: 'station',
  artifact: 'factory',
  build: 'mortar',
  test: 'mortar',
  repository: 'mortar',
  ui: 'station',
  transfer: 'ship',
  debug: 'probe',
};
function toVisual(e) {
  if (!e.type || e.version !== 1) return e; // Stored pre-v1 histories remain readable.
  const p = e.payload || {},
    parent = e.parentOperationId || e.attribution?.parentOperationId;
  const identity = {
    ...e,
    source: e.source,
    agent: e.agentId
      ? `${e.provider}:${e.rootSessionId || e.sessionId}:agent:${e.agentId}`
      : parent
        ? `${e.provider}:${e.sessionId}:${e.turnId}:${parent}`
        : null,
    childAgent: !!(e.agentId && e.rootSessionId),
  };
  const toolId = e.operationId ? `${e.provider}:${e.sessionId}:${e.turnId}:${e.operationId}` : null;
  switch (e.type) {
    case 'agent.started':
    case 'agent.updated':
    case 'agent.finished':
      return {
        ...identity,
        ...p,
        kind: e.type === 'agent.finished' ? 'drone-dock' : 'drone-launch',
        toolId: identity.agent,
        subagent: true,
      };
    case 'session.started':
      return { ...identity, kind: 'session', displayName: p.displayName || e.provider };
    case 'session.ended':
      return { ...identity, kind: 'session-ended' };
    case 'turn.started':
      return { ...identity, kind: 'prompt', text: p.text || 'Agent turn started' };
    case 'turn.finished':
      return {
        ...identity,
        kind: p.outcome === 'interrupted' ? 'interrupt' : 'turn-end',
        ok: p.outcome === 'completed',
        subtype: p.outcome,
        ...p,
      };
    case 'operation.started':
      return {
        ...identity,
        ...p,
        kind: 'fire',
        toolId,
        tool: p.tool || p.action,
        ammo: ['transfer', 'debug'].includes(p.action) && !(p.from && p.to) ? 'station' : ammo[p.action] || 'station',
        viaDisk: ['edit', 'create', 'delete'].includes(p.action) && ['extension', 'runner'].includes(e.source),
        files: p.files || [],
        label: p.label || p.tool || p.action,
      };
    case 'operation.updated':
      return { ...identity, ...p, kind: 'job-update', toolId };
    case 'question.resolved':
      return { ...identity, ...p, kind: 'resolve', toolId, ok: p.state === 'answered', action: 'question' };
    case 'evidence.updated':
      return { ...identity, ...p, kind: 'evidence-update', files: [p.path] };
    case 'operation.finished':
      if (p.awaitingAnswer) return { ...identity, ...p, kind: 'question-wait', toolId };
      return {
        ...identity,
        ...p,
        kind: 'resolve',
        toolId,
        tool: p.tool || p.action,
        ammo: ['transfer', 'debug'].includes(p.action) && !(p.from && p.to) ? 'station' : ammo[p.action] || 'station',
        viaDisk: ['edit', 'create', 'delete'].includes(p.action) && ['extension', 'runner'].includes(e.source),
        files: p.files || [],
      };
    case 'message':
      return {
        ...identity,
        kind: p.role === 'reasoning' ? 'thinking' : p.role === 'error' ? 'error' : 'text',
        text: p.text || '',
      };
    case 'usage':
      return { ...identity, ...p, kind: 'usage' };
    case 'attention':
      return { ...identity, ...p, kind: p.reason === 'compact' ? 'compact' : 'stall' };
    case 'file.changed':
      return {
        ...identity,
        ...p,
        kind: e.attribution?.confidence === 'correlated' || workspaceFileEffect(p) ? 'file-change' : 'workspace-change',
        workspace: e.attribution?.confidence !== 'correlated',
        toolId: e.attribution?.operationId
          ? `${e.attribution.provider}:${e.attribution.sessionId}:${e.attribution.turnId}:${e.attribution.operationId}`
          : null,
        files: [p.path],
      };
    case 'entity.created':
      return {
        ...identity,
        ...p,
        kind:
          e.attribution?.confidence === 'correlated' || workspaceFileEffect(p) ? 'entity-created' : 'workspace-change',
        workspace: e.attribution?.confidence !== 'correlated',
        toolId: e.attribution?.operationId
          ? `${e.attribution.provider}:${e.attribution.sessionId}:${e.attribution.turnId}:${e.attribution.operationId}`
          : null,
        created: true,
        files: [p.path],
      };
    case 'entity.deleted':
      return { ...identity, ...p, kind: 'entity-deleted' };
    default:
      return null;
  }
}
export const AgentEvents = { toVisual, ammo };
