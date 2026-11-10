// One selected-workspace scope for analysis, disk observation and project imports.
// Rules are cached per directory; no process is spawned or file read per source file.
const fs = require('node:fs');
const path = require('node:path');
const ignore = require('ignore');

const DEFAULT_PATTERNS = [
  '.git/',
  '.claude/',
  '.codex/',
  '.galaxy/',
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  'out/',
  'target/',
  'coverage/',
  '.next/',
  '.turbo/',
  '__pycache__/',
  '.DS_Store',
  '.env',
  '.env.*',
  '!.env.example',
  '*.pyc',
];
const defaults = ignore({ ignorecase: false }).add(DEFAULT_PATTERNS);
const POLICY_FILES = new Set(['.gitignore', '.galaxyignore']);
function relative(value) {
  if (typeof value !== 'string' || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value))
    return null;
  const rel = value.split(path.sep).join('/').replace(/\/$/, '');
  if (!rel || rel.split('/').some(p => !p || p === '.' || p === '..')) return null;
  return rel;
}
function isDefaultIgnored(value, isDirectory = false) {
  const rel = relative(value);
  return !rel || defaults.ignores(rel + (isDirectory ? '/' : ''));
}
function isPolicyFile(value) {
  return typeof value === 'string' && POLICY_FILES.has(path.posix.basename(value));
}
function readRules(root, dir, filename) {
  const file = path.join(root, dir, filename);
  try {
    // Do not follow a policy-file symlink into another workspace.
    if (!fs.lstatSync(file).isFile()) return null;
    return ignore({ ignorecase: false }).add(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}
function createScope(root, { exclude = [] } = {}) {
  root = path.resolve(root);
  let contexts = new Map(),
    directories = new Map();
  // Caller-owned data/output directories cannot be re-included by project rules.
  const extra = ignore({ ignorecase: false }).add(exclude);
  function context(dir) {
    if (contexts.has(dir)) return contexts.get(dir);
    const parent = dir ? context(path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir)) : [];
    const result = parent.slice();
    // Keep rules from the same directory in one matcher so !folder/ re-inclusion
    // affects descendant matches as well as that directory's own decision.
    const matcher = ignore({ ignorecase: false });
    if (!dir) matcher.add(DEFAULT_PATTERNS);
    for (const filename of ['.gitignore', '.galaxyignore']) {
      const rules = readRules(root, dir, filename);
      if (rules) matcher.add(rules);
    }
    result.push({ prefix: dir ? dir + '/' : '', rules: matcher });
    contexts.set(dir, result);
    return result;
  }
  function ignored(value, isDirectory = false) {
    const rel = relative(value);
    if (!rel) return true;
    if (isDirectory && directories.has(rel)) return directories.get(rel);
    const parent = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    let result;
    if (parent && ignored(parent, true)) result = true;
    else {
      const name = rel + (isDirectory ? '/' : '');
      result = false;
      // Rules closer to the file take precedence; at each directory Galaxy rules
      // override Git visibility. An excluded parent still needs to be included first.
      for (const { prefix, rules: matcher } of context(parent)) {
        const match = matcher.test(name.slice(prefix.length));
        if (match.ignored) result = true;
        else if (match.unignored) result = false;
      }
      if (extra.ignores(name)) result = true;
    }
    if (isDirectory) directories.set(rel, result);
    return result;
  }
  function refresh() {
    contexts = new Map();
    directories = new Map();
  }
  return { root, ignored, refresh, isPolicyFile };
}
// Analysis children inherit their owner's explicit state/output exclusions. Keeping
// this separate avoids process-wide environment changing live workspace policies.
function createAnalysisScope(root, { exclude = [] } = {}) {
  const configured = JSON.parse(process.env.GALAXY_SCOPE_EXCLUDES || '[]');
  if (!Array.isArray(configured) || configured.some(pattern => typeof pattern !== 'string'))
    throw new Error('GALAXY_SCOPE_EXCLUDES must be a JSON array of ignore patterns.');
  return createScope(root, { exclude: [...configured, ...exclude] });
}
module.exports = { createScope, createAnalysisScope, isDefaultIgnored, isPolicyFile };
