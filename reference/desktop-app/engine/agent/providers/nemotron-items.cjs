const { clip } = require('./nemotron-tools.cjs');

function toolItem(id, name, input, prepared, result) {
  const base = { id, tool: name };
  const output = result?.output || '';
  if (name === 'show_user')
    return {
      ...base,
      type: 'dynamicToolCall',
      arguments: input,
      result: output,
      title: `${result?.ok ? (output.startsWith('Offered') ? 'Offered to show you' : 'Showed you') : 'Show location'} ${prepared.relative || input.file}:${input.line ?? 1}`,
    };
  if (name === 'problems' || name.startsWith('debug_'))
    return { ...base, type: 'dynamicToolCall', arguments: input, result: output };
  if (name === 'run_command')
    return { ...base, type: 'commandExecution', command: input.command || '', output, exitCode: result?.exitCode };
  if (['edit', 'create'].includes(prepared.action) && prepared.relative) {
    const diff =
      name === 'replace_in_file'
        ? input.old_text
            .split('\n')
            .map(line => '-' + line)
            .join('\n') +
          '\n' +
          input.new_text
            .split('\n')
            .map(line => '+' + line)
            .join('\n')
        : input.content
            .split('\n')
            .map(line => '+' + line)
            .join('\n');
    return {
      ...base,
      type: 'fileChange',
      changes: [
        { path: prepared.relative, kind: prepared.action === 'create' ? 'add' : 'update', diff: clip(diff, 20000) },
      ],
    };
  }
  if (['list_files', 'read_file', 'search', 'semantic_search'].includes(name))
    return {
      ...base,
      type: 'commandExecution',
      command: `${name} ${name === 'semantic_search' ? JSON.stringify(input.query || '') : input.path || '.'}`,
      commandActions: [
        {
          type: ['search', 'semantic_search'].includes(name) ? 'search' : name === 'list_files' ? 'listFiles' : 'read',
          path: prepared.relative || '',
          name: input.path || '.',
          query: input.query || input.pattern,
        },
      ],
      output,
    };
  return { ...base, type: 'dynamicToolCall', tool: name, arguments: input, result: output };
}
module.exports = { toolItem };
