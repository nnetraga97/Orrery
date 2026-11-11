// StoragePort over the browser's localStorage, namespaced; quietly does nothing when storage is unavailable.
import type { StoragePort } from '../ports/storage.ts';

export function createLocalStorage(prefix = 'orrery:'): StoragePort {
  return {
    get(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, value);
        return true;
      } catch {
        // Private browsing, blocked or full storage: the value lasts for this visit only.
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        // Nothing stored to remove.
      }
    },
  };
}
