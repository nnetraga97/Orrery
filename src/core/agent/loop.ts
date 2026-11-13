// The agent loop as a pure reducer. It keeps the conversation append-only: each assistant message is stored exactly as
// it arrived, and every tool call it holds is answered, in one user message with all the results, before the model is
// called again. It never runs the tools of a message cut off (max_tokens) or refused; their calls are answered with an
// error so the history stays valid. Stopping answers any open calls the same way. A steer is delivered after the
// current results; a message sent while the turn runs is queued until it ends. The reducer returns effects for the
// agent system to carry out: call the model, run a tool, ask for approval, ask the user. A failed turn can be tried
// again: the model is called once more with the same conversation.
import type { Mode, Permission } from '../chat/composer.ts';
import { needsApproval } from './permissions.ts';
import { validateInput } from './tools.ts';
import { toolUses } from './wire.ts';
import type { Block, Message, StreamEvent, ToolResultBlock } from './wire.ts';

export type CallState = 'running' | 'approval' | 'question' | 'done';
export type PendingCall = { id: string; name: string; input: unknown; state: CallState; result?: ToolResultBlock };
export type LoopStatus = 'idle' | 'calling' | 'tools' | 'stopped' | 'failed';
export type LoopState = {
  messages: Message[];
  pending: PendingCall[];
  status: LoopStatus;
  /** Said while the turn runs, to go in with the next tool results. */
  steer: string[];
  /** Sent while the turn runs, to send when it ends. */
  queue: string[];
  permission: Permission;
  mode: Mode;
  error: string | null;
};
export type TurnOutcome = 'completed' | 'stopped' | 'failed' | 'refused' | 'truncated';
export type LoopEvent =
  | { type: 'userSaid'; text: string }
  | { type: 'stream'; event: StreamEvent }
  | { type: 'toolFinished'; id: string; content: string; isError?: boolean }
  | { type: 'approved'; id: string }
  | { type: 'declined'; id: string }
  | { type: 'answered'; id: string; response: unknown }
  | { type: 'stop' }
  | { type: 'retry' }
  | { type: 'steer'; text: string }
  | { type: 'settings'; permission: Permission; mode: Mode };
export type LoopEffect =
  | { kind: 'callModel'; messages: Message[] }
  | { kind: 'cancelModel' }
  | { kind: 'runTool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'askApproval'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'askUser'; id: string; input: Record<string, unknown> }
  | { kind: 'turnEnded'; outcome: TurnOutcome; reason?: string };
export type LoopStep = { state: LoopState; effects: LoopEffect[] };

export const DECLINED = 'The user declined this change. Do not send it again as it is. If you do not know what they want instead, ask with ask_user.';
export const STOPPED = 'Stopped by the user before this ran.';
/** A tool already running when the user stopped: it may have finished its work. */
export const STOPPED_RUNNING = 'Stopped by the user while this was running; it may have completed.';
export const NOT_RUN = (why: string) => `Not run: ${why}`;

export const initialLoop = (over: Partial<LoopState> = {}): LoopState => ({
  messages: [],
  pending: [],
  status: 'idle',
  steer: [],
  queue: [],
  permission: 'workspace',
  mode: 'work',
  error: null,
  ...over,
});

const busy = (s: LoopState) => s.status === 'calling' || s.status === 'tools';
const result = (toolUseId: string, content: string, isError = false): ToolResultBlock => ({ type: 'tool_result', toolUseId, content, isError });

/** Adds a user message, joining it to a trailing user message so the conversation keeps alternating. */
function withUser(messages: Message[], blocks: Block[]): Message[] {
  const last = messages[messages.length - 1];
  if (last?.role === 'user') return [...messages.slice(0, -1), { role: 'user', blocks: [...last.blocks, ...blocks] }];
  return [...messages, { role: 'user', blocks }];
}
const text = (t: string): Block => ({ type: 'text', text: t });

function call(state: LoopState, blocks: Block[]): LoopStep {
  const messages = withUser(state.messages, blocks);
  return { state: { ...state, messages, status: 'calling', pending: [], error: null }, effects: [{ kind: 'callModel', messages }] };
}

/** The turn is over: steer or queued text keeps it going; otherwise the loop rests. */
function endTurn(state: LoopState, outcome: TurnOutcome, effects: LoopEffect[] = [], reason?: string): LoopStep {
  if (outcome === 'completed' && state.steer.length) {
    const step = call({ ...state, steer: [] }, state.steer.map(text));
    return { state: step.state, effects: [...effects, ...step.effects] };
  }
  if (outcome === 'completed' && state.queue.length) {
    const [next, ...rest] = state.queue;
    const step = call({ ...state, queue: rest }, [text(next)]);
    return { state: step.state, effects: [...effects, { kind: 'turnEnded', outcome }, ...step.effects] };
  }
  const status = outcome === 'stopped' ? 'stopped' : outcome === 'failed' ? 'failed' : 'idle';
  return { state: { ...state, status, pending: [] }, effects: [...effects, { kind: 'turnEnded', outcome, ...(reason ? { reason } : {}) }] };
}

/** Once every call has its result: one user message with all of them (and any steer), then the model again. */
function continueIfDone(state: LoopState, effects: LoopEffect[]): LoopStep {
  if (state.status !== 'tools' || state.pending.some(p => p.state !== 'done')) return { state, effects };
  const blocks: Block[] = [...state.pending.map(p => p.result!), ...state.steer.map(text)];
  const step = call({ ...state, steer: [] }, blocks);
  return { state: step.state, effects: [...effects, ...step.effects] };
}

function finish(state: LoopState, id: string, block: ToolResultBlock): LoopState {
  return { ...state, pending: state.pending.map(p => (p.id === id ? { ...p, state: 'done', result: block } : p)) };
}

function received(state: LoopState, message: Message, stopReason: string): LoopStep {
  // Stored exactly as received.
  const messages = [...state.messages, message];
  const uses = toolUses(message);
  const next = { ...state, messages };
  if (stopReason === 'refusal' || stopReason === 'max_tokens') {
    const why = stopReason === 'refusal' ? 'the reply was refused.' : 'the reply was cut off.';
    const answered = uses.length ? withUser(messages, uses.map(u => result(u.id, NOT_RUN(why), true))) : messages;
    return endTurn({ ...next, messages: answered }, stopReason === 'refusal' ? 'refused' : 'truncated');
  }
  if (!uses.length) return endTurn(next, 'completed');
  const effects: LoopEffect[] = [];
  const pending: PendingCall[] = uses.map(u => {
    const checked = validateInput(u.name, u.input);
    if (!checked.ok) return { id: u.id, name: u.name, input: u.input, state: 'done', result: result(u.id, checked.error, true) };
    const decision = needsApproval(u.name, state.permission, state.mode);
    if (decision.run === 'refuse') return { id: u.id, name: u.name, input: u.input, state: 'done', result: result(u.id, decision.reason, true) };
    if (decision.run === 'approve') {
      effects.push({ kind: 'askApproval', id: u.id, name: u.name, input: checked.input });
      return { id: u.id, name: u.name, input: u.input, state: 'approval' };
    }
    if (u.name === 'ask_user') {
      effects.push({ kind: 'askUser', id: u.id, input: checked.input });
      return { id: u.id, name: u.name, input: u.input, state: 'question' };
    }
    effects.push({ kind: 'runTool', id: u.id, name: u.name, input: checked.input });
    return { id: u.id, name: u.name, input: u.input, state: 'running' };
  });
  return continueIfDone({ ...next, status: 'tools', pending }, effects);
}

export function loopStep(state: LoopState, event: LoopEvent): LoopStep {
  const same = { state, effects: [] as LoopEffect[] };
  const open = (id: string, want: CallState) => state.status === 'tools' && state.pending.some(p => p.id === id && p.state === want);
  switch (event.type) {
    case 'userSaid':
      if (!event.text.trim()) return same;
      if (busy(state)) return { state: { ...state, queue: [...state.queue, event.text] }, effects: [] };
      return call(state, [text(event.text)]);
    case 'steer':
      if (!event.text.trim()) return same;
      if (busy(state)) return { state: { ...state, steer: [...state.steer, event.text] }, effects: [] };
      return call(state, [text(event.text)]);
    case 'settings':
      return { state: { ...state, permission: event.permission, mode: event.mode }, effects: [] };
    case 'stream': {
      const e = event.event;
      if (state.status !== 'calling') return same;
      if (e.type === 'message') return received(state, e.message, e.stopReason);
      if (e.type === 'error') return endTurn({ ...state, error: e.message }, 'failed', [], e.code);
      return same;
    }
    case 'toolFinished':
      // A call waiting for approval finishes too when its preview fails (the edit cannot apply): the model gets the
      // error instead of a card nobody could approve.
      if (!open(event.id, 'running') && !(event.isError && open(event.id, 'approval'))) return same;
      return continueIfDone(finish(state, event.id, result(event.id, event.content, !!event.isError)), []);
    case 'approved':
      if (!open(event.id, 'approval')) return same;
      {
        const p = state.pending.find(c => c.id === event.id)!;
        return {
          state: { ...state, pending: state.pending.map(c => (c.id === event.id ? { ...c, state: 'running' } : c)) },
          effects: [{ kind: 'runTool', id: p.id, name: p.name, input: p.input as Record<string, unknown> }],
        };
      }
    case 'declined':
      if (!open(event.id, 'approval')) return same;
      return continueIfDone(finish(state, event.id, result(event.id, DECLINED, true)), []);
    case 'answered':
      if (!open(event.id, 'question')) return same;
      return continueIfDone(finish(state, event.id, result(event.id, JSON.stringify(event.response))), []);
    case 'retry': {
      // The failed call never got its reply, so the conversation still ends with the user's turn.
      const last = state.messages[state.messages.length - 1];
      if (state.status !== 'failed' || last?.role !== 'user') return same;
      return { state: { ...state, status: 'calling', pending: [], error: null }, effects: [{ kind: 'callModel', messages: state.messages }] };
    }
    case 'stop': {
      if (state.status === 'calling') return endTurn({ ...state, steer: [] }, 'stopped', [{ kind: 'cancelModel' }]);
      if (state.status !== 'tools') return same;
      const results = state.pending.map(p =>
        p.state === 'done' ? p.result! : result(p.id, p.state === 'running' ? STOPPED_RUNNING : STOPPED, true),
      );
      return endTurn({ ...state, steer: [], messages: withUser(state.messages, results) }, 'stopped');
    }
  }
}
