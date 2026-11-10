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
export function openGalaxy(host: XrHost, dataset: string, options?: { cannon?: boolean }): Promise<GalaxyView>;
export function fileIndex(path: string): number;
