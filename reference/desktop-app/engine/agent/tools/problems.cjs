const definitions = [
  [
    'problems',
    'Read type and syntax diagnostics from the language servers, optionally waiting for specific files. It does not run code, so it cannot show wrong runtime values.',
    { files: { type: 'array', items: { type: 'string' } } },
    [],
  ],
];
function prepare(input) {
  if (input.files != null && (!Array.isArray(input.files) || input.files.some(file => typeof file !== 'string')))
    throw new Error('files must be an array of paths');
  return { action: 'read', files: input.files || [] };
}
async function execute(input, { debug, signal }) {
  signal?.throwIfAborted();
  const snapshot = await debug.problems.get(debug.projectId, input.files);
  const rank = { error: 0, warning: 1, info: 2, hint: 3 };
  const diagnostics = [...snapshot.diagnostics].sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
  const lines = diagnostics
    .slice(0, 200)
    .map(d => `${d.file}:${d.line}:${d.column} ${d.severity} ${d.source} ${d.message.replace(/\s+/g, ' ')}`);
  if (diagnostics.length > 200) lines.push(`[${diagnostics.length - 200} more diagnostics]`);
  for (const server of snapshot.servers)
    if (server.status !== 'ready')
      lines.push(`${server.label}: ${server.status}${server.reason ? ` — ${server.reason}` : ''}`);
  return { ok: true, output: lines.join('\n') || 'No problems.' };
}
module.exports = { definitions, prepare, execute };
