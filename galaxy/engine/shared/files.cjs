// File helpers shared by every Node host: atomic writes and bounded JSONL reads.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Write to a sibling temporary file, then rename, so readers never see a partial file.
const temporaryName = file => `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;

async function writeFileAtomic(file, data, { mode } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = temporaryName(file);
  try {
    await fsp.writeFile(temporary, data, { mode });
    await fsp.rename(temporary, file);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

function writeFileAtomicSync(file, data, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = temporaryName(file);
  try {
    fs.writeFileSync(temporary, data, { mode });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const toJSON = value => JSON.stringify(value, null, 2);

// An unreadable state file moves aside (kept for inspection) so the app can start from defaults.
function setAsideSync(file) {
  const aside = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, aside);
    return aside;
  } catch {
    return null;
  }
}
const writeJSONAtomic = (file, value, options) => writeFileAtomic(file, toJSON(value), options);
const writeJSONAtomicSync = (file, value, options) => writeFileAtomicSync(file, toJSON(value), options);

function parseLines(lines) {
  const records = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A malformed or cut-off line is skipped, not fatal.
    }
  }
  return records;
}

// Reads at most maxBytes from the start (or the end) of a JSONL file and parses each complete line.
// A line cut by the byte window is dropped. Returns { records, size } where size is the file size read.
async function readJSONL(file, { maxBytes, fromEnd = false }) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const offset = fromEnd ? size - length : 0;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (offset > 0) lines.shift();
    if (!fromEnd && bytesRead < size) lines.pop();
    return { records: parseLines(lines), size };
  } finally {
    await handle.close();
  }
}

module.exports = {
  writeFileAtomic,
  writeFileAtomicSync,
  writeJSONAtomic,
  writeJSONAtomicSync,
  readJSONL,
  setAsideSync,
};
