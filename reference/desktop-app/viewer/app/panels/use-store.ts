// React access to the viewer store (app/state.ts): a component re-renders when the key it reads changes.
import { useSyncExternalStore } from 'react';
import { state, subscribe, type State } from '../state.ts';

export function useStore<K extends keyof State>(key: K): State[K] {
  return useSyncExternalStore(
    notify => subscribe([key], notify),
    () => state[key],
  );
}
