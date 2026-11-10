// The projects the app can open. Each is a dataset baked by tools/bake-dataset.mjs under public/data/<name>/.
export interface DatasetEntry {
  name: string;
  title: string;
  blurb: string;
  licence?: string;
}

export interface DatasetPort {
  /** Every project that can be opened, from public/data/index.json. */
  list(): Promise<DatasetEntry[]>;
}
