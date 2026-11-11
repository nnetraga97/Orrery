// Small values the app keeps between visits on this device (for example, that the tutorial was seen, or the chats).
export interface StoragePort {
  get(key: string): string | null;
  /** Stores a value; returns false if the device would not keep it (storage full or blocked). */
  set(key: string, value: string): boolean | void;
  remove(key: string): void;
}
