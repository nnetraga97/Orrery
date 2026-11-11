// What the UI shows, as signals. Systems and the bridge publish here; panels read; commands (commands.ts) change it.
import { signal } from '@iwsdk/core';
import { initialComposer } from '../core/chat/composer.ts';
import type { ComposerState } from '../core/chat/composer.ts';
import type { AnswerState } from '../core/chat/requests.ts';
import type { StoredThread, ThreadSummary } from '../core/chat/threads.ts';
import type { Scenario } from '../core/scenario.ts';
import { DEFAULT_SETTINGS } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { idleSpeech } from '../core/speech.ts';
import type { SpeechState } from '../core/speech.ts';
import type { CodeView } from '../core/code-view.ts';
import type { TutorialStep } from '../core/tutorial.ts';
import type { ContextItem } from '../ports/host.ts';

export type Phase = 'idle' | 'loading' | 'overview' | 'landed';
export interface Loading {
  title: string;
  detail: string;
}

export const dataset = signal<string | null>(null);
export const phase = signal<Phase>('idle');
export const selectedPath = signal<string | null>(null);
export const landedPath = signal<string | null>(null);
export const pinned = signal<ContextItem | null>(null);
export const hovered = signal<ContextItem | null>(null);
export const loading = signal<Loading | null>(null);
export const error = signal<string | null>(null);

export type { CodeRegion, CodeView, LineRange, Segment } from '../core/code-view.ts';
export const codeView = signal<CodeView | null>(null);
/** A line the app asked to show (commands.showCode), until the code card has selected it. */
export const codeRequest = signal<{ path: string; line: number } | null>(null);
/** Lines scrolled from the top of what the code card shows. */
export const codeScroll = signal(0);
/** Whether the code card is open: set when the user picks a function or a statement, or by showCode; cleared by
 * its close mark and by a new landing (whose start town the copied code picks by itself). */
export const codeCardOpen = signal(false);
/** Rows the code card shows: 12, or 24 after `More`. */
export const codeCardRows = signal(12);
/** Whether the chat window is shown (closed from its close mark, brought back by the Chat tab). */
export const agentOpen = signal(true);
/** Bumped to restart the tutorial (commands.restartTutorial). */
export const tutorialRestarts = signal(0);
/** Counts orbit gestures (a pinch-drag that turned the model). */
export const orbits = signal(0);
/** The tutorial's step. */
export const tutorialStep = signal<TutorialStep>('done');
/** The open chat (its transcript, requests and conversation). */
export const thread = signal<StoredThread | null>(null);
/** The chats kept on this device, newest first. */
export const threads = signal<ThreadSummary[]>([]);
/** What the chat window shows: the transcript, the chat list or the settings. */
export type ChatPage = 'transcript' | 'threads' | 'settings';
export const chatPage = signal<ChatPage>('transcript');
/** The composer: what was heard and not yet sent, the queue, mode and permission. */
export const composer = signal<ComposerState>(initialComposer());
/** Push-to-talk: listening, heard, or unavailable, and the words so far. */
export const speech = signal<SpeechState>(idleSpeech());
/** Where the next heard words go: the composer, a question's spoken answer, or a queued message said again. */
export type VoiceTarget =
  | { kind: 'composer' }
  | { kind: 'answer'; requestId: string; questionId: string }
  | { kind: 'queue'; id: string };
export const voiceTarget = signal<VoiceTarget>({ kind: 'composer' });
/** Answers given so far to the agent's open questions, by request id. */
export const answers = signal<ReadonlyMap<string, AnswerState>>(new Map());
/** Which expandable rows and groups of the transcript the reader opened or closed, by toggle key. */
export const chatToggles = signal<ReadonlyMap<string, boolean>>(new Map());
/** The agent's pointer (show_user): a place in the code and what to look at, until dismissed. */
export const agentPointer = signal<{ file: string; line: number | null; message: string } | null>(null);
/** A replay the agent or the user asked for, until the replay system takes it. */
export const replayRequest = signal<{ which: 'failing' | 'fixed' } | null>(null);
/** The bug scenario of the open project, if it has one. */
export const scenario = signal<Scenario | null>(null);
/** The scenario's state: broken, fixed just now (shown green for five seconds), or done. */
export const scenarioState = signal<'none' | 'broken' | 'fixed' | 'done'>('none');
/** Files the agent has changed in the workspace. */
export const changedFiles = signal<string[]>([]);
/** The chat's provider, its label, whether it can answer, and the providers to choose from. */
export const provider = signal<{ id: string; label: string; available: boolean; choices: { id: string; label: string; available: boolean }[]; models: string[]; model: string }>({
  id: 'recorded',
  label: 'Recorded',
  available: true,
  choices: [{ id: 'recorded', label: 'Recorded', available: true }],
  models: [],
  model: '',
});
/** The running replay, as the code card and the debugging card show it, or null. */
export type ReplayView = {
  which: 'failing' | 'fixed';
  title: string;
  outcome: 'fails' | 'passes';
  index: number;
  total: number;
  playing: boolean;
  file: string;
  line: number;
  label: string;
  note: string | null;
  variables: { name: string; value: string }[];
  /** The scene follows each step (lands on its file and shows its line). */
  following: boolean;
  /** The "Agent is debugging" card was dismissed. */
  noticeDismissed: boolean;
};
export const replay = signal<ReplayView | null>(null);
/** The master volume (0 to 1) and mute, set from the settings. */
export const soundLevel = signal({ volume: 0.6, mute: false });
/** The settings (src/core/settings.ts), kept on this device. */
export const settings = signal<Settings>(DEFAULT_SETTINGS);
/** Bumped by Reset layout: every window goes back to its place. */
export const layoutResets = signal(0);
/** Inspector calls kept for the next plan (debugger tabs, transport, stack, evidence). */
export const inspectorExtras = signal<Record<string, unknown[]>>({});

export const appState = {
  dataset,
  phase,
  selectedPath,
  landedPath,
  pinned,
  hovered,
  loading,
  error,
  codeView,
  codeScroll,
  codeCardOpen,
  codeCardRows,
  codeRequest,
  agentOpen,
  tutorialRestarts,
  orbits,
  tutorialStep,
  inspectorExtras,
  thread,
  threads,
  chatPage,
  composer,
  speech,
  voiceTarget,
  answers,
  chatToggles,
  agentPointer,
  replayRequest,
  scenario,
  scenarioState,
  changedFiles,
  provider,
  replay,
  soundLevel,
  settings,
  layoutResets,
};
export type AppState = typeof appState;
