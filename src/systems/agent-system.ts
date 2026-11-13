// The agent in the browser. It owns the conversation (the loop in src/core/agent/loop.ts), the in-memory workspace
// (seeded with the scenario's bug), the open chat and its kept copies, and the requests waiting on the user. It carries
// out the loop's effects: calling the model through the AgentPort, running tools on the workspace, raising approval
// and question cards. It turns the conversation into the transcript's items, tells the scene what the agent does
// (agent-events.ts), and handles every pinch on the chat window, by region id. Each message goes to the model with a
// note of where the user is (src/core/chat/context.ts). A chat is saved whenever its files change, so an approved edit
// survives whatever ends the turn.
import { createSystem } from '@iwsdk/core';
import { initialLoop, loopStep } from '../core/agent/loop.ts';
import type { LoopEffect, LoopEvent, LoopState, TurnOutcome } from '../core/agent/loop.ts';
import { firstChangedLine } from '../core/diff.ts';
import { createFunctionIndex } from '../core/agent/functions.ts';
import type { FunctionIndex } from '../core/agent/functions.ts';
import { previewEdit, runTool } from '../core/agent/run-tool.ts';
import { systemPrompt } from '../core/agent/prompt.ts';
import { TOOLS } from '../core/agent/tools.ts';
import type { AgentRequest, Message, StreamEvent, ToolUseBlock } from '../core/agent/wire.ts';
import { toolUses } from '../core/agent/wire.ts';
import { contextNote, lookingLabel } from '../core/chat/context.ts';
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
import { functionIndexUrl, galaxyState, setSourceOverride, sourceUrl } from '../galaxy-bridge/galaxy-session.js';
import type { AgentPort } from '../ports/agent.ts';
import type { StoragePort } from '../ports/storage.ts';
import {
  agentPointer,
  answers,
  changedFiles,
  chatToggles,
  composer,
  dataset,
  phase,
  provider,
  replay,
  replayRequest,
  scenario as scenarioSignal,
  scenarioState,
  thread,
  threads,
} from '../state/app-state.ts';
import { connectChat, connectChatActions, playSound, pressMic, releaseMic, showChatPage, showCode } from '../state/commands.ts';
import { whereNow } from '../state/where.ts';

type Pending = { id: string; name: string; input: Record<string, unknown> };

/** After the problem closes, the fixed run replays by itself once the rebuilt town has had this long to show. */
const REPLAY_AFTER_FIX_MS = 1500;
/** A model call with no event for this long is given up (the relay or the network went quiet). While a tool's input
 * streams the relay sends progress events, so a long write_file is not mistaken for silence. */
const IDLE_MS = 90_000;
export const RECORDED_NOTICE = 'Recorded agent: it replays one prepared fix, whatever is asked.';
export const NEW_CHAT_NOTICE = 'New chat: the files are back as they started. Your changes stay with the earlier chat.';
export const CUT_OFF_NOTICE = 'The reply was cut off before it finished. Ask it to continue.';
export const REFUSED_NOTICE = 'The model declined to answer that.';

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
  /** Counts the user's requests (not steers), so each request keeps one plan card. */
  private planTurn = 0;
  private changedThisTurn = false;
  private fixedAt = 0;
  private auto = false;
  private notices = new Map<string, string>();
  private functions: FunctionIndex | null = null;
  /** Edits the user approved on a card, so their result can tell the model so. */
  private approved = new Set<string>();
  /** The turn diff that Undo can still take back (the latest turn's, until the next message). */
  private undoable: string | null = null;
  /** The user undid a turn's changes and the model has not been told yet. */
  private undone = false;

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
      // A chat belongs to its provider (its thinking data is that provider's): a new provider opens its own last chat.
      provider.subscribe(p => {
        const t = thread.peek();
        if (this.opened && this.workspace && t && t.provider !== p.id) {
          this.leaveChat();
          this.restore(this.opened);
        }
      }),
      () => setSourceOverride(null),
    );
  }

  /** The test hook's view of the workspace. */
  get ws() {
    return this.workspace;
  }

  /** The turn diff whose changes can be undone, for the transcript's Undo. */
  get undoableDiff() {
    return this.undoable;
  }

  // ---------- the project, its scenario and its chat ----------

  private async openProject(name: string) {
    this.opened = name;
    this.leaveChat();
    this.functions = null;
    void this.loadFunctions(name);
    const query = new URLSearchParams(location.search);
    const id = query.get('scenario') ?? (name === 'editor-core' ? 'range-edge' : null);
    const scenario = id ? await this.loadScenario(id, name) : null;
    // A later open (another project chosen meanwhile) wins.
    if (this.opened !== name) return;
    this.scenario = scenario;
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
    if (this.opened !== name) return;
    setSourceOverride((ds, path) => (ds !== name ? null : (ws.edited(path) ?? (s && path === s.breakPatch.file ? brokenText : null))));
    if (s) this.events.refresh(s.breakPatch.file);
    scenarioState.value = s ? 'broken' : 'none';
    changedFiles.value = [];
    const c = composer.peek();
    composer.value = composerOps.initialComposer({ notice: c.notice, mode: c.mode, permission: c.permission });
    this.restore(name);
    if (this.auto) this.startAuto();
  }

  /** The galaxy's function map, for find_function; a project without one leaves the tool saying so. */
  private async loadFunctions(name: string) {
    try {
      const res = await fetch(functionIndexUrl(name));
      const data = res.ok ? await res.json() : null;
      if (data && this.opened === name) this.functions = createFunctionIndex(data);
    } catch {
      // No map: find_function says so.
    }
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
  /** Makes a thread the open chat, and puts the workspace in the state it describes: the scenario's starting files
   * with this chat's edits applied. A chat and its edits are restored together, never one without the other. */
  private adopt(t: StoredThread) {
    const ws = this.workspace;
    if (ws) {
      ws.reset();
      for (const [path, text] of Object.entries(t.files ?? {})) ws.write(path, text);
      void this.settleScenario();
    }
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
    this.undoable = null;
    this.undone = false;
    chatToggles.value = new Map();
    this.turn = this.items.filter(i => i.type === 'userMessage').length;
    this.planTurn = this.turn;
    thread.value = { ...t, messages, items: this.items, requests: [], status: 'idle' };
    this.events.session(t.id, this.port.label);
  }

  /** Before another chat takes this one's place: the turn stops and the chat is kept as it stands, edits included. */
  private leaveChat() {
    this.stopTurn();
    this.publish();
    this.save();
  }

  private newChat() {
    const name = this.opened;
    if (!name) return;
    this.leaveChat();
    const changed = (this.workspace?.changed().length ?? 0) > 0;
    this.workspace?.markTurn();
    this.adopt(createThread(provider.peek().id, name));
    this.save();
    if (changed) composer.value = { ...composer.peek(), notice: NEW_CHAT_NOTICE };
  }

  private openThread(id: string) {
    if (id === thread.peek()?.id) return;
    this.leaveChat();
    const t = this.store.load(id);
    if (!t) return;
    this.adopt(t);
  }

  /** The scenario's state after the workspace was put back: done if the chat had fixed it, else broken. */
  private async settleScenario() {
    const s = this.scenario;
    if (!s || !this.workspace) return;
    const text = await this.workspace.read(s.breakPatch.file).catch(() => null);
    scenarioState.value = text != null && isFixed(s, text) ? 'done' : 'broken';
  }

  private save() {
    const t = thread.peek();
    if (!t || !t.items?.length) return;
    const ws = this.workspace,
      files: Record<string, string> = {};
    for (const path of ws?.changed() ?? []) {
      const text = ws!.edited(path);
      if (text != null) files[path] = text;
    }
    thread.value = { ...t, files };
    this.store.save(thread.peek()!);
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
      // The effort stays the same through a chat, so the provider's cache holds (a setting).
      ...((this.globals.effort as (() => string) | undefined) ? { effort: (this.globals.effort as () => string)() } : {}),
      project: name,
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
    let ended = false;
    // A relay or a network that goes quiet would leave the turn running for good: after IDLE_MS without an event the
    // call is given up and the turn fails, with Retry.
    let idle: ReturnType<typeof setTimeout> | undefined;
    const giveUp = () => {
      if (ended || abort.signal.aborted || call !== this.live.call) return;
      ended = true;
      this.onStream({ type: 'error', code: 'network', message: 'No answer came for a while.' });
      abort.abort();
    };
    const watch = () => {
      clearTimeout(idle);
      idle = setTimeout(giveUp, IDLE_MS);
    };
    watch();
    try {
      await this.port.send(request, event => {
        if (ended || abort.signal.aborted || call !== this.live.call) return;
        if (event.type === 'message' || event.type === 'error') ended = true;
        watch();
        // Progress only keeps the call alive (a long tool input streams with nothing to show).
        if (event.type === 'progress') return;
        this.onStream(event);
      }, abort.signal);
      if (!ended && !abort.signal.aborted && call === this.live.call)
        this.onStream({ type: 'error', code: 'network', message: 'The answer stopped before it was complete.' });
    } catch (e) {
      if (ended || abort.signal.aborted || call !== this.live.call) return;
      this.onStream({ type: 'error', code: 'network', message: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(idle);
    }
  }

  private onStream(event: StreamEvent) {
    if ((event.type === 'thinking' || event.type === 'text') && !this.live.thinking && !this.live.text) playSound('replyStarted');
    if (event.type === 'error') playSound('error');
    if (event.type === 'usage') {
      // The context the request filled, for the context district's gauge. Only a measured count: the recorded session
      // reports none.
      const u = event.usage;
      const context = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + u.output;
      if (context > 0) this.events.usage(context);
      return;
    }
    if (event.type === 'thinking') {
      // The cannon says "Thinking…" once per reply, when the reasoning starts.
      if (!this.live.thinkingStart) this.events.message('reasoning', 'Thinking');
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
      // Calls the loop answered itself (an invalid input, refused by the mode or permission) never run: they settle.
      for (const p of this.loop.pending)
        if (p.state === 'done' && p.result?.isError) this.updateItem(p.id, { status: 'failed', result: p.result.content });
      this.publish();
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
        return void this.items.push({ ...base, type: 'dynamicToolCall', tool: 'show_user', title: `Pointed at ${input.file}${input.line ? `:${input.line}` : ''}`, text: String(input.message ?? ''), arguments: input });
      case 'update_plan': {
        // One plan per request from the user: a steer adds to the same turn's plan.
        const id = `plan-${this.planTurn}`,
          plan = ((input.steps as { text: string; status: string }[]) ?? []).map(s => ({ step: s.text, status: s.status }));
        const k = this.items.findIndex(i => i.id === id);
        if (k >= 0) this.items[k] = { ...this.items[k], plan };
        else this.items.push({ id, type: 'plan', plan });
        return;
      }
      case 'find_function':
        return void this.items.push({ ...base, type: 'commandExecution', command: `find function ${input.name}`, commandActions: [{ type: 'search', query: String(input.name ?? '') }] });
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
    // A function lookup flies a ship to the first file it names.
    const seen = name === 'find_function' ? { path: this.functions?.describe(String(input.name)).files[0] } : input;
    this.events.toolStarted(id, name, seen);
    const s = this.scenario,
      wasOpen = scenarioState.peek() === 'broken';
    const out = await runTool(name, input, ws, {
      showUser: (file, line, message) => {
        agentPointer.value = { file, line, message };
        if ((this.globals.followAgent as (() => boolean) | undefined)?.()) showCode(file, line ?? 1);
      },
      runReplay: which => {
        if (!s) return 'This project has no problem card, so there is no recorded run to replay.';
        // The app cannot run code: it closes the problem only when the broken line is back to its original text.
        if (which === 'fixed' && scenarioState.peek() === 'broken')
          return `The problem card is still open. Nothing runs here, so the app closes it only when the broken line in ${s.file} again reads as it did before the bug; a different change, even a correct one, does not close it. An edit may also still be waiting for approval. Read the file again.`;
        // Already on screen (the app starts the fixed run itself when the problem closes).
        if (replay.peek()?.which !== which) replayRequest.value = { which };
        return null;
      },
      functions: this.functions,
    });
    this.events.toolFinished(id, name, seen, !out.isError);
    if (out.change && !out.isError) playSound('editAccepted');
    const status = out.isError ? 'failed' : 'completed';
    if (out.change) {
      this.changedThisTurn = true;
      this.updateItem(id, { status, changes: [{ path: out.change.path, diff: out.change.diff, kind: out.change.created ? 'add' : 'update' }] });
    } else if (name === 'read_file' || name === 'search' || name === 'list_files' || name === 'find_function') this.updateItem(id, { status, output: out.content, exitCode: out.isError ? 1 : 0 });
    else this.updateItem(id, { status, result: out.content });
    if (out.change && !out.isError) {
      // Kept at once: whatever ends the turn (a failure, another chat), the chat holds the edit it shows.
      await this.checkFixed();
      this.publish();
      this.save();
      // This edit closed the problem: the payoff does not wait on the model remembering run_replay. The fixed run
      // plays by itself (the model's own call, if it comes, finds it running). Only an edit made now does this; a
      // restored chat that already holds the fix opens quietly.
      if (s && wasOpen && scenarioState.peek() === 'fixed')
        setTimeout(() => {
          if (this.scenario === s && (scenarioState.peek() === 'fixed' || scenarioState.peek() === 'done') && !replay.peek()) replayRequest.value = { which: 'fixed' };
        }, REPLAY_AFTER_FIX_MS);
    }
    if (this.loop.status !== 'tools') return;
    // The model cannot see the approval card: a result that says the user approved stops it waiting for one.
    const content = out.change && !out.isError && this.approved.delete(id) ? `${out.content} The user approved it: the change is in place.` : out.content;
    this.dispatch({ type: 'toolFinished', id, content, isError: out.isError });
  }

  private async askApproval(id: string, name: string, input: Record<string, unknown>) {
    const ws = this.workspace;
    try {
      if (!ws) throw new Error('The project is not open yet.');
      const preview = await previewEdit(name, input, ws);
      this.updateItem(id, { changes: [{ path: preview.path, diff: preview.diff }] });
      // The user decides with the code in front of them, whether or not the agent pointed at it first.
      this.showEdit(preview.path, firstChangedLine(preview.diff));
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

  /** Brings up the place an edit changes, when the scene follows the agent and is not already there. */
  private showEdit(path: string, line: number | null) {
    if (!(this.globals.followAgent as (() => boolean) | undefined)?.() || line == null || !galaxyState.nodes.some(n => n.path === path)) return;
    const where = whereNow().code;
    const shown = where?.fnRange ?? where?.range;
    if (where?.file === path && shown && line >= shown.start && line <= shown.end) return;
    showCode(path, line);
  }

  private askUser(id: string, input: Record<string, unknown>) {
    // Every question can be answered by hand: one with no options gets "You decide" (voice may be unavailable).
    const questions = ((input.questions as ChatQuestion[]) ?? []).map(q => ({
      ...q,
      options: q.options?.length ? q.options : [{ label: YOU_DECIDE, description: 'Go with what you think is best.' }],
    }));
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
    const chat = thread.peek()?.id;
    this.requests = [];
    answers.value = new Map();
    // A turn leaves nothing running: half-streamed text goes, rows still open settle as failed.
    this.items = this.items
      .filter(i => !i.id?.startsWith('live-'))
      .map(i => (i.status === 'inProgress' || i.status === 'running' ? { ...i, status: 'failed' } : i));
    if (this.changedThisTurn && this.workspace) {
      const diff = await this.workspace.turnDiff();
      // Another chat was opened meanwhile: this turn's ending belongs to the old one, which was saved as it stopped.
      if (thread.peek()?.id !== chat) return;
      if (diff) {
        this.undoable = `diff-${this.turn}`;
        this.items.push({ id: this.undoable, type: 'turnDiff', diff });
      }
    }
    this.changedThisTurn = false;
    this.events.turnFinished(outcome === 'completed' ? 'completed' : outcome === 'stopped' ? 'interrupted' : 'failed');
    const step = composerOps.turnEnded(composer.peek());
    composer.value = outcome === 'truncated' ? { ...step.state, notice: CUT_OFF_NOTICE } : outcome === 'refused' ? { ...step.state, notice: REFUSED_NOTICE } : step.state;
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

  private say(text: string, attachContext: boolean, steer = false) {
    playSound('send');
    if (!steer) this.planTurn++;
    // The note the model gets with the words: the open problem (a chat's first message) and where the user is.
    const first = !steer && !this.loop.messages.length;
    const note = contextNote(whereNow(true), { first, attach: attachContext, undone: this.undone });
    this.undone = false;
    const label = attachContext ? lookingLabel(whereNow()) : null;
    this.turn++;
    this.items.push({ id: `u${Date.now().toString(36)}${this.turn}`, type: 'userMessage', text, attachmentNames: label ? [label] : [] });
    // A steer belongs to the running turn: the turn's diff keeps its starting point.
    if (!steer) {
      this.workspace?.markTurn();
      this.undoable = null;
      this.events.turnStarted(text);
    }
    agentPointer.value = null;
    this.dispatch({ type: 'settings', permission: composer.peek().permission, mode: composer.peek().mode });
    this.dispatch({ type: steer ? 'steer' : 'userSaid', text: text + note });
    if (first && provider.peek().id === 'recorded') composer.value = { ...composer.peek(), notice: RECORDED_NOTICE };
    this.save();
  }

  /** Calls the model again after a failed turn, with the conversation as it stands. */
  private retry() {
    if (this.loop.status !== 'failed') return;
    playSound('send');
    this.dispatch({ type: 'retry' });
  }

  /** Puts the files back as they were before the latest turn, and tells the model with the next message. */
  private undo(id: string) {
    const ws = this.workspace;
    if (!ws || id !== this.undoable || this.loop.status === 'calling' || this.loop.status === 'tools') return;
    ws.undoTurn();
    this.undoable = null;
    this.undone = true;
    this.updateItem(id, { status: 'undone' });
    void this.settleScenario();
    this.publish();
    this.save();
  }

  /** Shows a place the agent pointed at earlier, from its row in the transcript. */
  private pointAgain(id: string) {
    const a = this.items.find(i => i.id === id)?.arguments as { file?: string; line?: number; message?: string } | undefined;
    if (!a?.file) return;
    agentPointer.value = { file: a.file, line: a.line ?? null, message: a.message ?? '' };
    showCode(a.file, a.line ?? 1);
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
      case 'retry':
        return this.retry();
      case 'undo':
        return this.undo(arg);
      case 'point':
        return this.pointAgain(arg);
    }
  }

  private decide(id: string, accept: boolean) {
    const request = this.requests.find(r => r.id === id);
    if (!request || isQuestionRequest(request)) return;
    this.requests = this.requests.filter(r => r.id !== id);
    if (!accept) this.updateItem(id, { status: 'declined' });
    else this.approved.add(id);
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
export const YOU_DECIDE = 'You decide';

/** A file's baked text, never the override (the workspace is the override). */
async function readBaked(name: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl(name, path));
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
