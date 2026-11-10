#!/usr/bin/env node
// Runs every offline check in galaxy/checks/ and reports which failed. Usage: node tools/run-checks.mjs [name filter]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(repo, 'galaxy/checks');
const filter = process.argv[2] || '';
const checks = fs
  .readdirSync(dir)
  .filter(name => name.endsWith('.mjs') && name.includes(filter))
  .sort();
if (!checks.length) {
  console.error(`no checks match "${filter}" in galaxy/checks`);
  process.exit(1);
}
const failed = [];
for (const name of checks) {
  const result = spawnSync(process.execPath, [path.join(dir, name)], { cwd: repo, encoding: 'utf8', timeout: 120000 });
  const ok = result.status === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) {
    failed.push(name);
    console.log((result.stderr || result.stdout || '').trim().split('\n').slice(-12).join('\n'));
  }
}
console.log(failed.length ? `${failed.length} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
