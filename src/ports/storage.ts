// Small values the app keeps between visits on this device (for example, that the tutorial was seen).
export interface StoragePort {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
