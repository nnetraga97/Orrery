// The agent in the browser. It owns the conversation (the loop in src/core/agent/loop.ts), the in-memory workspace
// (seeded with the scenario's bug), the open chat and its kept copies, and the requests waiting on the user. It carries
// out the loop's effects: calling the model through the AgentPort, running tools on the workspace, raising approval
// and question cards. It turns the conversation into the transcript's items, tells the scene what the agent does
// (agent-events.ts), and handles every pinch on the chat window, by region id.
import { createSystem } from '@iwsdk/core';
import { initialLoop, loopStep } from '../core/agent/loop.ts';
import type { LoopEffect, LoopEvent, LoopState, TurnOutcome } from '../core/agent/loop.ts';
import { previewEdit, runTool } from '../core/agent/run-tool.ts';
import { TOOLS } from '../core/agent/tools.ts';
import type { AgentRequest, Message, StreamEvent, ToolUseBlock } from '../core/agent/wire.ts';
import { toolUses } from '../core/agent/wire.ts';
import * as composerOps from '../core/chat/composer.ts';
import type { Effect as ComposerEffect, SlashCommand } from '../core/chat/composer.ts';
import { textOf } from '../core/chat/describe.ts';
import { answerState, choose, isQuestionRequest, readyToSend, toResponse } from '../core/chat/requests.ts';
import { createThreadStore } from '../core/chat/thread-store.ts';
import type { ThreadStore } from '../core/chat/thread-store.ts';
import { createThread, lastFor } from '../core/chat/threads.ts';
import type { StoredThread } from '../core/chat/threads.ts';
import type { ChatItem, ChatQuestion, ChatRequest } from '../core/chat/types.ts';
import { applyBreak, isFixed, validateScenario } from '../core/scenario.ts';
import type { Scenario } from '../core/scenario.ts';
import { createWorkspace } from '../core/workspace.ts';
import type { Workspace } from '../core/workspace.ts';
import { createAgentEvents } from '../galaxy-bridge/agent-events.ts';
import type { AgentEvents } from '../galaxy-bridge/agent-events.ts';
import { galaxyState, setSourceOverride, sourceUrl } from '../galaxy-bridge/galaxy-session.js';
import type { AgentPort } from '../ports/agent.ts';
import type { StoragePort } from '../ports/storage.ts';
import {
  agentPointer,
  answers,
  changedFiles,
  chatToggles,
  codeView,
  composer,
  dataset,
  phase,
  provider,
  replayRequest,
  scenario as scenarioSignal,
  scenarioState,
  thread,
  threads,
} from '../state/app-state.ts';
import { connectChat, connectChatActions, pressMic, releaseMic, showChatPage, showCode } from '../state/commands.ts';

/** The system prompt: byte-stable for a project, so a provider can cache it with the tool list. */
export const systemPrompt = (project: string) =>
  [
    `You are a coding agent inside Orrery, where a codebase is seen as a galaxy from inside a headset. The project is "${project}".`,
    'The user talks to you by voice and pinches choices; they cannot type. Your edits go to an in-memory copy of the project that the user reviews and approves.',
    'Work in small steps. Search and read before you answer. Point at code with show_user before explaining it. When a choice belongs to the user, ask with ask_user and offer options. Keep a plan with update_plan when the work has more than two steps. Edit with replace_in_file, including enough surrounding text to make the match unique. After a fix, call run_replay with "fixed" so the user can watch it run.',
    'Your messages are read on a small window: short paragraphs, short lists, code blocks only for code.',
  ].join('\n\n');

type Pending = { id: string; name: string; input: Record<string, unknown> };

export class AgentSystem extends createSystem({}) {
  private port!: AgentPort;
  private store!: ThreadStore;
  private loop: LoopState = initialLoop();
  private abort: AbortController | null = null;
  private workspace: Workspace | null = null;
  private scenario: Scenario | null = null;
  private events!: AgentEvents;
  private opened: string | null = null;
  private items: ChatItem[] = [];
  private requests: ChatRequest[] = [];
  private calls = new Map<string, Pending>();
  private live = { thinking: '', text: '', thinkingStart: 0, call: 0 };
  private turn = 0;
  private changedThisTurn = false;
  private fixedAt = 0;
  private auto = false;
  private notices = new Map<string, string>();

  init() {
    this.port = this.globals.agent as AgentPort;
    this.auto = !!this.globals.auto;
    this.store = createThreadStore(this.globals.storage as StoragePort);
    this.events = createAgentEvents('orrery');
    provider.value = { ...provider.peek(), label: this.port.label, id: (this.globals.providerId as string) ?? 'recorded' };
    this.cleanupFuncs.push(
      connectChat({ newChat: () => this.newChat(), openThread: id => this.openThread(id) }),
      connectChatActions(id => this.action(id)),
      phase.subscribe(p => {
        const name = dataset.peek();
        if ((p === 'overview' || p === 'landed') && name && name !== this.opened) void this.openProject(name);
      }),
      () => setSourceOverride(null),
    );
  }

  /** The test hook's view of the workspace. */
  get ws() {
    return this.workspace;
  }

  // ---------- the project, its scenario and its chat ----------

  private async openProject(name: string) {
    this.opened = name;
    this.stopTurn();
    const query = new URLSearchParams(location.search);
    const id = query.get('scenario') ?? (name === 'editor-core' ? 'range-edge' : null);
    this.scenario = id ? await this.loadScenario(id, name) : null;
    scenarioSignal.value = this.scenario;
    const paths = galaxyState.nodes.map(n => n.path);
    const s = this.scenario;
    this.workspace = createWorkspace(async path => {
      const text = await readBaked(name, path);
      return text != null && s && path === s.breakPatch.file ? applyBreak(s, text) : text;
    }, paths);
    this.workspace.onChange(path => {
      changedFiles.value = this.workspace!.changed();
      this.events.refresh(path);
      void this.checkFixed();
    });
    // The scene reads the workspace's text for every file it holds, edited or broken.
    const ws = this.workspace;
    let brokenText: string | null = null;
    if (s) brokenText = await ws.read(s.breakPatch.file).catch(() => null);
    setSourceOverride((ds, path) => (ds !== name ? null : (ws.edited(path) ?? (s && path === s.breakPatch.file ? brokenText : null))));
    if (s) this.events.refresh(s.breakPatch.file);
    scenarioState.value = s ? 'broken' : 'none';
    changedFiles.value = [];
    composer.value = composerOps.initialComposer({ notice: composer.peek().notice });
    this.restore(name);
    if (this.auto) this.startAuto();
  }

  private async loadScenario(id: string, name: string): Promise<Scenario | null> {
    try {
      const res = await fetch(`scenarios/${encodeURIComponent(id)}.json`);
      if (!res.ok) return null;
      const v = validateScenario(await res.json());
      if (!v.ok) {
        console.warn('[orrery] scenario', id, v.errors);
        return null;
      }
      return v.scenario.dataset === name ? v.scenario : null;
    } catch {
      return null;
    }
  }

  private async checkFixed() {
    const s = this.scenario;
    if (!s || !this.workspace || scenarioState.peek() !== 'broken') return;
    const text = await this.workspace.read(s.breakPatch.file).catch(() => null);
    if (text != null && isFixed(s, text)) {
      scenarioState.value = 'fixed';
      this.fixedAt = performance.now();
    }
  }

  private restore(name: string) {
    threads.value = this.store.list().filter(t => t.dataset === name);
    const last = lastFor(threads.peek(), provider.peek().id, name);
    const kept = last ? this.store.load(last.id) : null;
    this.adopt(kept ?? createThread(provider.peek().id, name));
  }

  /** Makes a thread the open chat: its conversation continues where it was left. */
  private adopt(t: StoredThread) {
    let messages = t.messages as Message[];
    // Calls left open when the app was closed are answered, so the conversation stays valid.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && toolUses(last).length)
      messages = [
        ...messages,
        { role: 'user', blocks: toolUses(last).map(u => ({ type: 'tool_result', toolUseId: u.id, content: 'Not run: the app was closed first.', isError: true })) },
      ];
    this.loop = initialLoop({ messages, permission: composer.peek().permission, mode: composer.peek().mode });
    this.items = (t.items ?? []).map(i => (i.status === 'inProgress' || i.status === 'running' ? { ...i, status: 'failed' } : i));
    this.requests = [];
    answers.value = new Map();
    this.notices.clear();
    chatToggles.value = new Map();
    this.turn = this.items.filter(i => i.type === 'userMessage').length;
    thread.value = { ...t, messages, items: this.items, requests: [], status: 'idle' };
    this.events.session(t.id, this.port.label);
  }

  private newChat() {
    this.stopTurn();
    const name = this.opened;
    if (!name) return;
    this.workspace?.markTurn();
    this.adopt(createThread(provider.peek().id, name));
    this.save();
  }

  private openThread(id: string) {
    const t = this.store.load(id);
    if (!t) return;
    this.stopTurn();
    this.adopt(t);
  }

  private save() {
    const t = thread.peek();
    if (!t || !t.items?.length) return;
    this.store.save(t);
    threads.value = this.store.list().filter(x => x.dataset === this.opened);
  }

  /** Publishes the open chat from the loop and the items. */
  private publish(extra: Partial<StoredThread> = {}) {
    const t = thread.peek();
    if (!t) return;
    const busy = this.loop.status === 'calling' || this.loop.status === 'tools';
    thread.value = {
      ...t,
      ...extra,
      items: [...this.items],
      requests: [...this.requests],
      messages: this.loop.messages,
      status: busy ? 'running' : this.loop.status === 'stopped' ? 'stopped' : this.loop.status === 'failed' ? 'failed' : 'idle',
      error: this.loop.error,
      updatedAt: Date.now(),
    };
    composer.value = { ...composer.peek(), running: busy };
  }

  // ---------- the loop ----------

  private dispatch(event: LoopEvent) {
    const step = loopStep(this.loop, event);
    this.loop = step.state;
    for (const effect of step.effects) this.carryOut(effect);
    this.publish();
  }

  private carryOut(effect: LoopEffect) {
    switch (effect.kind) {
      case 'callModel':
        return void this.callModel(effect.messages);
      case 'cancelModel':
        this.abort?.abort();
        this.abort = null;
        return;
      case 'runTool':
        return void this.runTool(effect.id, effect.name, effect.input);
      case 'askApproval':
        return void this.askApproval(effect.id, effect.name, effect.input);
      case 'askUser':
        return this.askUser(effect.id, effect.input);
      case 'turnEnded':
        return this.turnEnded(effect.outcome);
    }
  }

  private async callModel(messages: Message[]) {
    const name = this.opened ?? 'project';
    const request: AgentRequest = {
      provider: provider.peek().id,
      ...(provider.peek().model ? { model: provider.peek().model } : {}),
      system: systemPrompt(name),
      tools: TOOLS,
      messages,
    };
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    const call = ++this.live.call;
    this.live.thinking = '';
    this.live.text = '';
    this.live.thinkingStart = 0;
    try {
      await this.port.send(request, event => {
        if (abort.signal.aborted || call !== this.live.call) return;
        this.onStream(event);
      }, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      this.onStream({ type: 'error', code: 'network', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private onStream(event: StreamEvent) {
    if (event.type === 'thinking') {
      if (!this.live.thinkingStart) this.live.thinkingStart = performance.now();
      this.live.thinking += event.delta;
      this.setLive('live-thinking', { type: 'reasoning', status: 'inProgress', text: this.live.thinking });
      this.publish();
      return;
    }
    if (event.type === 'text') {
      this.live.text += event.delta;
      this.setLive('live-text', { type: 'agentMessage', status: 'inProgress', text: this.live.text });
      this.publish();
      return;
    }
    if (event.type === 'message') this.received(event.message);
    if (event.type === 'error') this.events.message('error', event.message);
    if (event.type === 'message' || event.type === 'error') {
      this.items = this.items.filter(i => !i.id?.startsWith('live-'));
      this.dispatch({ type: 'stream', event });
    }
  }

  private setLive(id: string, item: ChatItem) {
    const k = this.items.findIndex(i => i.id === id);
    if (k >= 0) this.items[k] = { ...item, id };
    else this.items.push({ ...item, id });
  }

  /** The finished reply's blocks as transcript items, before its tools run. */
  private received(message: Message) {
    this.items = this.items.filter(i => !i.id?.startsWith('live-'));
    const index = this.loop.messages.length;
    message.blocks.forEach((block, k) => {
      const id = `m${index}.${k}`;
      if (block.type === 'thinking')
        this.items.push({ id, type: 'reasoning', status: 'completed', text: block.text ?? '', durationMs: this.live.thinkingStart ? performance.now() - this.live.thinkingStart : null });
      else if (block.type === 'text' && block.text.trim()) {
        this.items.push({ id, type: 'agentMessage', text: block.text });
        this.events.message('assistant', block.text);
      } else if (block.type === 'tool_use') this.toolItem(block);
    });
  }

  private toolItem(use: ToolUseBlock) {
    const input = (use.input ?? {}) as Record<string, unknown>;
    this.calls.set(use.id, { id: use.id, name: use.name, input });
    const base = { id: use.id, status: 'running' };
    switch (use.name) {
      case 'read_file':
        return void this.items.push({ ...base, type: 'commandExecution', command: `read ${input.path}`, commandActions: [{ type: 'read', path: String(input.path ?? '') }] });
      case 'search':
        return void this.items.push({ ...base, type: 'commandExecution', command: `search ${input.pattern}`, commandActions: [{ type: 'search', query: String(input.pattern ?? ''), path: input.path as string | undefined }] });
      case 'list_files':
        return void this.items.push({ ...base, type: 'commandExecution', command: 'list files', commandActions: [{ type: 'list_files', path: '.' }] });
      case 'replace_in_file':
      case 'write_file':
        return void this.items.push({ ...base, status: 'inProgress', type: 'fileChange', changes: [{ path: String(input.path ?? 'file') }] });
      case 'show_user':
        return void this.items.push({ ...base, type: 'dynamicToolCall', tool: 'show_user', title: `Pointed at ${input.file}${input.line ? `:${input.line}` : ''}`, arguments: input });
      case 'update_plan': {
        const id = `plan-${this.turn}`,
          plan = ((input.steps as { text: string; status: string }[]) ?? []).map(s => ({ step: s.text, status: s.status }));
        const k = this.items.findIndex(i => i.id === id);
        if (k >= 0) this.items[k] = { ...this.items[k], plan };
        else this.items.push({ id, type: 'plan', plan });
        return;
      }
      case 'ask_user':
        return void this.items.push({ ...base, type: 'question', title: 'Asked a question' });
      case 'run_replay':
        return void this.items.push({ ...base, type: 'replay', title: `Replayed the ${input.which === 'failing' ? 'failing' : 'fixed'} run` });
      default:
        return void this.items.push({ ...base, type: 'dynamicToolCall', tool: use.name, arguments: input });
    }
  }

  private updateItem(id: string, change: Partial<ChatItem>) {
    const k = this.items.findIndex(i => i.id === id);
    if (k >= 0) this.items[k] = { ...this.items[k], ...change };
  }

  private async runTool(id: string, name: string, input: Record<string, unknown>) {
    const ws = this.workspace;
    if (!ws) return this.dispatch({ type: 'toolFinished', id, content: 'The project is not open yet.', isError: true });
    this.events.toolStarted(id, name, input);
    const out = await runTool(name, input, ws, {
      showUser: (file, line, message) => {
        agentPointer.value = { file, line, message };
        if ((this.globals.followAgent as (() => boolean) | undefined)?.()) showCode(file, line ?? 1);
      },
      runReplay: which => {
        replayRequest.value = { which };
      },
    });
    this.events.toolFinished(id, name, input, !out.isError);
    const status = out.isError ? 'failed' : 'completed';
    if (out.change) {
      this.changedThisTurn = true;
      this.updateItem(id, { status, changes: [{ path: out.change.path, diff: out.change.diff, kind: out.change.created ? 'add' : 'update' }] });
    } else if (name === 'read_file' || name === 'search' || name === 'list_files') this.updateItem(id, { status, output: out.content, exitCode: out.isError ? 1 : 0 });
    else this.updateItem(id, { status, result: out.content });
    if (this.loop.status !== 'tools') return;
    this.dispatch({ type: 'toolFinished', id, content: out.content, isError: out.isError });
  }

  private async askApproval(id: string, name: string, input: Record<string, unknown>) {
    const ws = this.workspace;
    try {
      if (!ws) throw new Error('The project is not open yet.');
      const preview = await previewEdit(name, input, ws);
      this.updateItem(id, { changes: [{ path: preview.path, diff: preview.diff }] });
      this.requests.push({ id, type: 'fileChangeApproval', reason: `Change ${preview.path}`, changes: [{ path: preview.path, diff: preview.diff }] });
      this.publish();
      this.save();
      if (this.auto) setTimeout(() => this.action(`button:approve:${id}`), 400);
    } catch (e) {
      // The edit would fail: no point asking. The model gets the error and can try again.
      this.updateItem(id, { status: 'failed' });
      if (this.loop.status === 'tools') this.dispatch({ type: 'toolFinished', id, content: e instanceof Error ? e.message : String(e), isError: true });
    }
  }

  private askUser(id: string, input: Record<string, unknown>) {
    const questions = ((input.questions as ChatQuestion[]) ?? []).map(q => ({ ...q, options: q.options ?? [] }));
    const request: ChatRequest = { id, type: 'questions', questions };
    this.requests.push(request);
    answers.value = new Map(answers.peek()).set(id, answerState(request));
    this.events.toolStarted(id, 'ask_user', input);
    this.save();
    if (this.auto)
      setTimeout(() => {
        let state = answers.peek().get(id);
        if (!state) return;
        questions.forEach((q, i) => (state = choose(state!, q.id || String(i), 0)));
        answers.value = new Map(answers.peek()).set(id, state!);
        this.action(`button:send:${id}`);
      }, 400);
  }

  private turnEnded(outcome: TurnOutcome) {
    void this.finishTurn(outcome);
  }

  private async finishTurn(outcome: TurnOutcome) {
    this.requests = [];
    answers.value = new Map();
    if (this.changedThisTurn && this.workspace) {
      const diff = await this.workspace.turnDiff();
      if (diff) this.items.push({ id: `diff-${this.turn}`, type: 'turnDiff', diff });
    }
    this.changedThisTurn = false;
    this.events.turnFinished(outcome === 'completed' ? 'completed' : outcome === 'stopped' ? 'interrupted' : 'failed');
    const step = composerOps.turnEnded(composer.peek());
    composer.value = step.state;
    this.publish({ title: thread.peek()?.title });
    this.save();
    if (step.effect) this.composerEffect(step.effect);
  }

  private stopTurn() {
    if (this.loop.status === 'calling' || this.loop.status === 'tools') this.dispatch({ type: 'stop' });
    this.abort?.abort();
    this.abort = null;
  }

  // ---------- what the user said ----------

  /** The open file and lines the user is looking at, as a label and as text for the model. */
  private looking(): { label: string; text: string } | null {
    const view = codeView.peek();
    if (!view) return null;
    const range = view.selectedRange ?? (view.selectedRegion != null ? view.regions[view.selectedRegion] : null);
    if (!range) return null;
    const lines = view.lines
      .slice(range.start - 1, range.end)
      .map((segments, k) => `${range.start + k}\t${segments.map(s => s.text).join('')}`)
      .join('\n');
    const label = `${view.file.split('/').pop()}:${range.start}–${range.end}`;
    return { label, text: `\n\n(The user is looking at ${view.file}, lines ${range.start}–${range.end}:)\n${lines}` };
  }

  private say(text: string, attachContext: boolean, steer = false) {
    const context = attachContext ? this.looking() : null;
    this.turn++;
    this.items.push({ id: `u${Date.now().toString(36)}${this.turn}`, type: 'userMessage', text, attachmentNames: context ? [context.label] : [] });
    this.workspace?.markTurn();
    this.events.turnStarted(text);
    agentPointer.value = null;
    this.dispatch({ type: 'settings', permission: composer.peek().permission, mode: composer.peek().mode });
    this.dispatch({ type: steer ? 'steer' : 'userSaid', text: text + (context?.text ?? '') });
    this.save();
  }

  private composerEffect(effect: ComposerEffect) {
    switch (effect.kind) {
      case 'send':
        if (!provider.peek().available) {
          composer.value = { ...composer.peek(), running: false, notice: 'This provider is not available.' };
          return;
        }
        return this.say(effect.text, effect.attachContext);
      case 'steer':
        return this.say(effect.text, effect.attachContext, true);
      case 'stop':
        return this.stopTurn();
      case 'newChat':
        return this.newChat();
      case 'compact':
        composer.value = { ...composer.peek(), notice: 'This chat is short enough: nothing to compact.' };
        return;
      case 'openPicker':
        composer.value = { ...composer.peek(), more: true };
        return;
    }
  }

  private composerStep(step: composerOps.Step) {
    composer.value = step.state;
    if (step.effect) this.composerEffect(step.effect);
  }

  // ---------- pinches on the chat window ----------

  action(id: string) {
    const [kind, name, ...rest] = id.split(':');
    const arg = rest.join(':');
    const c = composer.peek();
    switch (kind) {
      case 'chip':
        if (name === 'prompt') {
          const prompt = (this.scenario?.prompts ?? DEFAULT_PROMPTS)[Number(arg)];
          if (prompt) composer.value = composerOps.heard(c, prompt);
        } else if (name === 'more') composer.value = composerOps.toggleMore(c);
        else if (name === 'context') composer.value = composerOps.toggleContext(c);
        return;
      case 'slash':
        return this.composerStep(composerOps.slash(c, name as SlashCommand));
      case 'choice':
        if (name === 'mode') composer.value = composerOps.setMode(c, arg as composerOps.Mode);
        else if (name === 'permission') composer.value = composerOps.setPermission(c, arg as composerOps.Permission);
        else if (name === 'provider' || name === 'model') (this.globals.chooseProvider as ((kind: string, value: string) => void) | undefined)?.(name, arg);
        return;
      case 'queue':
        if (name === 'remove') composer.value = composerOps.removeQueued(c, arg);
        return;
      case 'thread':
        showChatPage('transcript');
        return this.openThread([name, arg].filter(Boolean).join(':'));
      case 'option': {
        const [qid, index] = [rest.slice(0, -1).join(':'), Number(rest[rest.length - 1])];
        const state = answers.peek().get(name);
        if (state) answers.value = new Map(answers.peek()).set(name, choose(state, qid, index));
        this.publish();
        return;
      }
      case 'button':
        return this.button(name, arg);
    }
  }

  private button(name: string, arg: string) {
    const c = composer.peek();
    switch (name) {
      case 'send':
        if (arg) return this.sendAnswer(arg);
        return this.composerStep(composerOps.send(c));
      case 'cancel':
        composer.value = composerOps.cancel(c);
        return;
      case 'stop':
        return this.composerStep(composerOps.stop(c));
      case 'steer':
        return this.composerStep(composerOps.steer(c));
      case 'queue':
        composer.value = composerOps.enqueue(c, `q${Date.now().toString(36)}`);
        return;
      case 'dropFollowUp':
        composer.value = composerOps.cancel(c);
        return;
      case 'resumeQueue':
        return this.composerStep(composerOps.resumeQueue(c));
      case 'review':
        return this.composerStep(composerOps.slash(c, 'review'));
      case 'newChat':
        showChatPage('transcript');
        return this.newChat();
      case 'reuse':
      case 'reply': {
        const item = this.items.find(i => i.id === arg);
        if (!item) return;
        const text = textOf(item);
        composer.value = name === 'reuse' ? composerOps.reuse(c, text) : composerOps.reply(c, text);
        return;
      }
      case 'approve':
      case 'decline':
        return this.decide(arg, name === 'approve');
    }
  }

  private decide(id: string, accept: boolean) {
    const request = this.requests.find(r => r.id === id);
    if (!request || isQuestionRequest(request)) return;
    this.requests = this.requests.filter(r => r.id !== id);
    if (!accept) this.updateItem(id, { status: 'declined' });
    this.dispatch({ type: accept ? 'approved' : 'declined', id });
    this.save();
  }

  private sendAnswer(id: string) {
    const state = answers.peek().get(id);
    if (!state) return;
    const ready = readyToSend(state);
    if (!ready.ok) {
      this.notices.set(id, ready.message);
      this.publish();
      return;
    }
    let response: unknown;
    try {
      response = toResponse(state);
    } catch (e) {
      response = { error: e instanceof Error ? e.message : String(e) };
    }
    this.requests = this.requests.filter(r => r.id !== id);
    this.notices.delete(id);
    const m = new Map(answers.peek());
    m.delete(id);
    answers.value = m;
    this.updateItem(id, { status: 'completed' });
    this.events.toolFinished(id, 'ask_user', {}, true);
    this.dispatch({ type: 'answered', id, response });
    this.save();
  }

  /** Notices under question cards ("Answer each question before sending."), by request id. */
  get requestNotices(): ReadonlyMap<string, string> {
    return this.notices;
  }

  // ---------- the test harness ----------

  /** ?auto=1: say the first phrase of ?say=, send it, choose the first option of every question, approve every edit. */
  private startAuto() {
    setTimeout(() => {
      pressMic();
      setTimeout(releaseMic, 200);
      const off = composer.subscribe(c => {
        if (c.pending && !c.running) {
          queueMicrotask(() => {
            off();
            this.action('button:send');
          });
        }
      });
    }, 500);
  }

  update() {
    if (scenarioState.peek() === 'fixed' && performance.now() - this.fixedAt > 5000) scenarioState.value = 'done';
  }
}

const DEFAULT_PROMPTS = ['Explain this project', 'Find a bug', 'Show me the main function'];

/** A file's baked text, never the override (the workspace is the override). */
async function readBaked(name: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl(name, path));
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
