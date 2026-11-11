// What the UI shows, as signals. Systems and the bridge publish here; panels read; commands (commands.ts) change it.
import { signal } from '@iwsdk/core';
import { initialComposer } from '../core/chat/composer.ts';
import type { ComposerState } from '../core/chat/composer.ts';
import type { AnswerState } from '../core/chat/requests.ts';
import type { StoredThread, ThreadSummary } from '../core/chat/threads.ts';
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
};
export type AppState = typeof appState;
