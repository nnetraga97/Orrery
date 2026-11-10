const fs = require('node:fs/promises');
const definitions = [
  [
    'show_user',
    'Point the user at one file or source line with a short explanation. Use sparingly.',
    {
      file: { type: 'string', description: 'Project-relative existing file' },
      line: { type: 'integer', minimum: 1 },
      message: { type: 'string', minLength: 1, maxLength: 280 },
    },
    ['file', 'message'],
  ],
];
async function prepare(input, { root, resolvePath }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be an object.');
  if (typeof input.file !== 'string' || !input.file) throw new Error('file must be a project-relative path.');
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 280)
    throw new Error('message must contain 1 to 280 characters.');
  const canonicalRoot = await fs.realpath(root);
  const file = await resolvePath(canonicalRoot, input.file);
  const stat = await fs.stat(file.absolute);
  if (!stat.isFile()) throw new Error('file must be an existing regular file.');
  // Line counting reads the file, so very large files (logs, data dumps) are shown without a line.
  if (stat.size > 8 * 1024 * 1024) {
    if (input.line !== undefined) throw new Error('line is not supported for files over 8 MB.');
    return { ...file, action: 'read', files: [file.relative] };
  }
  const count = (await fs.readFile(file.absolute, 'utf8')).split(/\r\n|\r|\n/).length;
  if (input.line !== undefined && (!Number.isInteger(input.line) || input.line < 1 || input.line > count))
    throw new Error(`line must be an integer from 1 to ${count}.`);
  return { ...file, action: 'read', files: [file.relative] };
}
async function execute(input, prepared, { root, resolvePath, show, signal }) {
  signal?.throwIfAborted();
  // Revalidate at dispatch in case the source or a symlink changed during preparation.
  const file = await prepare(input, { root, resolvePath });
  signal?.throwIfAborted();
  const result = await show({ file: file.relative, line: input.line, message: input.message });
  if (result?.error) throw new Error(result.error);
  const label = result?.following ? 'Shown to the user' : 'Offered to the user (they are not following the agent)';
  return { ok: true, output: `${label}: ${file.relative}:${input.line ?? 1}` };
}
module.exports = { definitions, prepare, execute };
