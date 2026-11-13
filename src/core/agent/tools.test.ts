import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, TOOL_NAMES, checkShowUser, numbered, validateInput } from './tools.ts';

const ok = (name: string, input: unknown) => assert.ok(validateInput(name, input).ok, `${name} ${JSON.stringify(input)}`);
const bad = (name: string, input: unknown, error: string) => {
  const r = validateInput(name, input);
  assert.ok(!r.ok, `${name} accepted ${JSON.stringify(input)}`);
  assert.equal(!r.ok && r.error, error);
};

test('the ten tools, each strict', () => {
  assert.deepEqual(TOOL_NAMES, ['list_files', 'read_file', 'search', 'find_function', 'replace_in_file', 'write_file', 'show_user', 'ask_user', 'update_plan', 'run_replay']);
  for (const t of TOOLS) assert.equal((t.input_schema as { additionalProperties: unknown }).additionalProperties, false, t.name);
});

test('list_files', () => {
  ok('list_files', {});
  bad('list_files', { path: 'x' }, 'path is not a field of this tool.');
});

test('read_file', () => {
  ok('read_file', { path: 'core/range.ts' });
  ok('read_file', { path: 'core/range.ts', start_line: 80, end_line: 110 });
  bad('read_file', {}, 'path is required.');
  bad('read_file', { path: 'a', start_line: 0 }, 'start_line must be at least 1.');
  bad('read_file', { path: 'a', start_line: 1.5 }, 'start_line must be a whole number.');
  bad('read_file', { path: 'a', start_line: 9, end_line: 3 }, 'end_line must not be before start_line.');
});

test('search', () => {
  ok('search', { pattern: 'containsPosition', path: 'core' });
  bad('search', { pattern: '' }, 'pattern must not be empty.');
  bad('search', { pattern: 3 }, 'pattern must be text.');
});

test('replace_in_file and write_file', () => {
  ok('replace_in_file', { path: 'a', old_text: 'x', new_text: '' });
  bad('replace_in_file', { path: 'a', old_text: 'x' }, 'new_text is required.');
  ok('write_file', { path: 'a', content: '' });
  bad('write_file', { path: 'a' }, 'content is required.');
});

test('show_user: a message of 1 to 280 characters', () => {
  ok('show_user', { file: 'core/range.ts', line: 97, message: 'Here.' });
  ok('show_user', { file: 'core/range.ts', message: 'Here.' });
  bad('show_user', { file: 'a', message: 'x'.repeat(281) }, 'message must be at most 280 characters.');
  bad('show_user', { file: 'a', message: '' }, 'message must not be empty.');
});

test('show_user: the file must exist and the line be in range', () => {
  assert.equal(checkShowUser({ file: 'a', line: 2 }, 'one\ntwo'), null);
  assert.equal(checkShowUser({ file: 'a', line: 3 }, 'one\ntwo'), 'a has 2 lines; line 3 is past its end.');
  assert.equal(checkShowUser({ file: 'nope' }, null), 'There is no file nope.');
});

test('ask_user: at most 8 questions and 12 options each', () => {
  ok('ask_user', { questions: [{ id: 'a', question: 'Which?', options: [{ label: 'One' }, { label: 'Two', description: 'd' }] }] });
  bad('ask_user', { questions: [] }, 'questions must have at least 1 item.');
  bad('ask_user', { questions: Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, question: 'q' })) }, 'questions must have at most 8 items.');
  bad('ask_user', { questions: [{ id: 'a', question: 'q', options: Array.from({ length: 13 }, () => ({ label: 'x' })) }] }, 'questions[0].options must have at most 12 items.');
  bad('ask_user', { questions: [{ id: 'a' }] }, 'questions[0].question is required.');
});

test('update_plan and run_replay', () => {
  ok('update_plan', { steps: [{ text: 'Find it', status: 'completed' }, { text: 'Fix it', status: 'inProgress' }] });
  bad('update_plan', { steps: [{ text: 'Fix it', status: 'done' }] }, 'steps[0].status must be one of pending, inProgress, completed.');
  ok('run_replay', { which: 'fixed' });
  bad('run_replay', { which: 'both' }, 'which must be one of failing, fixed.');
});

test('an unknown tool', () => {
  bad('rm_rf', {}, 'There is no tool called rm_rf.');
});

test('numbered lines', () => {
  assert.equal(numbered('a\nb\nc', 2, 3), '2\tb\n3\tc');
  assert.equal(numbered('a\nb', 1, 99), '1\ta\n2\tb');
});
