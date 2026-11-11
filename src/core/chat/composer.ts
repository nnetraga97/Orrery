// The composer without a keyboard: what was heard waits as `pending` until Send or Cancel; while a turn runs, a new
// message asks whether to steer the turn or queue the message; the queue can be said again, removed and resumed; the
// desktop chat's slash commands are pinchable chips with the same effects (reference/desktop-app/viewer/app/
// codex-chat.ts, submit). Every function is pure: it returns the next state and, when something must happen, an effect
// for the agent system to carry out.

export type Mode = 'work' | 'plan';
export type Permission = 'readOnly' | 'workspace' | 'full';
export type Queued = { id: string; text: string; state: 'ready' | 'sending' | 'failed' };
export type SlashCommand = 'new' | 'plan' | 'default' | 'review' | 'compact' | 'model' | 'permissions';
export const SLASH_COMMANDS: readonly SlashCommand[] = ['new', 'plan', 'default', 'review', 'compact', 'model', 'permissions'];

export type ComposerState = {
  /** What was heard (or reused, or quoted), not yet sent. */
  pending: string;
  /** Send "What I'm looking at" (the open file and lines) with the message. */
  attachContext: boolean;
  mode: Mode;
  permission: Permission;
  queue: Queued[];
  queuePaused: boolean;
  /** A turn is running. */
  running: boolean;
  /** A message was said while the turn runs: show "Send follow-up: Steer · Queue · ✕". */
  choosing: boolean;
  /** The More row is open. */
  more: boolean;
  /** A short error or hint, shown above the composer. */
  notice: string | null;
};

export type Outgoing = { text: string; attachContext: boolean; mode: Mode; permission: Permission };
export type Effect =
  | ({ kind: 'send' } & Outgoing)
  | ({ kind: 'steer' } & Outgoing)
  | { kind: 'newChat' }
  | { kind: 'compact' }
  | { kind: 'stop' }
  | { kind: 'openPicker'; which: 'model' | 'permission' };
export type Step = { state: ComposerState; effect: Effect | null };

export const REVIEW_PROMPT = 'Review the changes in this project for bugs and regressions. Report findings without changing files.';

export const initialComposer = (over: Partial<ComposerState> = {}): ComposerState => ({
  pending: '',
  attachContext: true,
  mode: 'work',
  permission: 'workspace',
  queue: [],
  queuePaused: false,
  running: false,
  choosing: false,
  more: false,
  notice: null,
  ...over,
});

const none = (state: ComposerState): Step => ({ state, effect: null });
const outgoing = (state: ComposerState, text: string): Outgoing => ({
  text,
  attachContext: state.attachContext,
  mode: state.mode,
  permission: state.permission,
});

/** Heard text becomes the pending message; while a turn runs it asks to steer or queue. */
export function heard(state: ComposerState, text: string): ComposerState {
  const t = text.trim();
  if (!t) return state;
  return { ...state, pending: t, choosing: state.running, notice: null };
}

/** Sends the pending message; a slash command runs instead; while a turn runs, asks to steer or queue. */
export function send(state: ComposerState): Step {
  const text = state.pending.trim();
  if (!text) return none(state);
  if (text.startsWith('/')) {
    const [name, ...rest] = text.slice(1).split(/\s+/);
    if ((SLASH_COMMANDS as readonly string[]).includes(name)) {
      const step = slash({ ...state, pending: rest.join(' ') }, name as SlashCommand);
      return step;
    }
    return none({ ...state, notice: `There is no /${name} command.` });
  }
  if (state.running) return none({ ...state, choosing: true });
  return { state: { ...state, pending: '', choosing: false, notice: null, running: true }, effect: { kind: 'send', ...outgoing(state, text) } };
}

/** Delivers the pending message into the running turn. */
export function steer(state: ComposerState): Step {
  const text = state.pending.trim();
  if (!text || !state.running) return none(state);
  return { state: { ...state, pending: '', choosing: false }, effect: { kind: 'steer', ...outgoing(state, text) } };
}

/** Queues the pending message to send when the turn ends. */
export function enqueue(state: ComposerState, id: string): ComposerState {
  const text = state.pending.trim();
  if (!text) return state;
  return { ...state, pending: '', choosing: false, queue: [...state.queue, { id, text, state: 'ready' }] };
}

export const cancel = (state: ComposerState): ComposerState => ({ ...state, pending: '', choosing: false, notice: null });

/** Puts an earlier message back as the pending one. */
export const reuse = (state: ComposerState, text: string): ComposerState => ({ ...state, pending: text, choosing: state.running });

/** Quotes a message as the start of a reply: each line prefixed with "> ". */
export function reply(state: ComposerState, text: string): ComposerState {
  const quoted = text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
  return { ...state, pending: state.pending.trim() ? `${quoted}\n\n${state.pending}` : `${quoted}\n\n` };
}

export const removeQueued = (state: ComposerState, id: string): ComposerState => ({
  ...state,
  queue: state.queue.filter(q => q.id !== id),
});

/** "Say it again": a queued message's text replaced by what was just heard. */
export const replaceQueued = (state: ComposerState, id: string, text: string): ComposerState => ({
  ...state,
  queue: state.queue.map(q => (q.id === id && text.trim() ? { ...q, text: text.trim(), state: 'ready' } : q)),
});

/** Stops the turn; the queue pauses, so nothing is sent until Resume queue. */
export function stop(state: ComposerState): Step {
  if (!state.running) return none(state);
  return { state: { ...state, queuePaused: state.queue.length > 0 }, effect: { kind: 'stop' } };
}

/** The turn ended: send the next queued message, unless the queue is paused. */
export function turnEnded(state: ComposerState): Step {
  const next = state.queue.find(q => q.state === 'ready');
  const ended = { ...state, running: false };
  if (!next || state.queuePaused) return none(ended);
  return {
    state: { ...ended, running: true, queue: state.queue.filter(q => q !== next) },
    effect: { kind: 'send', ...outgoing(state, next.text) },
  };
}

export function resumeQueue(state: ComposerState): Step {
  const resumed = { ...state, queuePaused: false };
  return state.running ? none(resumed) : turnEnded(resumed);
}

/** A slash command's effect, as on the desktop. Any text left after the command is sent with it where it can be. */
export function slash(state: ComposerState, name: SlashCommand): Step {
  const rest = state.pending.trim(),
    closed = { ...state, more: false, notice: null };
  switch (name) {
    case 'new':
      return { state: { ...closed, pending: '', choosing: false }, effect: { kind: 'newChat' } };
    case 'plan':
    case 'default': {
      if (state.running) return none({ ...state, notice: 'Change modes after the current turn finishes.' });
      const next = { ...closed, mode: (name === 'plan' ? 'plan' : 'work') as Mode };
      return rest ? send(next) : none(next);
    }
    case 'review':
      return send({ ...closed, pending: rest ? `${REVIEW_PROMPT} ${rest}` : REVIEW_PROMPT });
    case 'compact':
      if (state.running) return none({ ...state, notice: 'Send a message and finish the current turn before compacting.' });
      return { state: { ...closed, pending: '' }, effect: { kind: 'compact' } };
    case 'model':
    case 'permissions':
      return { state: { ...closed, pending: '' }, effect: { kind: 'openPicker', which: name === 'model' ? 'model' : 'permission' } };
  }
}

export const toggleMore = (state: ComposerState): ComposerState => ({ ...state, more: !state.more });
export const toggleContext = (state: ComposerState): ComposerState => ({ ...state, attachContext: !state.attachContext });
export const setMode = (state: ComposerState, mode: Mode): ComposerState => (state.running ? state : { ...state, mode });
export const setPermission = (state: ComposerState, permission: Permission): ComposerState => ({ ...state, permission });
