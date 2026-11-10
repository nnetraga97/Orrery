// State and operations behind the Electron chat panel (panels/CodexChat.tsx). All account, filesystem and Codex
// operations cross the isolated preload boundary. Async results are dropped when the project, the selected chat or
// a newer operation has moved on (refreshId, operationId).

export type CodexItem = {
  id?: string;
  /** App-owned content revision, unique across service restarts. */
  revision?: string;
  type?: string;
  role?: string;
  attachmentNames?: string[];
  imagePaths?: string[];
  path?: string;
  status?: string;
  title?: string;
  text?: string;
  content?: { type?: string; text?: string; path?: string; url?: string; name?: string }[];
  summary?: (string | { text?: string })[];
  command?: string | string[];
  cwd?: string;
  // How Codex classified a command: reads, searches and listings are shown as what they are.
  commandActions?: { type?: string; name?: string; path?: string; query?: string; command?: string }[];
  output?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  arguments?: unknown;
  turnId?: string | null;
  changes?: CodexChange[];
  plan?: { step?: string; text?: string; status?: string }[];
  diff?: string;
  server?: string;
  tool?: string;
  result?: unknown;
  contentItems?: { type: string; text?: string }[];
  query?: string;
};
export type CodexChange = {
  path?: string;
  file?: string;
  diff?: string;
  patch?: string;
  kind?: string | { type?: string; move_path?: string | null };
};
export type CodexQuestion = {
  id?: string;
  question?: string;
  header?: string;
  isSecret?: boolean;
  options?: { label?: string; value?: string; description?: string }[];
};
export type CodexRequest = {
  id: string;
  type: string;
  reason?: string;
  command?: string;
  cwd?: string;
  changes?: CodexChange[];
  questions?: CodexQuestion[];
};
export type CodexThread = {
  id: string;
  streamEpoch?: string;
  streamRevision?: number;
  title?: string;
  status?: string;
  turnId?: string | null;
  model?: string;
  effort?: string;
  permission?: PermissionLevel;
  collaborationMode?: 'default' | 'plan';
  queued?: QueuedMessage[];
  queuePaused?: boolean;
  items?: CodexItem[];
  requests?: CodexRequest[];
  error?: string | { message?: string } | null;
  reconnecting?: string | null;
  updatedAt?: unknown;
  lastActivity?: unknown;
};
type Effort = string | { reasoningEffort: string; description?: string };
export type CodexModel = {
  id?: string;
  model?: string;
  displayName?: string;
  isDefault?: boolean;
  supportedReasoningEfforts?: Effort[];
  defaultReasoningEffort?: string;
  inputModalities?: string[];
};
export type Attachment = { id: string; name: string; kind: 'image' | 'file' | 'folder'; preview?: string };
export type Integration = {
  id: string;
  name: string;
  label: string;
  kind: 'skill' | 'connector';
  group: 'skill' | 'plugin' | 'connector';
  description: string;
  disabled?: boolean;
};
export type Integrations = {
  entries: Integration[];
  errors: string[];
  branch: string;
  changes?: { added: number; removed: number; files: number } | null;
};
type ErrorValue = string | { message?: string };
export type CodexState = {
  available?: boolean;
  requiresAuth?: boolean;
  account?: { email?: string; type?: string; planType?: string } | null;
  login?: { status?: string; error?: string } | null;
  models?: CodexModel[];
  threads?: CodexThread[];
  error?: ErrorValue | null;
};
export type ChatProject = { id: string; name: string; root?: string; path?: string };
type ThreadResult = CodexThread | { thread: CodexThread };
export type PermissionLevel = 'read-only' | 'workspace-write' | 'full-access';
export type QueuedMessage = {
  id: string;
  text: string;
  model?: string;
  effort?: string;
  permission: PermissionLevel;
  collaborationMode?: 'default' | 'plan';
  state: 'ready' | 'sending' | 'failed';
  error?: string;
  attachments?: string[];
  attachmentInfo?: Attachment[];
  mentions?: string[];
};
type ChatInput = {
  text?: string;
  model?: string;
  effort?: string;
  permission?: PermissionLevel;
  collaborationMode?: 'default' | 'plan';
  expectedTurnId?: string;
  attachments?: string[];
  mentions?: string[];
};
type CodexEvent = {
  type: string;
  projectId?: string;
  thread?: CodexThread;
  baseRevision?: number;
  items?: CodexItem[];
  error?: ErrorValue;
};
/** The Codex methods of the Electron preload bridge (desktop/preload.cjs). */
export type CodexBridge = {
  codexImages(projectId: string, threadId: string, itemId: string): Promise<{ name: string; src: string }[]>;
  codexChooseAttachments(projectId: string, folder: boolean): Promise<Attachment[]>;
  codexAttachFiles(projectId: string, files: File[]): Promise<Attachment[]>;
  codexPasteImage(projectId: string, dataUrl: string): Promise<Attachment>;
  codexIntegrations(projectId: string, threadId?: string): Promise<Integrations>;
  codexCompact(projectId: string, threadId: string): Promise<ThreadResult>;
  codexState(projectId: string | null): Promise<CodexState>;
  codexNewChat(projectId: string, options: ChatInput): Promise<ThreadResult>;
  codexReadChat(projectId: string, threadId: string): Promise<ThreadResult>;
  codexSend(projectId: string, threadId: string, input: ChatInput): Promise<ThreadResult>;
  codexQueue(projectId: string, threadId: string, input: ChatInput): Promise<ThreadResult>;
  codexSteer(projectId: string, threadId: string, input: ChatInput): Promise<ThreadResult>;
  codexRemoveQueued(projectId: string, threadId: string, messageId: string): Promise<ThreadResult>;
  codexResumeQueue(projectId: string, threadId: string): Promise<ThreadResult>;
  codexStop(projectId: string, threadId: string): Promise<ThreadResult>;
  codexRespond(projectId: string, threadId: string, requestId: string, response: unknown): Promise<ThreadResult>;
  codexSignIn(): Promise<unknown>;
  codexCancelLogin(): Promise<unknown>;
  codexSignOut(): Promise<unknown>;
  onCodexEvent(listener: (event: CodexEvent) => void): () => void;
};
/** Agents the chat panel can drive. Each exposes the same bridge shape under their own prefix. */
export type ChatProvider = 'codex' | 'claude' | 'nemotron';
export const PROVIDERS: { id: ChatProvider; name: string }[] = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'nemotron', name: 'Nemotron' },
];
const BRIDGE_METHODS = [
  'ChooseAttachments',
  'AttachFiles',
  'PasteImage',
  'Images',
  'Integrations',
  'Compact',
  'State',
  'NewChat',
  'ReadChat',
  'Send',
  'Queue',
  'Steer',
  'RemoveQueued',
  'ResumeQueue',
  'Stop',
  'Respond',
  'SignIn',
  'CancelLogin',
  'SignOut',
] as const;
type DesktopChat = CodexBridge & { copyText(text: string): Promise<void> } & Record<string, unknown>;
// Provider-prefixed methods seen through the common Codex-shaped bridge.
function bridgeFor(desktop: DesktopChat, provider: ChatProvider): CodexBridge {
  if (provider === 'codex') return desktop;
  const out: Record<string, unknown> = {};
  for (const name of BRIDGE_METHODS) out[`codex${name}`] = desktop[`${provider}${name}`];
  out.onCodexEvent = desktop[`on${provider[0].toUpperCase()}${provider.slice(1)}Event`];
  return out as CodexBridge;
}
export type ChatOptions = {
  desktop: DesktopChat;
  remembered?: (key: string) => string | null;
  remember?: (key: string, value: string) => void;
  close: () => void;
  openProject: () => void;
};

export type Chat = {
  provider: ChatProvider;
  project: ChatProject | null;
  codex: CodexState;
  thread: CodexThread | null;
  prompt: string;
  model: string;
  effort: string;
  permission: PermissionLevel;
  collaborationMode: 'default' | 'plan';
  error: string;
  connectionError: string;
  busy: boolean;
  stopping: boolean;
  listOpen: boolean;
  /** Increments when a different chat is shown, so the transcript scrolls to its end. */
  shown: number;
  attachments: Attachment[];
  mentions: string[];
  integrations: Integrations;
  integrationLoading: boolean;
};

let chat: Chat = {
  provider: 'codex',
  project: null,
  codex: {},
  thread: null,
  prompt: '',
  model: '',
  effort: '',
  permission: 'workspace-write',
  collaborationMode: 'default',
  error: '',
  connectionError: '',
  busy: false,
  stopping: false,
  listOpen: false,
  shown: 0,
  attachments: [],
  mentions: [],
  integrations: { entries: [], errors: [], branch: '' },
  integrationLoading: false,
};
const listeners = new Set<() => void>();
let api: CodexBridge,
  options: ChatOptions,
  refreshId = 0,
  operationId = 0,
  unsubscribers: (() => void)[] = [];
const drafts = new Map<string, string>();
const attachmentDrafts = new Map<string, Attachment[]>();
const mentionDrafts = new Map<string, string[]>();
let integrationRevision = 0;
function saveDraft() {
  drafts.set(draftKey(), chat.prompt);
  attachmentDrafts.set(draftKey(), chat.attachments);
  mentionDrafts.set(draftKey(), chat.mentions);
}

export const chatStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => chat,
};

export const modelId = (m: CodexModel) => m.model || m.id || '';
export const effortValue = (e: Effort) => (typeof e === 'string' ? e : e.reasoningEffort);
export const signedIn = (c = chat) => !!c.codex.account || c.codex.requiresAuth === false;
export const running = (c = chat) => c.thread?.status === 'running' || c.thread?.status === 'waiting';
export const message = (e: ErrorValue | null | undefined) => (typeof e === 'string' ? e : e?.message || '');
const failure = (e: unknown) => (e instanceof Error ? e.message : String(e));
const threadOf = (result: ThreadResult) => ('thread' in result ? result.thread : result);
const draftKey = (c = chat) => `${c.provider}:${c.project?.id || ''}:${c.thread?.id || 'new'}`;
/** Where the last open chat of a project is remembered, per provider. */
const savedChatKey = (p: string) =>
  `galaxy${{ codex: 'Codex', claude: 'Claude', nemotron: 'Nemotron' }[chat.provider]}Chat:${p}`;
export const providerName = (c = chat) => PROVIDERS.find(p => p.id === c.provider)!.name;
const remember = (key: string, value: string) => options?.remember?.(key, value);

// The selected model must be one of the offered models, and the effort one the model supports.
function settleModel(next: Chat): Chat {
  const models = next.codex.models || [];
  let { model, effort } = next;
  if (!models.some(m => modelId(m) === model) && models.length)
    model = modelId(models.find(m => m.isDefault) || models[0]);
  const selected = models.find(m => modelId(m) === model),
    efforts = (selected?.supportedReasoningEfforts || []).map(effortValue);
  if (!efforts.includes(effort)) effort = selected?.defaultReasoningEffort || efforts[0] || '';
  return model === next.model && effort === next.effort ? next : { ...next, model, effort };
}
function set(patch: Partial<Chat>) {
  chat = settleModel({ ...chat, ...patch });
  for (const fn of listeners) fn();
}

const currentThread = (id: string) =>
  chat.thread?.id === id ? chat.thread : chat.codex.threads?.find(t => t.id === id);
function latestThread(next: CodexThread): CodexThread {
  const prior = currentThread(next.id);
  return prior?.streamEpoch === next.streamEpoch && (prior?.streamRevision ?? -1) > (next.streamRevision ?? -1)
    ? prior!
    : next;
}
function showThread(next: CodexThread | null) {
  saveDraft();
  const thread = next ? latestThread(next) : null,
    after = { ...chat, thread };
  set({
    thread,
    prompt: drafts.get(draftKey(after)) || '',
    attachments: attachmentDrafts.get(draftKey(after)) || [],
    mentions: mentionDrafts.get(draftKey(after)) || [],
    ...(thread?.model && { model: thread.model }),
    ...(thread?.effort && { effort: thread.effort }),
    permission: thread?.permission || defaultPermission(),
    collaborationMode: thread?.collaborationMode || 'default',
    shown: chat.shown + 1,
  });
  if (chat.project) remember(savedChatKey(chat.project.id), thread?.id || '');
  if (chat.project && signedIn()) void refreshIntegrations();
}
function acceptThread(result: ThreadResult | undefined, projectId: string, threadId?: string) {
  const next = result && threadOf(result);
  if (!next?.id || chat.project?.id !== projectId) return;
  if (latestThread(next) !== next) return;
  const codex = { ...chat.codex, threads: [next, ...(chat.codex.threads || []).filter(t => t.id !== next.id)] };
  if (chat.thread?.id === next.id || (!chat.thread && !threadId))
    set({
      codex,
      thread: next,
      ...(next.model && { model: next.model }),
      ...(next.effort && { effort: next.effort }),
    });
  else set({ codex });
}
const recoveringProjects = new Set<string>();
function acceptThreadPatch(event: CodexEvent) {
  const { thread: metadata, projectId } = event;
  if (!metadata || !projectId || projectId !== chat.project?.id) return;
  const prior = currentThread(metadata.id);
  if (prior?.streamEpoch === metadata.streamEpoch && (prior?.streamRevision ?? -1) >= (metadata.streamRevision ?? 0))
    return;
  if (!prior || prior.streamEpoch !== metadata.streamEpoch || prior.streamRevision !== event.baseRevision) {
    // A renderer reload or missing event needs a full baseline before more deltas.
    if (!recoveringProjects.has(projectId)) {
      recoveringProjects.add(projectId);
      void refresh(false).finally(() => recoveringProjects.delete(projectId));
    }
    return;
  }
  let items = prior.items;
  if (event.items?.length) {
    items = [...(items || [])];
    const positions = new Map(items.map((item, i) => [item.id, i]));
    for (const item of event.items) {
      const index = positions.get(item.id);
      if (index == null) {
        positions.set(item.id, items.length);
        items.push(item);
      } else items[index] = item;
    }
  }
  acceptThread({ ...prior, ...metadata, items }, projectId, metadata.id);
}
const modelOptions = () => ({
  ...(chat.provider === 'codex' && { collaborationMode: chat.collaborationMode }),
  ...(chat.model && { model: chat.model }),
  ...(chat.effort && { effort: chat.effort }),
  permission: chat.permission,
});
const defaultPermission = (): PermissionLevel => {
  const value = options?.remembered?.('galaxyCodexPermission');
  return value === 'read-only' || value === 'full-access' ? value : 'workspace-write';
};

/** Runs one chat operation; its result applies only while it is the latest operation in the same project. */
async function operation(run: (current: () => boolean) => Promise<void>) {
  const p = chat.project?.id,
    revision = ++operationId,
    current = () => chat.project?.id === p && revision === operationId;
  set({ busy: true, error: '' });
  try {
    await run(current);
  } catch (e) {
    if (current()) set({ error: failure(e) });
  } finally {
    if (revision === operationId) set({ busy: false });
  }
}

export function readChat(id: string) {
  const p = chat.project?.id;
  if (!p || chat.busy) return;
  drafts.set(draftKey(), chat.prompt);
  void operation(async current => {
    const result = await api.codexReadChat(p, id);
    if (!current()) return;
    set({ listOpen: false });
    showThread(threadOf(result));
  });
}
export function newChat() {
  const p = chat.project?.id;
  if (!p || !signedIn() || chat.busy) return;
  void operation(async current => {
    const result = await api.codexNewChat(p, modelOptions());
    if (!current()) return;
    set({ listOpen: false });
    showThread(threadOf(result));
    focusPrompt();
  });
}
function submit(mode: 'send' | 'steer') {
  const text = chat.prompt.trim(),
    p = chat.project?.id,
    live = running(),
    expectedTurnId = chat.thread?.turnId,
    chosen = modelOptions(),
    attached = chat.attachments,
    mentions = chat.mentions;
  if ((!text && !attached.length && !mentions.length) || !p || chat.busy || !signedIn()) return;
  if (text.startsWith('/')) {
    if (mode === 'steer') return reportError('Run slash commands between turns.');
    const [command, ...rest] = text.slice(1).split(/\s+/);
    const skill = chat.integrations.entries.find(e => e.kind === 'skill' && e.name === command);
    if (skill) {
      selectIntegration(skill.id);
      setPrompt(rest.join(' ') || `Use $${skill.name} for this project.`);
      return submit(mode);
    }
    if (command === 'compact') {
      if (rest.length) return reportError('Use /compact without arguments.');
      if (live || !chat.thread) return reportError('Send a message and finish the current turn before compacting.');
      return void operation(async current => {
        const result = await api.codexCompact(p, chat.thread!.id);
        if (current()) {
          acceptThread(result, p);
          setPrompt('');
        }
      });
    }
    if (command === 'new') {
      if (rest.length) return reportError('Use /new without arguments, then write your new message.');
      setPrompt('');
      return newChat();
    }
    if (command === 'plan' || command === 'default') {
      if (chat.provider !== 'codex') return reportError('Plan mode is available with Codex.');
      if (live) return reportError('Change modes after the current turn finishes.');
      set({ collaborationMode: command === 'plan' ? 'plan' : 'default' });
      setPrompt(rest.join(' '));
      if (rest.length) return submit(mode);
      focusPrompt();
      return;
    }
    if (command === 'help') {
      setPrompt('/');
      focusPrompt();
      return;
    }
    if (['model', 'permissions', 'skills', 'connectors', 'plugins'].includes(command)) {
      if (chat.provider !== 'codex' && ['skills', 'connectors', 'plugins'].includes(command))
        return reportError('Claude Code chooses its own skills and integrations.');
      if (rest.length) return reportError(`Use /${command} without arguments to open its picker.`);
      setPrompt('');
      window.dispatchEvent(new CustomEvent('galaxy-chat-command', { detail: command }));
      return;
    }
    if (command === 'review') {
      setPrompt(
        `Review the uncommitted changes in this project for bugs and regressions. Report findings without changing files. ${rest.join(' ')}`,
      );
      return submit(mode);
    }
    return reportError(
      `Choose /${command} from the command menu, or select an installed skill. Unknown commands are not sent to ${providerName()}.`,
    );
  }
  if (mode === 'steer' && (!live || !expectedTurnId)) return;
  void operation(async current => {
    if (!chat.thread) {
      const next = threadOf(await api.codexNewChat(p, chosen));
      if (!current()) return;
      set({ thread: next });
      remember(savedChatKey(p), next.id);
    }
    const id = chat.thread!.id,
      input = { text: text || 'Use the attached context.', ...chosen, attachments: attached.map(a => a.id), mentions },
      result =
        mode === 'steer'
          ? await api.codexSteer(p, id, { ...input, expectedTurnId: expectedTurnId! })
          : live
            ? await api.codexQueue(p, id, input)
            : await api.codexSend(p, id, input);
    if (chat.project?.id !== p || chat.thread?.id !== id) return;
    drafts.delete(`${chat.provider}:${p}:new`);
    drafts.delete(draftKey());
    attachmentDrafts.delete(draftKey());
    mentionDrafts.delete(draftKey());
    set({
      attachments: chat.attachments.filter(a => !attached.some(sent => sent.id === a.id)),
      mentions: chat.mentions.filter(id => !mentions.includes(id)),
    });
    if (chat.prompt.trim() === text) set({ prompt: '' });
    saveDraft();
    acceptThread(result, p, id);
    focusPrompt();
  });
}
export const send = () => submit('send');
export const steer = () => submit('steer');

export function removeQueued(item: QueuedMessage, edit = false) {
  const p = chat.project?.id,
    id = chat.thread?.id;
  if (!p || !id || chat.busy || (edit && (chat.prompt.trim() || chat.attachments.length || chat.mentions.length)))
    return;
  void operation(async current => {
    const result = await api.codexRemoveQueued(p, id, item.id);
    const key = `${chat.provider}:${p}:${id}`,
      draft = drafts.get(key) || '';
    const editedDraft = draft.trim() ? `${draft}\n\n${item.text}` : item.text;
    if (edit) drafts.set(key, editedDraft);
    if (!current() || chat.thread?.id !== id) return;
    acceptThread(result, p, id);
    if (edit) {
      setPrompt(editedDraft);
      set({
        attachments: item.attachmentInfo || [],
        mentions: item.mentions || [],
        permission: item.permission,
        collaborationMode: item.collaborationMode || 'default',
        ...(item.model && { model: item.model }),
        ...(item.effort && { effort: item.effort }),
      });
      focusPrompt();
    }
  });
}
export function resumeQueue() {
  const p = chat.project?.id,
    id = chat.thread?.id;
  if (!p || !id || chat.busy) return;
  void operation(async current => {
    const result = await api.codexResumeQueue(p, id);
    if (current() && chat.thread?.id === id) acceptThread(result, p, id);
  });
}
export async function stop() {
  const p = chat.project?.id,
    id = chat.thread?.id;
  if (!p || !id || !chat.thread?.turnId || chat.stopping) return;
  set({ error: '', stopping: true });
  try {
    acceptThread(await api.codexStop(p, id), p, id);
  } catch (e) {
    if (chat.project?.id === p && chat.thread?.id === id) set({ error: failure(e) });
  } finally {
    set({ stopping: false });
  }
}
/** Answers an approval or question; resolves to false when the answer could not be delivered. */
export async function respond(request: CodexRequest, response: unknown) {
  const p = chat.project?.id,
    t = chat.thread?.id;
  if (!p || !t) return false;
  set({ error: '' });
  try {
    acceptThread(await api.codexRespond(p, t, request.id, response), p, t);
    return true;
  } catch (e) {
    if (chat.project?.id === p && chat.thread?.id === t) set({ error: failure(e) });
    return false;
  }
}
async function accountAction(action: () => Promise<unknown>) {
  if (chat.busy) return;
  set({ busy: true, error: '' });
  try {
    await action();
    await refresh(false);
  } catch (e) {
    set({ error: failure(e) });
  } finally {
    set({ busy: false });
  }
}
export const signIn = () => accountAction(() => api.codexSignIn());
export const cancelLogin = () => accountAction(() => api.codexCancelLogin());
export const signOut = () =>
  accountAction(async () => {
    await api.codexSignOut();
    showThread(null);
  });
export function retry() {
  set({ error: '' });
  void refresh(false);
}

export async function refresh(selectSaved = true) {
  const p = chat.project?.id || null,
    revision = ++refreshId;
  try {
    const next = await api.codexState(p);
    if (revision !== refreshId || p !== (chat.project?.id || null)) return;
    const threads = next.threads?.map(latestThread),
      selected = threads?.find(t => t.id === chat.thread?.id);
    set({
      codex: { ...next, threads },
      ...(selected && { thread: selected }),
      connectionError: next.login?.error || message(next.error),
    });
    if (p && signedIn()) void refreshIntegrations();
    const saved = selectSaved && !chat.thread && p ? options.remembered?.(savedChatKey(p)) : null;
    if (p && saved && next.threads?.some(t => t.id === saved)) {
      const selection = operationId,
        draft = chat.prompt,
        result = await api.codexReadChat(p, saved);
      if (
        revision === refreshId &&
        chat.project?.id === p &&
        selection === operationId &&
        !chat.thread &&
        chat.prompt === draft
      )
        showThread(threadOf(result));
    }
  } catch (e) {
    if (revision === refreshId) set({ connectionError: failure(e) });
  }
}
export async function switchProject(next: ChatProject | null) {
  saveDraft();
  ++refreshId;
  ++operationId;
  // Switching projects never moves a draft: the new project's draft is looked up under its own key.
  const project = next || null;
  set({
    busy: false,
    project,
    codex: { ...chat.codex, threads: [] },
    error: '',
    listOpen: false,
    thread: null,
    permission: defaultPermission(),
    collaborationMode: 'default',
    prompt: drafts.get(`${chat.provider}:${project?.id || ''}:new`) || '',
    attachments: attachmentDrafts.get(`${chat.provider}:${project?.id || ''}:new`) || [],
    mentions: mentionDrafts.get(`${chat.provider}:${project?.id || ''}:new`) || [],
    integrations: { entries: [], errors: [], branch: '' },
    shown: chat.shown + 1,
  });
  await refresh();
}

export function setPrompt(prompt: string) {
  drafts.set(draftKey(), prompt);
  set({ prompt });
}
export const setModel = (model: string) => set({ model, effort: '' });
export const setEffort = (effort: string) => set({ effort });
export const copyMessage = (text: string) => options.desktop.copyText(text);
export const setCollaborationMode = (collaborationMode: 'default' | 'plan') => set({ collaborationMode });
export async function messageImages(threadId: string, itemId: string) {
  const p = chat.project?.id;
  return p ? api.codexImages(p, threadId, itemId) : [];
}
export function reuseMessage(text: string, quote = false) {
  const addition = quote
    ? text
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n') + '\n\n'
    : text;
  setPrompt(chat.prompt.trim() ? `${chat.prompt}\n\n${addition}` : addition);
  focusPrompt();
}
export async function refreshIntegrations() {
  const p = chat.project?.id,
    threadId = chat.thread?.id,
    revision = ++integrationRevision;
  if (!p || !signedIn()) return;
  set({ integrationLoading: true });
  try {
    const result = await api.codexIntegrations(p, threadId);
    if (chat.project?.id === p && chat.thread?.id === threadId && revision === integrationRevision)
      set({ integrations: result });
  } catch (e) {
    if (chat.project?.id === p && revision === integrationRevision)
      set({ integrations: { entries: [], errors: [failure(e)], branch: '' } });
  } finally {
    if (chat.project?.id === p && revision === integrationRevision) set({ integrationLoading: false });
  }
}
export const removeAttachment = (id: string) => set({ attachments: chat.attachments.filter(a => a.id !== id) });
export const removeMention = (id: string) => set({ mentions: chat.mentions.filter(a => a !== id) });
export function selectIntegration(id: string) {
  if (!chat.mentions.includes(id)) set({ mentions: [...chat.mentions, id] });
  focusPrompt();
}
async function attach(run: (p: string) => Promise<Attachment[]>) {
  const p = chat.project?.id,
    key = draftKey();
  if (!p || !signedIn()) return;
  try {
    const added = await run(p);
    if (chat.project?.id !== p || draftKey() !== key) {
      attachmentDrafts.set(key, [...(attachmentDrafts.get(key) || []), ...added].slice(0, 12));
      return;
    }
    if (chat.attachments.length + added.length > 12) return reportError('Attach up to 12 items per message.');
    set({ attachments: [...chat.attachments, ...added] });
    focusPrompt();
  } catch (e) {
    if (chat.project?.id === p) reportError(failure(e));
  }
}
export const chooseAttachments = (folder = false) => attach(p => api.codexChooseAttachments(p, folder));
export const attachFiles = (files: File[]) => attach(p => api.codexAttachFiles(p, files));
export const pasteImage = (dataUrl: string) => attach(async p => [await api.codexPasteImage(p, dataUrl)]);
export const pasteImageFile = (file: File) =>
  attach(async p => {
    if (file.size > 20 * 1024 * 1024) throw new Error('Pasted image exceeds the 20 MB attachment limit.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read the pasted image.'));
      reader.readAsDataURL(file);
    });
    return [await api.codexPasteImage(p, dataUrl)];
  });
export function setPermission(permission: PermissionLevel) {
  if (!['read-only', 'workspace-write', 'full-access'].includes(permission)) return;
  remember('galaxyCodexPermission', permission);
  set({ permission });
}
export const toggleList = () => set({ listOpen: !chat.listOpen });
export const reportError = (error: string) => set({ error });
export const closePanel = () => options.close();
export const openProject = () => options.openProject();

let promptElement: HTMLTextAreaElement | null = null;
export const setPromptElement = (element: HTMLTextAreaElement | null) => {
  promptElement = element;
};
export const focusPrompt = () => promptElement?.focus();

/** Switches the panel to another agent; the project stays, its chats are that agent's own. */
export function setProvider(provider: ChatProvider) {
  if (provider === chat.provider || !PROVIDERS.some(p => p.id === provider)) return;
  remember('galaxyChatProvider', provider);
  saveDraft();
  api = bridgeFor(options.desktop, provider);
  set({ provider, codex: {}, thread: null, model: '', effort: '' });
  void switchProject(chat.project);
}

export function startChat(next: ChatOptions) {
  options = next;
  const saved = next.remembered?.('galaxyChatProvider');
  const provider: ChatProvider = saved === 'claude' || saved === 'nemotron' ? saved : 'codex';
  api = bridgeFor(next.desktop, provider);
  set({ provider, permission: defaultPermission() });
  for (const p of PROVIDERS)
    unsubscribers.push(
      bridgeFor(next.desktop, p.id).onCodexEvent(event => {
        if (chat.provider === p.id) handleEvent(event);
      }),
    );
  void refresh(false);
}
function handleEvent(event: CodexEvent) {
  if (
    (event.type === 'thread' || event.type === 'threadPatch') &&
    event.projectId === chat.project?.id &&
    event.thread
  ) {
    const wasRunning = running();
    if (event.type === 'threadPatch') acceptThreadPatch(event);
    else if (event.projectId) acceptThread(event.thread, event.projectId, event.thread.id);
    if (wasRunning && !running()) void refreshIntegrations();
  } else if (event.type === 'integrations') void refreshIntegrations();
  else if (
    ['account', 'login', 'state', 'accountUpdated', 'loginCompleted', 'error', 'disconnected'].includes(event.type)
  ) {
    if (event.error) set({ connectionError: message(event.error) });
    void refresh(false);
  }
}
export const stopChat = () => unsubscribers.splice(0).forEach(fn => fn());
