// DatasetPort over the baked files the page ships with (public/data/).
import type { DatasetEntry, DatasetPort } from '../ports/dataset.ts';

export function createStaticDataset(base = 'data/'): DatasetPort {
  return {
    async list() {
      const response = await fetch(`${base}index.json`);
      if (!response.ok) throw new Error(`Could not load the list of projects (${response.status}).`);
      return (await response.json()) as DatasetEntry[];
    },
  };
}
