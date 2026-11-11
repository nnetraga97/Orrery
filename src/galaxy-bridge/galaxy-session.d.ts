import type { HostFileNode, HostImportLink, HostPort } from '../ports/host.ts';
import type { XrHost } from './xr-host.ts';

export interface GalaxyView {
  stop(): void;
  select(i: number | null, options?: { fly?: boolean }): void;
  land?(i: number, options: { line: number | null; arrival: unknown; townId?: string | null }): void;
  leave?(): void;
  readonly landed?: boolean;
  readonly pinned?: number | null;
  [member: string]: unknown;
}
export const galaxyState: {
  readonly dataset: string | null;
  readonly revision: number | null;
  readonly nodes: HostFileNode[];
  readonly links: HostImportLink[];
  readonly groups: string[];
  readonly grouping: string;
  readonly groupIndex: unknown;
  readonly out: number[][];
  readonly inc: number[][];
  readonly selected: number | null;
  readonly view: (GalaxyView & { overview?(): unknown }) | null;
  readonly cache: Record<string, unknown>;
  color(group: string): string;
};
export const actions: HostPort['actions'];
export const projects: Map<string, { version: number }>;
export const G: HostPort['graph']['groupOf'];
export const fetchSymbols: HostPort['graph']['fetchSymbols'];
export const groupArms: HostPort['graph']['groupArms'];
export const importUse: HostPort['graph']['importUse'];
export const importsIndexed: HostPort['graph']['importsIndexed'];
export const membersOf: HostPort['graph']['membersOf'];
export const nodeOf: HostPort['graph']['nodeOf'];
export const fileAppearance: HostPort['memory']['fileAppearance'];
export const townKeys: HostPort['memory']['townKeys'];
export const galaxyLayoutNotice: HostPort['memory']['layoutNotice'];
export const layoutMemory: HostPort['memory']['layout'];
export const saveGalaxyMemory: HostPort['memory']['save'];
export const remember: HostPort['preferences']['remember'];
export const remembered: HostPort['preferences']['recall'];
export function installActions(host: XrHost, publish: { selected(path: string | null): void }): void;
export function openGalaxy(
  host: XrHost,
  dataset: string,
  options?: { cannon?: boolean; isCurrent?: () => boolean },
): Promise<GalaxyView | null>;
export function fileIndex(path: string): number;
export function planetBuildBudget(
  signal?: AbortSignal,
  dispose?: () => void,
  options?: { frameBound?: boolean; milliseconds?: number },
): (force?: boolean) => Promise<void>;
export function languageOf(path: string): { frontEnd?: string; [member: string]: unknown } | null | undefined;
/** Loads the vendored TypeScript compiler as window.ts (once). */
export function loadTypeScript(): Promise<unknown>;
/** The copied icon set: shape(name) is the SVG markup inside a 24-unit viewBox. */
export const UIIcons: { shape(name: string): string };
/** A file's text: the source override's (the workspace's edits) when it has one, else the baked file's; null if neither. */
export function readSource(dataset: string, path: string): Promise<string | null>;
/** Lets the host supply edited text: `fn(dataset, path)` returns a string, or null to read the baked file. */
export function setSourceOverride(fn: ((dataset: string, path: string) => string | null) | null): void;
/** Where a baked file's text lives. */
export function sourceUrl(dataset: string, path: string): string;
