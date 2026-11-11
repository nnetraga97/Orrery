import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLoop, loopStep } from './loop.ts';
import type { LoopEffect, LoopEvent, LoopState } from './loop.ts';
import { END_OF_RECORDING, recordedReply } from './recorded.ts';
import type { RecordedSession } from './recorded.ts';
import { previewEdit, runTool } from './run-tool.ts';
import { requestErrors } from './wire.ts';
import { createWorkspace } from '../workspace.ts';
import { applyBreak, isFixed, validateScenario } from '../scenario.ts';

const read = (p: string) => fs.readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const session = JSON.parse(read('src/adapters/fake-sessions/range-edge.json')) as RecordedSession;
const v = validateScenario(JSON.parse(read('public/scenarios/range-edge.json')));
assert.ok(v.ok);
const scenario = v.scenario;

/** The recorded session played through the real loop and workspace, answering the first option and approving. */
async function play() {
  const baked = (p: string) => {
    try {
      return read(`public/data/editor-core/source/${p}`);
    } catch {
      return null;
    }
  };
  const paths = ['core/range.ts', 'core/position.ts', 'core/selection.ts'];
  const ws = createWorkspace(async p => (p === scenario.file ? applyBreak(scenario, baked(p)!) : baked(p)), paths);
  const shown: string[] = [];
  const replays: string[] = [];
  const scene = { showUser: (f: string, l: number | null) => shown.push(`${f}:${l}`), runReplay: (w: string) => replays.push(w) };
  let state: LoopState = initialLoop();
  const queue: LoopEvent[] = [{ type: 'userSaid', text: 'Fix it' }];
  let calls = 0;
  while (queue.length) {
    const step = loopStep(state, queue.shift()!);
    state = step.state;
    for (const e of step.effects as LoopEffect[]) {
      if (e.kind === 'callModel') {
        calls++;
        assert.deepEqual(requestErrors({ provider: 'recorded', system: '', tools: [], messages: e.messages }), []);
        const turn = recordedReply(session, e.messages);
        queue.push({ type: 'stream', event: { type: 'message', message: { role: 'assistant', blocks: turn.blocks }, stopReason: turn.stopReason } });
      } else if (e.kind === 'runTool') {
        const out = await runTool(e.name, e.input, ws, scene);
        queue.push({ type: 'toolFinished', id: e.id, content: out.content, isError: out.isError });
      } else if (e.kind === 'askApproval') {
        await previewEdit(e.name, e.input, ws);
        queue.push({ type: 'approved', id: e.id });
      } else if (e.kind === 'askUser') queue.push({ type: 'answered', id: e.id, response: { answers: { scope: { answers: ['Fix only this function'] } } } });
    }
  }
  return { state, ws, shown, replays, calls };
}

test('the recorded session runs through the real loop, fixes the bug and ends idle', async () => {
  const { state, ws, shown, replays, calls } = await play();
  assert.equal(state.status, 'idle');
  assert.equal(calls, session.turns.length);
  // The workspace starts from the broken file, so the fix shows as the one change.
  assert.deepEqual(ws.changed(), ['core/range.ts']);
  assert.ok(isFixed(scenario, await ws.read(scenario.file)));
  assert.deepEqual(shown, [`core/range.ts:${scenario.line}`]);
  assert.deepEqual(replays, ['fixed']);
  // No tool result was an error.
  for (const m of state.messages) for (const b of m.blocks) if (b.type === 'tool_result') assert.equal(b.isError, false, b.content);
});

test('after the recording ends, a further message gets the end-of-recording reply', () => {
  const turn = recordedReply(session, [
    { role: 'user', blocks: [{ type: 'text', text: 'x' }] },
    { role: 'assistant', blocks: [{ type: 'text', text: 'done' }] },
    { role: 'user', blocks: [{ type: 'text', text: 'again' }] },
  ]);
  assert.equal(turn.blocks[0].type === 'text' && turn.blocks[0].text, END_OF_RECORDING);
});

test('tools report problems as error results', async () => {
  const ws = createWorkspace(async () => 'a\nb', ['a.ts']);
  const scene = { showUser: () => {}, runReplay: () => {} };
  assert.deepEqual(await runTool('read_file', { path: 'nope.ts' }, ws, scene), { content: 'No such file: nope.ts', isError: true });
  assert.deepEqual(await runTool('show_user', { file: 'a.ts', line: 9, message: 'x' }, ws, scene), { content: 'a.ts has 2 lines; line 9 is past its end.', isError: true });
  assert.equal((await runTool('read_file', { path: 'a.ts', start_line: 2 }, ws, scene)).content, '2\tb');
  assert.equal((await runTool('search', { pattern: 'zzz' }, ws, scene)).content, 'No matches.');
  await assert.rejects(previewEdit('replace_in_file', { path: 'a.ts', old_text: 'q', new_text: 'r' }, ws), /not found/);
  const made = await runTool('write_file', { path: 'n.ts', content: 'x' }, ws, scene);
  assert.equal(made.change?.created, true);
});
