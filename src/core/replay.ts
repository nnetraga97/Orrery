// A recorded run of the scenario's code, stepped through in the scene: each step is a line with its call stack, the
// values that matter there, and an optional note. Playing advances one step per interval, driven by a clock the
// caller passes in, so it is testable and pauses with the session.

export type Frame = { file: string; line: number; label: string };
export type ReplayStep = Frame & { stack: Frame[]; variables: { name: string; value: string }[]; note?: string };
export type ReplayData = { title: string; outcome: 'fails' | 'passes'; steps: ReplayStep[] };

/** What is wrong with a replay: files that do not exist and lines past their end. `lines(file)` gives a file's line
 * count, or null when there is no such file. */
export function replayErrors(data: unknown, lines: (file: string) => number | null): string[] {
  const d = data as Partial<ReplayData>;
  const errors: string[] = [];
  if (!d || typeof d.title !== 'string') errors.push('title is required');
  if (d?.outcome !== 'fails' && d?.outcome !== 'passes') errors.push('outcome must be fails or passes');
  if (!Array.isArray(d?.steps) || !d.steps.length) return [...errors, 'steps must be a non-empty list'];
  const check = (f: Frame, at: string) => {
    const n = lines(f.file);
    if (n == null) errors.push(`${at}: there is no file ${f.file}`);
    else if (!Number.isInteger(f.line) || f.line < 1 || f.line > n) errors.push(`${at}: line ${f.line} is not in ${f.file} (${n} lines)`);
  };
  d.steps.forEach((s, i) => {
    check(s, `step ${i + 1}`);
    if (!Array.isArray(s.stack) || !s.stack.length) errors.push(`step ${i + 1}: stack is required`);
    else s.stack.forEach((f, k) => check(f, `step ${i + 1} frame ${k + 1}`));
    if (!Array.isArray(s.variables)) errors.push(`step ${i + 1}: variables must be a list`);
  });
  return errors;
}

export function createReplay(data: ReplayData) {
  let index = 0,
    playing: { interval: number; last: number } | null = null;
  const last = data.steps.length - 1;
  return {
    data,
    get index() {
      return index;
    },
    get playing() {
      return !!playing;
    },
    current: () => data.steps[index],
    atEnd: () => index >= last,
    step() {
      if (index < last) index++;
      if (index >= last) playing = null;
      return data.steps[index];
    },
    back() {
      if (index > 0) index--;
      return data.steps[index];
    },
    restart() {
      index = 0;
      playing = null;
      return data.steps[index];
    },
    /** Starts playing from `now`: one step every `intervalMs`, stopping at the end. */
    play(intervalMs: number, now: number) {
      if (index >= last) index = 0;
      playing = { interval: intervalMs, last: now };
    },
    pause() {
      playing = null;
    },
    /** Holds the current step without advancing (while the session is paused). */
    hold(now: number) {
      if (playing) playing.last = now;
    },
    /** Advances while playing; returns true if the step changed. */
    tick(now: number) {
      if (!playing || now - playing.last < playing.interval) return false;
      playing.last = now;
      this.step();
      return true;
    },
  };
}
export type Replay = ReturnType<typeof createReplay>;
