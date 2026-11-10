// A lot represents a source statement. Its main structure describes the operation;
// small, static roof fixtures retain assignment, return and await semantics.
// Classification deliberately uses parser evidence, never guesses from method names.
export const BUILDING_TYPES = Object.freeze({
  office: { label: 'Call', description: 'A call outside the current owner, or a target not yet resolved.' },
  tower: { label: 'Local call', description: 'A call resolved within this file or to the current owner.' },
  library: {
    label: 'Library call',
    description: 'A call on a known class or package outside the analyzed project (platform or dependency).',
  },
  plant: { label: 'State write', description: 'An assignment or update to existing state.' },
  house: { label: 'Binding', description: 'A declaration that stores a value.' },
  block: { label: 'Value operation', description: 'An expression without a more specific resolved operation.' },
  dataStore: { label: 'Persistence', description: 'A storage API supported by source evidence.' },
  network: { label: 'Network', description: 'A network API supported by source evidence.' },
  relay: { label: 'Event', description: 'An event emission or subscription supported by source evidence.' },
  interface: { label: 'UI', description: 'A UI render or DOM operation supported by source evidence.' },
  constructor: { label: 'Construction', description: 'An explicit new expression creates an object.' },
  gate: { label: 'Return', description: 'A value or control leaves this function.' },
  crater: { label: 'Throw', description: 'An exception leaves this point.' },
  barrels: { label: 'Control transfer', description: 'A break or continue changes the control path.' },
});
export function buildingProfile(it, { file } = {}) {
  const ops = it.operations || [],
    calls = it.calls || [],
    kinds = new Set(ops.map(op => op.kind));
  const has = (...names) => names.some(name => kinds.has(name));
  let role;
  // These kinds must be emitted by a recognizer with evidence such as a resolved
  // import, unshadowed platform API, JSX syntax or an explicit new expression.
  if (has('network')) role = 'network';
  else if (has('persist', 'persistence', 'storage', 'filesystem')) role = 'dataStore';
  else if (has('emit', 'subscribe', 'event')) role = 'relay';
  else if (has('render', 'dom', 'ui')) role = 'interface';
  else if (has('construct')) role = 'constructor';
  else if (calls.length || has('call')) {
    const callOps = calls.length ? calls : ops.filter(op => op.kind === 'call').map(op => op.call || op);
    const local = call =>
      call.local ||
      (call.self && call.resolution !== 'unresolved') ||
      (file && call.resolution === 'resolved' && call.target === file) ||
      ['local', 'same-owner', 'same-file'].includes(call.resolution);
    // Calls that leave the project entirely (marked `library` by the view) get their own building, so a town shows
    // which statements reach into your code and which into a platform or dependency.
    role = callOps.every(local) ? 'tower' : callOps.every(call => local(call) || call.library) ? 'library' : 'office';
  } else if (has('write')) role = 'plant';
  else if (it.kind === 'decl' || has('declare', 'bind')) role = 'house';
  else if ((it.writes || []).length) role = 'plant';
  else if (it.kind === 'return' || has('return')) role = 'gate';
  else if (it.kind === 'throw' || has('throw')) role = 'crater';
  else if (it.kind === 'jump') role = 'barrels';
  else role = 'block';
  const effects = [];
  if (role !== 'gate' && (it.kind === 'return' || has('return')))
    effects.push({ kind: 'return', label: 'Returns from function', color: '#70e9db' });
  if (role !== 'crater' && (it.kind === 'throw' || has('throw')))
    effects.push({ kind: 'throw', label: 'Throws an exception', color: '#ef826d' });
  if (
    !['plant', 'house'].includes(role) &&
    ((it.writes || []).length || it.kind === 'decl' || has('write', 'declare', 'bind'))
  )
    effects.push({
      kind: 'write',
      label: it.kind === 'decl' || has('declare', 'bind') ? 'Assigns a binding' : 'Writes state',
      color: '#e8a045',
    });
  if (has('await')) effects.push({ kind: 'await', label: 'Awaits completion', color: '#c2a2ef' });
  return { role, label: BUILDING_TYPES[role].label, effects };
}
