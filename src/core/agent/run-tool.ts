// What each tool does against the in-memory workspace, as a result for the model and a note of what changed. Tools
// that act on the scene (show_user, run_replay) or the transcript (update_plan) report through `effects`.
import { unifiedDiff } from '../diff.ts';
import type { Workspace } from '../workspace.ts';
import type { FunctionIndex } from './functions.ts';
import { checkShowUser, numbered } from './tools.ts';

export type ToolOutcome = {
  content: string;
  isError: boolean;
  /** A file the tool changed, with its diff. */
  change?: { path: string; diff: string; created: boolean };
};
export type SceneEffects = {
  showUser(file: string, line: number | null, message: string): void;
  /** Starts the replay, or says why it cannot (no problem card; the problem is still open). */
  runReplay(which: 'failing' | 'fixed'): string | null;
  /** The galaxy's functions, when the project has them. */
  functions?: FunctionIndex | null;
};

const MAX_READ_LINES = 400;

export async function runTool(name: string, input: Record<string, unknown>, ws: Workspace, scene: SceneEffects): Promise<ToolOutcome> {
  const ok = (content: string, change?: ToolOutcome['change']): ToolOutcome => ({ content, isError: false, ...(change ? { change } : {}) });
  try {
    switch (name) {
      case 'list_files':
        return ok(ws.list().join('\n'));
      case 'read_file': {
        const text = await ws.read(String(input.path));
        const total = text.split('\n').length,
          start = (input.start_line as number) ?? 1,
          end = Math.min((input.end_line as number) ?? total, start + MAX_READ_LINES - 1);
        if (start > total) return { content: `${input.path} has ${total} lines.`, isError: true };
        const more = end < ((input.end_line as number) ?? total) ? `\n… read up to line ${end} of ${total}; ask for more with start_line.` : '';
        return ok(numbered(text, start, end) + more);
      }
      case 'search': {
        const hits = await ws.search(String(input.pattern), input.path as string | undefined);
        if (!hits.length) return ok('No matches.');
        return ok(hits.map(h => `${h.path}:${h.line}: ${h.text.trim()}`).join('\n') + (hits.length >= 200 ? '\n… stopped at 200 matches.' : ''));
      }
      case 'find_function': {
        if (!scene.functions) return { content: 'This project has no function map. Use search.', isError: true };
        return ok(scene.functions.describe(String(input.name)).text);
      }
      case 'replace_in_file': {
        const path = String(input.path);
        const before = await ws.read(path);
        await ws.replace(path, String(input.old_text), String(input.new_text));
        const after = await ws.read(path);
        return ok(`Replaced the text in ${path}.`, { path, diff: unifiedDiff(path, before, after), created: false });
      }
      case 'write_file': {
        const path = String(input.path);
        let before: string | null = null;
        try {
          before = await ws.read(path);
        } catch {
          before = null;
        }
        ws.write(path, String(input.content));
        return ok(`${before == null ? 'Created' : 'Wrote'} ${path}.`, { path, diff: unifiedDiff(path, before ?? '', String(input.content)), created: before == null });
      }
      case 'show_user': {
        const file = String(input.file);
        let text: string | null = null;
        try {
          text = await ws.read(file);
        } catch {
          text = null;
        }
        const problem = checkShowUser({ file, line: input.line as number | undefined }, text);
        if (problem) return { content: problem, isError: true };
        scene.showUser(file, (input.line as number) ?? null, String(input.message));
        return ok('Shown to the user.');
      }
      case 'update_plan':
        return ok('Plan updated.');
      case 'run_replay': {
        const which = input.which === 'failing' ? 'failing' : 'fixed';
        const refused = scene.runReplay(which);
        if (refused) return { content: refused, isError: true };
        return ok(`Replaying the ${which} run in the scene, one step at a time.`);
      }
      default:
        return { content: `There is no tool called ${name}.`, isError: true };
    }
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}

/** A replace_in_file call's diff, before it runs (for the approval card); throws what running it would. */
export async function previewEdit(name: string, input: Record<string, unknown>, ws: Workspace): Promise<{ path: string; diff: string }> {
  const path = String(input.path);
  if (name === 'write_file') {
    let before = '';
    try {
      before = await ws.read(path);
    } catch {
      before = '';
    }
    return { path, diff: unifiedDiff(path, before, String(input.content)) };
  }
  const before = await ws.read(path);
  const old = String(input.old_text);
  const count = old ? before.split(old).length - 1 : 0;
  if (count === 0) throw new Error(`old_text was not found in ${path}`);
  if (count > 1) throw new Error(`old_text occurs ${count} times in ${path}; include more of the surrounding text`);
  return { path, diff: unifiedDiff(path, before, before.replace(old, () => String(input.new_text))) };
}
