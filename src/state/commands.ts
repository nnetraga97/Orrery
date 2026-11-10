// Typed commands: the only way panels, gestures and tests ask the app to change. The galaxy system connects the
// handler that carries them out; until it does, a command does nothing.
import { codePageOpen, codeRequest, dataset, pinned } from './app-state.ts';

export interface CommandHandler {
  openDataset(name: string): void;
  selectFile(path: string | null): void;
  landOn(path: string, line?: number | null): void;
  leavePlanet(): void;
  goHome(): void;
}

let handler: CommandHandler | null = null;

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

/** Shows `line` of `path` on the code page: lands on the file if needed, then selects the function holding the line
 * and scrolls there (the landed planet focuses the line, and the inspector follows its selection). */
export function showCode(path: string, line: number): void {
  codePageOpen.value = true;
  codeRequest.value = { path, line };
  handler?.landOn(path, line);
}

/** Closes the pinned info card. */
export function closeCard(): void {
  pinned.value = null;
}
/** Opens the current project again after an error. */
export function retry(): void {
  if (dataset.peek()) openDataset(dataset.peek()!);
}

export const commands = { openDataset, selectFile, landOn, leavePlanet, goHome, showCode, closeCard, retry };
export type Commands = typeof commands;
