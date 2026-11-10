// The galaxy's own tools, offered to every agent provider: pointing the user at code (show_user), project diagnostics,
// the agent debugger and, once built, atlas search. Nemotron gets them beside its file tools; Codex and Claude bring
// their own file tools and get only these, through Codex dynamic tools and a Claude SDK MCP server.
const fs = require('node:fs/promises');
const path = require('node:path');
const { clip, toolsFor, prepareTool, executeTool } = require('./providers/nemotron-tools.cjs');
const debugTools = require('./tools/debug.cjs');

const NAMES = new Set(['semantic_search', 'show_user', 'problems', ...debugTools.definitions.map(([name]) => name)]);
// Tools that only read or point; they run without an approval prompt in any chat.
const PASSIVE = new Set(['semantic_search', 'show_user', 'problems', 'debug_inspect']);
const AGENTS = { nemotron: 'Nemotron', codex: 'Codex', claude: 'Claude' };

function galaxyGuidance({ debug, show, semanticSearch } = {}) {
  return [
    'You are working inside Codebase Galaxy, a visual IDE and debugger that draws this codebase as a galaxy of files and functions.',
    `When the user asks where or why something happens, find it and explain it${show ? ', pointing at the place with show_user' : ''}; do not edit files until they ask for a change.`,
    debug &&
      'When behavior is wrong at runtime, run it under the debugger early instead of reading many files: debug_probe to see values at chosen lines, or debug_start with exception_mode all when an error may be caught and hidden. Use problems after edits for type and syntax errors. Hand off with debug_handoff when stuck or when the user should look. When the user asks about their own paused debugger, use debug_inspect; it reads their session without taking control.',
    show &&
      'Use show_user sparingly to point at the one place that explains a finding or a change, at most a few times per turn.',
    semanticSearch && 'Use semantic_search first for where-is-X questions about the codebase.',
  ]
    .filter(Boolean)
    .join(' ');
}

// Codex and Claude often name files by absolute path. Paths inside the project become project-relative; anything
// else is left for the tool's own containment check to reject.
async function projectRelative(root, input) {
  const roots = [...new Set([path.resolve(root), await fs.realpath(root).catch(() => path.resolve(root))])];
  const relative = value => {
    if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
    const base = roots.find(r => value.startsWith(r + path.sep));
    return base ? path.relative(base, value).split(path.sep).join('/') : value;
  };
  const args = { ...input };
  for (const key of ['file', 'entry', 'path']) if (key in args) args[key] = relative(args[key]);
  for (const key of ['probes', 'breakpoints'])
    if (Array.isArray(args[key]))
      args[key] = args[key].map(item =>
        item && typeof item === 'object' ? { ...item, file: relative(item.file) } : item,
      );
  return args;
}

// permission() is read at every call: a provider may keep one tool list while the chat's permission changes.
function createGalaxyTools({ root, permission, debug, show, semanticSearch, approve }) {
  const available = level =>
    toolsFor(level, !!semanticSearch, !!debug, !!show).filter(tool => NAMES.has(tool.function.name));
  return {
    definitions(level = permission()) {
      return available(level).map(({ function: f }) => ({
        name: f.name,
        description: f.description,
        inputSchema: f.parameters,
      }));
    },
    async call(name, input, signal) {
      try {
        if (!NAMES.has(name)) throw new Error(`Unknown Codebase Galaxy tool ${name}.`);
        const level = permission();
        if (!available(level).some(tool => tool.function.name === name)) throw new Error('This chat is read-only.');
        const args = await projectRelative(
          root,
          input && typeof input === 'object' && !Array.isArray(input) ? input : {},
        );
        const prepared = await prepareTool(root, name, args, level, semanticSearch, signal, debug, show);
        const result = await executeTool(name, args, prepared, {
          root,
          signal,
          permission: level,
          approve: summary => approve(name, summary),
          debug,
          show,
        });
        return { ok: result.ok !== false, output: clip(result.output) };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { ok: false, output: clip(error.message) };
      }
    },
  };
}

module.exports = { AGENTS, PASSIVE, galaxyGuidance, createGalaxyTools };
