import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_EACH, NO_SECRETS, answerState, approvalResponse, choose, isQuestionRequest, openQuestion, readyToSend, speak, toResponse } from './requests.ts';
import type { ChatRequest } from './types.ts';

const request: ChatRequest = {
  id: 'q1',
  type: 'questions',
  questions: [
    {
      id: 'scope',
      question: 'How far should the fix go?',
      options: [
        { label: 'Fix only this function', description: 'The one the bug is in' },
        { label: 'Also check the strict version' },
      ],
    },
    { question: 'Anything else?' },
  ],
};

test('a new answer state has nothing chosen and is not ready', () => {
  const state = answerState(request);
  assert.deepEqual(readyToSend(state), { ok: false, message: ANSWER_EACH });
  assert.equal(ANSWER_EACH, 'Answer each question before sending.');
});

test('choosing an option and speaking an answer; ready once every question has one', () => {
  let state = choose(answerState(request), 'scope', 1);
  assert.equal(readyToSend(state).ok, false);
  // The second question has no id: it is known by its index.
  state = speak(state, '1', 'No, that is all');
  assert.deepEqual(readyToSend(state), { ok: true });
  assert.deepEqual(toResponse(state), {
    answers: { scope: { answers: ['Also check the strict version'] }, 1: { answers: ['No, that is all'] } },
  });
});

test('spoken text overrides the chosen option, as typed text does on the desktop', () => {
  let state = choose(answerState(request), 'scope', 0);
  state = speak(state, 'scope', 'Only the end edge');
  assert.deepEqual(toResponse(speak(state, '1', 'no')).answers.scope, { answers: ['Only the end edge'] });
  // Choosing again after speaking keeps the spoken answer until it is cleared.
  state = speak(choose(state, 'scope', 1), 'scope', '');
  assert.deepEqual(toResponse(speak(state, '1', 'no')).answers.scope, { answers: ['Also check the strict version'] });
});

test('choose and speak do not change the state they are given', () => {
  const state = answerState(request);
  choose(state, 'scope', 0);
  speak(state, '1', 'x');
  assert.equal(readyToSend(state).ok, false);
});

test('an option without a label answers with its value, then its index', () => {
  const r: ChatRequest = { id: 'r', type: 'userInput', questions: [{ id: 'a', options: [{ value: 'v' }, {}] }] };
  assert.deepEqual(toResponse(choose(answerState(r), 'a', 0)).answers.a, { answers: ['v'] });
  assert.deepEqual(toResponse(choose(answerState(r), 'a', 1)).answers.a, { answers: ['1'] });
});

test('a secret question is refused', () => {
  const r: ChatRequest = { id: 'r', type: 'questions', questions: [{ id: 'k', question: 'Your key?', isSecret: true }] };
  const state = speak(answerState(r), 'k', 'x');
  assert.throws(() => toResponse(state), { message: NO_SECRETS });
  assert.equal(NO_SECRETS, 'This app cannot ask for secrets.');
});

test('approvals accept or decline', () => {
  assert.deepEqual(approvalResponse(true), { decision: 'accept' });
  assert.deepEqual(approvalResponse(false), { decision: 'decline' });
});

test('question requests are told apart from approvals', () => {
  assert.equal(isQuestionRequest(request), true);
  assert.equal(isQuestionRequest({ id: 'a', type: 'userInput' }), true);
  assert.equal(isQuestionRequest({ id: 'a', type: 'fileChangeApproval' }), false);
  assert.equal(isQuestionRequest({ id: 'a', type: 'commandApproval' }), false);
});

test('the main microphone answers the first open question without an answer', () => {
  const approval: ChatRequest = { id: 'a1', type: 'fileChangeApproval' };
  assert.equal(openQuestion([], new Map()), null);
  assert.equal(openQuestion([approval], new Map()), null);
  assert.deepEqual(openQuestion([approval, request], new Map()), { requestId: 'q1', questionId: 'scope' });
  const first = choose(answerState(request), 'scope', 0);
  assert.deepEqual(openQuestion([request], new Map([['q1', first]])), { requestId: 'q1', questionId: '1' });
  // Every question answered: speaking again replaces the first answer.
  const both = speak(first, '1', 'no');
  assert.deepEqual(openQuestion([request], new Map([['q1', both]])), { requestId: 'q1', questionId: 'scope' });
});
