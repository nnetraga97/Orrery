// Replaces the desktop shell's project store (codebase-viz viewer/app/project-store.ts), which talked to Electron.
// Here the galaxy's layout memory and small preferences live in localStorage. galaxy-memory.ts imports `desktop` and
// `reportError` from this file; hosts use `remember` and `remembered`.
const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows); the galaxy then lays itself out afresh each time.
  }
};

export const desktop = {
  getGalaxyMemory: async (project: string) => read(`galaxy-memory:${project}`),
  setGalaxyMemory: async (project: string, value: unknown) => write(`galaxy-memory:${project}`, value),
};

export const reportError = (message: string) => console.warn(message);

export const remembered = (key: string): string | null => {
  const value = read(`preference:${key}`);
  return value == null ? null : String(value);
};
export const remember = (key: string, value: string | number) => write(`preference:${key}`, value);
