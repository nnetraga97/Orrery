import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMetrics, clampScroll, layoutChat, stickToBottom, visibleSlice, wrapRuns } from './layout.ts';
import type { ChatModel, Line } from './layout.ts';
import { answerState, choose, speak } from './requests.ts';
import type { ChatItem, ChatRequest } from './types.ts';

// Every character is 10 px wide, whatever the font.
const measure = (text: string) => text.length * 10;
const metrics = { ...chatMetrics(600), pad: 50 }; // a 500-pixel transcript
const lay = (model: Partial<ChatModel>) => layoutChat({ items: [], live: false, ...model }, metrics, measure);
const text = (line: Line) => line.spans.map(s => s.text).join('');
const right = (line: Line) => Math.max(...line.spans.map(s => s.x + measure(s.text)));

test('wrapRuns wraps words at the width and breaks a word wider than the line', () => {
  const lines = wrapRuns([{ text: 'aaaa bbbb cccc', font: 'body', tone: 'text' }], 80, measure);
  assert.deepEqual(lines.map(l => l.map(s => s.text).join('')), ['aaaa', 'bbbb', 'cccc']);
  const long = wrapRuns([{ text: 'abcdefghijklmno', font: 'body', tone: 'text' }], 50, measure);
  assert.deepEqual(long.map(l => l.map(s => s.text).join('')), ['abcde', 'fghij', 'klmno']);
  // Runs of different fonts keep their own spans and positions.
  const mixed = wrapRuns(
    [
      { text: 'a ', font: 'body', tone: 'text' },
      { text: 'code', font: 'mono', tone: 'text' },
    ],
    500,
    measure,
  );
  assert.deepEqual(mixed[0].map(s => [s.text, s.x, s.font]), [['a ', 0, 'body'], ['code', 20, 'mono']]);
});

test('agent text wraps at the panel width', () => {
  const words = Array.from({ length: 30 }, () => 'word').join(' ');
  const layout = lay({ items: [{ type: 'agentMessage', text: words }] });
  const lines = layout.lines.filter(l => l.kind === 'text');
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(right(line) <= 550, `${right(line)} past the edge`);
  assert.equal(lines.map(text).join(' '), words);
});

test('a code block keeps its lines and never wraps', () => {
  const long = 'x'.repeat(80);
  const layout = lay({ items: [{ type: 'agentMessage', text: '```ts\nshort\n' + long + '\n```' }] });
  const code = layout.lines.filter(l => l.kind === 'code');
  assert.deepEqual(code.map(text), ['short', long]);
  assert.ok(layout.lines.some(l => l.kind === 'codeLanguage' && text(l) === 'TS'));
  assert.equal(layout.boxes.filter(b => b.kind === 'code').length, 1);
});

test('a user bubble is right-aligned and at most 80% of the width', () => {
  const layout = lay({ items: [{ type: 'userMessage', text: 'word '.repeat(40).trim(), attachmentNames: ['range.ts:90-101'] }] });
  const bubble = layout.boxes.find(b => b.kind === 'bubble')!;
  assert.equal(bubble.x + bubble.w, 550);
  assert.ok(bubble.w <= 400, `bubble ${bubble.w} wide`);
  for (const line of layout.lines.filter(l => l.kind === 'user')) assert.ok(line.spans[0].x >= bubble.x);
  const chip = layout.lines.find(l => l.kind === 'attachment')!;
  assert.equal(chip.icon?.name, 'paperclip');
  assert.equal(text(chip), 'range.ts:90-101');
  // A short message makes a short bubble.
  const short = lay({ items: [{ type: 'userMessage', text: 'Fix it' }] }).boxes.find(b => b.kind === 'bubble')!;
  assert.ok(short.w < 120 && short.x + short.w === 550);
});

const actions: ChatItem[] = [
  { id: 'u', type: 'userMessage', text: 'go' },
  { id: 'r', type: 'reasoning', status: 'completed', text: '**Looking**\nmore' },
  { id: 'c', type: 'commandExecution', status: 'completed', command: 'npm test', output: 'ok', exitCode: 0 },
  { id: 'f', type: 'fileChange', status: 'completed', changes: [{ path: 'a.ts', diff: '@@ -1 +1 @@\n-a\n+b' }] },
];

test('a closed group is one line; an open one lists its rows', () => {
  const closed = lay({ items: actions });
  assert.deepEqual(
    closed.lines.filter(l => l.kind !== 'user').map(l => [l.kind, text(l)]),
    [['groupHead', 'Ran a command, edited a.ts']],
  );
  const open = lay({ items: actions, open: new Map([['group:r', true]]) });
  assert.deepEqual(
    open.lines.filter(l => l.kind !== 'user').map(l => l.kind),
    ['groupHead', 'thinking', 'action', 'action'],
  );
  // While a turn runs, its last group is open unless the reader closed it.
  assert.equal(lay({ items: actions, live: true }).lines.filter(l => l.kind === 'action').length, 2);
  assert.equal(lay({ items: actions, live: true, open: new Map([['group:r', false]]) }).lines.filter(l => l.kind === 'action').length, 0);
});

test('each expandable row yields toggle:<itemId>, and opens to its detail', () => {
  const layout = lay({ items: actions, open: new Map([['group:r', true]]) });
  assert.deepEqual(layout.regions.map(r => r.id), ['toggle:group:r', 'toggle:r', 'toggle:c', 'toggle:f']);
  const expanded = lay({ items: actions, open: new Map([['group:r', true], ['r', true], ['c', true], ['f', true]]) });
  const kinds = expanded.lines.map(l => l.kind);
  assert.ok(kinds.includes('terminal') && kinds.includes('output'));
  const diff = expanded.lines.filter(l => l.kind === 'diffLine').map(l => [text(l), l.spans[0].tone]);
  assert.deepEqual(diff, [['@@ -1 +1 @@', 'hunk'], ['-a', 'removed'], ['+b', 'added']]);
  assert.equal(expanded.boxes.filter(b => b.kind === 'band').length, 2);
  // The thinking row's text below its bold title.
  assert.ok(expanded.lines.some(l => l.kind === 'text' && text(l) === 'more'));
});

test('a failed command row shows the alert icon and its exit code', () => {
  const layout = lay({ items: [{ id: 'x', type: 'commandExecution', status: 'completed', command: 'make', exitCode: 2 }] });
  const line = layout.lines.find(l => l.kind === 'action')!;
  assert.equal(line.icon?.name, 'alert');
  assert.equal(line.icon?.tone, 'failed');
  assert.ok(text(line).includes('exit 2'));
});

test('a plan card counts its steps', () => {
  const layout = lay({
    items: [{ id: 'p', type: 'plan', plan: [{ step: 'Find it', status: 'completed' }, { step: 'Fix it', status: 'inProgress' }, { step: 'Check', status: 'pending' }] }],
  });
  assert.ok(text(layout.lines.find(l => l.kind === 'planHead')!).includes('1 of 3 done'));
  assert.deepEqual(layout.lines.filter(l => l.kind === 'planStep').map(l => l.marker?.status), ['completed', 'inProgress', 'pending']);
});

test('a turn diff reads "Changed N files this turn" and toggles', () => {
  const diff = 'diff --git a/a.ts b/a.ts\nindex 1..2\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b.ts b/b.ts\nx\n--- a/b.ts\n+++ b/b.ts\n+c\n';
  const layout = lay({ items: [{ id: 'd', type: 'turnDiff', diff }] });
  const line = layout.lines.find(l => l.kind === 'changes')!;
  assert.ok(text(line).startsWith('Changed 2 files this turn'));
  assert.deepEqual(layout.regions.map(r => r.id), ['toggle:d']);
  const open = lay({ items: [{ id: 'd', type: 'turnDiff', diff }], open: new Map([['d', true]]) });
  assert.deepEqual(open.lines.filter(l => l.kind === 'diffFile').map(l => l.spans[0].text), ['a.ts', 'b.ts']);
});

test('welcome, working line, error bar and footer', () => {
  assert.equal(text(lay({ welcome: 'What would you like to fix?' }).lines[0]), 'What would you like to fix?');
  const layout = lay({ items: actions, live: true, working: { word: 'Reading…', time: '12s' }, error: 'Turn failed: x', footer: 'Stopped' });
  const kinds = layout.lines.map(l => l.kind);
  assert.deepEqual(kinds.slice(-3), ['working', 'error', 'footer']);
  assert.equal(layout.lines.find(l => l.kind === 'working')!.icon?.tone, 'work');
  assert.ok(layout.boxes.some(b => b.kind === 'errorBar'));
});

test('visibleSlice returns only what is in view', () => {
  const items: ChatItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, type: 'agentMessage', text: `line ${i}` }));
  const layout = lay({ items });
  const slice = visibleSlice(layout, 500, 300);
  assert.ok(slice.lines.length > 0 && slice.lines.length < layout.lines.length);
  for (const line of slice.lines) assert.ok(line.y + line.height > 500 && line.y < 800);
});

test('stickToBottom follows new output only near the bottom', () => {
  // At the bottom (or within 90 px): follow.
  assert.equal(stickToBottom(700, 1000, 1200, 300), 900);
  assert.equal(stickToBottom(620, 1000, 1200, 300), 900);
  // Reading further up: stay.
  assert.equal(stickToBottom(500, 1000, 1200, 300), 500);
  // Shorter than the view: top.
  assert.equal(stickToBottom(0, 100, 200, 300), 0);
  assert.equal(clampScroll(-5, 1000, 300), 0);
  assert.equal(clampScroll(900, 1000, 300), 700);
});

const question: ChatRequest = {
  id: 'q1',
  type: 'questions',
  questions: [
    { id: 'scope', question: 'How far?', options: [{ label: 'Only this', description: 'The one function' }, { label: 'Also strict' }] },
    { question: 'Anything else?' },
  ],
};
const approval: ChatRequest = {
  id: 'a1',
  type: 'fileChangeApproval',
  reason: 'Fix the end edge',
  changes: [{ path: 'core/range.ts', diff: '@@ -1 +1 @@\n-a\n+b' }],
};

test('a question card: one region per option, a say row per question, and Send answer', () => {
  const layout = lay({ requests: [question], footer: 'Waiting for your response' });
  assert.deepEqual(layout.regions.map(r => r.id), [
    'option:q1:scope:0',
    'option:q1:scope:1',
    'say:q1:scope',
    'say:q1:1',
    'button:send:q1',
  ]);
  assert.equal(text(layout.lines.find(l => l.kind === 'cardTitle')!), 'A QUESTION FOR YOU');
  assert.ok(layout.lines.some(l => l.kind === 'option' && text(l) === 'The one function'));
  assert.equal(layout.boxes[0].kind, 'card');
  assert.equal(layout.lines.at(-1)!.kind, 'footer');
});

test('the chosen option is marked; a spoken answer shows and clears the mark', () => {
  const chosen = lay({ requests: [question], answers: new Map([['q1', choose(answerState(question), 'scope', 1)]]) });
  assert.deepEqual(chosen.lines.filter(l => l.choice).map(l => l.choice!.chosen), [false, true]);
  const spoken = lay({ requests: [question], answers: new Map([['q1', speak(choose(answerState(question), 'scope', 1), 'scope', 'just the edge')]]) });
  assert.deepEqual(spoken.lines.filter(l => l.choice).map(l => l.choice!.chosen), [false, false]);
  assert.ok(spoken.lines.some(l => l.kind === 'spoken' && text(l) === '“just the edge”'));
});

test('the validation message shows under Send answer until every question is answered', () => {
  const notices = new Map([['q1', 'Answer each question before sending.']]);
  assert.ok(lay({ requests: [question], notices }).lines.some(l => l.kind === 'notice' && text(l).startsWith('Answer each')));
  const answered = speak(choose(answerState(question), 'scope', 0), '1', 'no');
  assert.ok(!lay({ requests: [question], notices, answers: new Map([['q1', answered]]) }).lines.some(l => l.kind === 'notice'));
});

test('a secret question is refused with an error row and no Send', () => {
  const layout = lay({ requests: [{ id: 's', type: 'questions', questions: [{ id: 'k', question: 'Key?', isSecret: true }] }] });
  assert.ok(layout.lines.some(l => l.kind === 'notice' && text(l) === 'This app cannot ask for secrets.'));
  assert.deepEqual(layout.regions.map(r => r.id), []);
});

test('an approval card: Review changes opens the diff; Decline and Approve once', () => {
  const closed = lay({ requests: [approval] });
  assert.equal(text(closed.lines.find(l => l.kind === 'cardTitle')!), 'APPROVE FILE CHANGES');
  assert.deepEqual(closed.regions.map(r => r.id), ['toggle:review:a1', 'button:decline:a1', 'button:approve:a1']);
  const buttons = closed.lines.find(l => l.kind === 'buttons')!.buttons!;
  assert.deepEqual(buttons.map(b => [b.label, b.tone]), [['Decline', undefined], ['Approve once', 'ok']]);
  assert.ok(!closed.lines.some(l => l.kind === 'diffLine'));
  const open = lay({ requests: [approval], open: new Map([['review:a1', true]]) });
  assert.equal(open.lines.filter(l => l.kind === 'diffLine').length, 3);
  const action = lay({ requests: [{ id: 'c', type: 'commandApproval', command: 'npm test' }] });
  assert.equal(text(action.lines.find(l => l.kind === 'cardTitle')!), 'APPROVE THIS ACTION');
});
