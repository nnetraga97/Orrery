// A transcript with one of every item kind, in each status, for the panels test page (panels.html).
import type { ChatItem, ChatRequest } from '../core/chat/types.ts';

const rangeDiff = [
  '--- a/core/range.ts',
  '+++ b/core/range.ts',
  '@@ -94,7 +94,7 @@',
  ' 		if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {',
  ' 			return false;',
  ' 		}',
  '-		if (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) {',
  '+		if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {',
  ' 			return false;',
  ' 		}',
  ' 		return true;',
].join('\n');

export const CHAT_FIXTURE: ChatItem[] = [
  { id: 'u1', type: 'userMessage', text: 'Find why the end of a selection is treated as outside it', attachmentNames: ['core/range.ts:90–101'] },
  { id: 'r1', type: 'reasoning', status: 'completed', text: '**Looking for the range check**\nThe edge test is probably in Range.' },
  { id: 's1', type: 'commandExecution', status: 'completed', commandActions: [{ type: 'search', query: 'containsPosition', path: 'core' }] },
  { id: 'l1', type: 'commandExecution', status: 'completed', commandActions: [{ type: 'list_files', path: 'core' }] },
  { id: 'rd1', type: 'commandExecution', status: 'completed', commandActions: [{ type: 'read', path: 'core/range.ts' }] },
  { id: 'c1', type: 'commandExecution', status: 'completed', command: 'npm test -- range', output: '✖ containsPosition at the end edge\n1 failing', exitCode: 1 },
  { id: 'w1', type: 'webSearch', status: 'completed', query: 'range end edge inclusive' },
  { id: 't1', type: 'dynamicToolCall', status: 'completed', server: 'workspace', tool: 'search', arguments: { pattern: 'endColumn' }, result: '12 matches' },
  { id: 't2', type: 'dynamicToolCall', status: 'failed', tool: 'read_file', arguments: { path: 'core/missing.ts' }, result: 'No such file' },
  { id: 'su', type: 'dynamicToolCall', status: 'completed', tool: 'show_user', title: 'Pointed at Range.containsPosition', arguments: { file: 'core/range.ts', line: 97 } },
  { id: 'x1', type: 'contextCompaction', status: 'completed' },
  { id: 'a1', type: 'agentMessage', text: '## Found it\nThe check at the end edge uses `>=`, so a cursor **exactly at** the end is outside. 🐛\n\n- It should be `>`\n- The strict version is separate\n\n```ts\nposition.column > range.endColumn\n```' },
  { id: 'p1', type: 'plan', plan: [{ step: 'Find the edge check', status: 'completed' }, { step: 'Fix the comparison', status: 'inProgress' }, { step: 'Replay the fixed run', status: 'pending' }] },
  { id: 'u2', type: 'userMessage', text: 'Fix it 👍' },
  { id: 'f1', type: 'fileChange', status: 'completed', changes: [{ path: 'core/range.ts', diff: rangeDiff }] },
  { id: 'f2', type: 'fileChange', status: 'declined', changes: [{ path: 'core/notes.md', kind: 'add', diff: 'one\ntwo' }] },
  { id: 'f3', type: 'fileChange', status: 'completed', changes: [{ path: 'core/old.ts', kind: 'delete', diff: '-gone' }] },
  { id: 'd1', type: 'turnDiff', diff: `diff --git a/core/range.ts b/core/range.ts\nindex 1..2 100644\n${rangeDiff}\n` },
  { id: 'a2', type: 'agentMessage', text: 'Done ✅ The end edge now counts as inside.' },
  { id: 'u3', type: 'userMessage', text: 'Explain the fix' },
  { id: 'r2', type: 'reasoning', status: 'inProgress', text: 'Thinking about how to explain…' },
  { id: 'rd2', type: 'commandExecution', status: 'running', commandActions: [{ type: 'read', path: 'core/position.ts' }] },
];

/** The rows and groups the test page opens, to show their detail. */
export const CHAT_FIXTURE_OPEN = new Map<string, boolean>([
  ['group:r1', true],
  ['r1', true],
  ['c1', true],
  ['t2', true],
  ['group:f1', true],
  ['f1', true],
  ['d1', false],
]);

/** A two-question card and a file-change approval, for the test page. */
export const QUESTION_FIXTURE: ChatRequest = {
  id: 'q1',
  type: 'questions',
  questions: [
    {
      id: 'scope',
      question: 'How far should the fix go?',
      options: [
        { label: 'Fix only this function', description: 'Change the end-edge check in containsPosition.' },
        { label: 'Also check the strict version', description: 'Look at strictContainsPosition too.' },
      ],
    },
    { id: 'tests', question: 'Should I replay the fixed run afterwards?', options: [{ label: 'Yes' }, { label: 'No' }] },
  ],
};
export const APPROVAL_FIXTURE: ChatRequest = {
  id: 'a1',
  type: 'fileChangeApproval',
  reason: 'Count a position at the end edge as inside the range.',
  changes: [{ path: 'core/range.ts', diff: rangeDiff }],
};
