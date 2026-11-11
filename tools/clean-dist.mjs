#!/usr/bin/env node
// Removes dist/ before a build, retrying: on macOS the Finder can write a .DS_Store into a folder while Vite empties
// it, and Vite's own emptying then fails with ENOTEMPTY ("error during build"). With dist/ gone there is nothing to race.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
fs.rmSync(dist, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
