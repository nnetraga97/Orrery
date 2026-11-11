// A bug scenario: a real function in a baked project, broken on purpose by a small patch applied to the in-memory
// workspace when the scenario starts. The agent's job is to find and undo it. "Fixed" means the broken text is gone.

export type Scenario = {
  id: string;
  dataset: string;
  title: string;
  /** The problem card's short title. */
  shortTitle: string;
  problem: string;
  file: string;
  /** The broken line, 1-based, in the file as patched. */
  line: number;
  /** The function the bug is in, as Class.method or name. */
  function: string;
  breakPatch: { file: string; old: string; new: string };
  prompts: string[];
  recordedSession: string;
  replay: { failing: string; fixed: string };
};

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The scenario, or the list of what is wrong with it. */
export function validateScenario(data: unknown): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = (data ?? {}) as Partial<Scenario>;
  for (const key of ['id', 'dataset', 'title', 'shortTitle', 'problem', 'file', 'function', 'recordedSession'] as const)
    if (!isText(s[key])) errors.push(`${key} must be a non-empty string`);
  if (!Number.isInteger(s.line) || (s.line as number) < 1) errors.push('line must be a positive whole number');
  const patch = s.breakPatch;
  if (!patch || !isText(patch.file) || !isText(patch.old) || !isText(patch.new)) errors.push('breakPatch needs file, old and new');
  else if (patch.old === patch.new) errors.push('breakPatch must change something');
  if (!Array.isArray(s.prompts) || !s.prompts.length || !s.prompts.every(isText)) errors.push('prompts must be a list of sentences');
  if (!s.replay || !isText(s.replay.failing) || !isText(s.replay.fixed)) errors.push('replay needs failing and fixed');
  return errors.length ? { ok: false, errors } : { ok: true, scenario: s as Scenario };
}

/** The file's text with the bug put in. Throws unless the patch's old text occurs exactly once. */
export function applyBreak(scenario: Scenario, text: string): string {
  const count = text.split(scenario.breakPatch.old).length - 1;
  if (count !== 1) throw new Error(`The scenario's patch matches ${count} places in ${scenario.breakPatch.file}, not one`);
  return text.replace(scenario.breakPatch.old, () => scenario.breakPatch.new);
}

/** True once the broken text is no longer in the file. */
export const isFixed = (scenario: Scenario, text: string) => !text.includes(scenario.breakPatch.new);
