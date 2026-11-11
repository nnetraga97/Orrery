import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_MODE_REFUSAL, READ_ONLY_REFUSAL, needsApproval } from './permissions.ts';

test('edits need approval in workspace, are refused read only, run directly with full access', () => {
  for (const tool of ['replace_in_file', 'write_file']) {
    assert.deepEqual(needsApproval(tool, 'workspace'), { run: 'approve' });
    assert.deepEqual(needsApproval(tool, 'readOnly'), { run: 'refuse', reason: READ_ONLY_REFUSAL });
    assert.deepEqual(needsApproval(tool, 'full'), { run: 'direct' });
  }
});

test('everything else never needs approval', () => {
  for (const tool of ['list_files', 'read_file', 'search', 'show_user', 'ask_user', 'update_plan', 'run_replay'])
    for (const permission of ['readOnly', 'workspace', 'full'] as const) assert.deepEqual(needsApproval(tool, permission), { run: 'direct' });
});

test('plan mode refuses the edit tools', () => {
  assert.deepEqual(needsApproval('replace_in_file', 'full', 'plan'), { run: 'refuse', reason: PLAN_MODE_REFUSAL });
  assert.equal(PLAN_MODE_REFUSAL, 'Plan mode: no edits.');
  assert.deepEqual(needsApproval('read_file', 'full', 'plan'), { run: 'direct' });
});
