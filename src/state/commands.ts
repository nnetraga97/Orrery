// Typed commands: the only way panels, gestures and tests ask the app to change. The galaxy system connects the
// handler that carries them out; until it does, a command does nothing.
import { agentOpen, chatPage, codeCardOpen, codeRequest, dataset, pinned, tutorialRestarts } from './app-state.ts';
import type { ChatPage } from './app-state.ts';

export interface CommandHandler {
  openDataset(name: string): void;
  selectFile(path: string | null): void;
  landOn(path: string, line?: number | null): void;
  leavePlanet(): void;
  goHome(): void;
}

let handler: CommandHandler | null = null;

/** The chat's commands, carried out by the agent system. */
export interface ChatHandler {
  newChat(): void;
  openThread(id: string): void;
}
let chat: ChatHandler | null = null;
export function connectChat(next: ChatHandler): () => void {
  chat = next;
  return () => {
    if (chat === next) chat = null;
  };
}

/** Connects the handler; returns the function that disconnects it. */
export function connectCommands(next: CommandHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function openDataset(name: string): void {
  dataset.value = name;
  handler?.openDataset(name);
}
export function selectFile(path: string | null): void {
  handler?.selectFile(path);
}
export function landOn(path: string, line: number | null = null): void {
  handler?.landOn(path, line);
}
export function leavePlanet(): void {
  handler?.leavePlanet();
}
export function goHome(): void {
  handler?.goHome();
}

/** Shows `line` of `path` on the code card: lands on the file if needed, then selects the function holding the line
 * and opens the card with the line banded (the landed planet focuses the line, and the inspector follows it). */
export function showCode(path: string, line: number): void {
  codeRequest.value = { path, line };
  codeCardOpen.value = true;
  handler?.landOn(path, line);
}

/** Shows the chat window (the Chat tab). */
export function showChat(): void {
  agentOpen.value = true;
}
/** Hides the chat window (its close mark). */
export function hideChat(): void {
  agentOpen.value = false;
}
/** Shows the transcript, the chat list or the settings in the chat window, and the window itself. */
export function showChatPage(page: ChatPage): void {
  chatPage.value = page;
  agentOpen.value = true;
}
/** Starts a new chat for the current provider and project. */
export function newChat(): void {
  chat?.newChat();
  chatPage.value = 'transcript';
}
/** Opens a kept chat. */
export function openThread(id: string): void {
  chat?.openThread(id);
  chatPage.value = 'transcript';
}
/** Starts the tutorial again (from Settings in the next plan). */
export function restartTutorial(): void {
  tutorialRestarts.value = tutorialRestarts.peek() + 1;
}

/** Closes the pinned info card. */
export function closeCard(): void {
  pinned.value = null;
}
/** Opens the current project again after an error. */
export function retry(): void {
  if (dataset.peek()) openDataset(dataset.peek()!);
}

export const commands = {
  openDataset,
  selectFile,
  landOn,
  leavePlanet,
  goHome,
  showCode,
  showChat,
  hideChat,
  showChatPage,
  newChat,
  openThread,
  restartTutorial,
  closeCard,
  retry,
};
export type Commands = typeof commands;
