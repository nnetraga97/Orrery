export type ExceptionMode = 'failures' | 'all' | 'uncaught' | 'none';
export type Settings = {
  debug?: {
    python?: string;
    exceptionMode?: ExceptionMode;
    configurations?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  problems?: {
    enabled?: boolean;
    typescript?: boolean;
    python?: boolean;
    java?: boolean;
    maxFiles?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
export type SettingsSnapshot = {
  personal: Settings;
  project: Settings;
  effective: Settings;
  paths: { personal: string; project?: string };
};
export type DebugConfiguration = {
  name: string;
  type: string;
  request: string;
  source: 'launch.json' | 'project' | 'personal' | 'detected';
  supported: boolean;
  reason?: string;
};
export type AdapterStatus = {
  id: 'js-debug' | 'debugpy' | 'java-debug';
  installed: boolean;
  version: string;
  path: string;
  reason?: string;
  jdtls?: string | null;
  javaMajor?: number | null;
  available?: boolean;
};
export const settingsBridge = window.galaxyDesktop as unknown as {
  settingsGet(projectId?: string): Promise<SettingsSnapshot>;
  settingsSet(scope: 'personal' | 'project', projectId: string | undefined, value: Settings): Promise<SettingsSnapshot>;
  onSettingsEvent(fn: (value: SettingsSnapshot) => void): () => void;
  debugConfigurations(projectId: string): Promise<DebugConfiguration[]>;
  debugAdapterStatus(): Promise<AdapterStatus[]>;
  debugAdapterInstall(id: AdapterStatus['id']): Promise<unknown>;
  copyText(text: string): Promise<void>;
};
export const exceptionModes = [
  ['failures', 'Failures'],
  ['all', 'All exceptions'],
  ['uncaught', 'Uncaught only'],
  ['none', 'None'],
] as const;
export const adapterDetails = {
  'js-debug': { label: 'JavaScript / TypeScript', version: '1.140.0', download: '1.2 MB download from GitHub' },
  debugpy: { label: 'Python', version: '1.8.22', download: '5.4 MB download from PyPI' },
  'java-debug': { label: 'Java', version: '0.53.2', download: '3.5 MB download from Open VSX' },
};
export function adapterFor(type: string, entry = ''): AdapterStatus['id'] {
  if (['python', 'debugpy'].includes(type) || /\.py$/i.test(entry)) return 'debugpy';
  if (type === 'java' || /\.java$/i.test(entry)) return 'java-debug';
  return 'js-debug';
}
