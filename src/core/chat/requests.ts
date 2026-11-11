// Answers to the agent's questions and approvals, ported from the desktop chat's RequestCard
// (reference/desktop-app/viewer/app/panels/CodexTranscript.tsx). Each question is answered by pinching an option or by
// saying an answer; a spoken answer overrides the option, as typed text does on the desktop. The state is immutable.
import type { ChatQuestion, ChatRequest } from './types.ts';

export const ANSWER_EACH = 'Answer each question before sending.';
export const NO_SECRETS = 'This app cannot ask for secrets.';

export type AnswerState = {
  readonly request: ChatRequest;
  /** The chosen option's index, by question id. */
  readonly choices: Readonly<Record<string, number>>;
  /** The spoken answer, by question id. */
  readonly spoken: Readonly<Record<string, string>>;
};

export type QuestionResponse = { answers: Record<string, { answers: string[] }> };
export type ApprovalResponse = { decision: 'accept' | 'decline' };

/** A question's id: its own, or its index. */
export const questionId = (question: ChatQuestion, index: number) => question.id || String(index);

export const isQuestionRequest = (request: ChatRequest) => request.type === 'userInput' || request.type === 'questions';

export const answerState = (request: ChatRequest): AnswerState => ({ request, choices: {}, spoken: {} });

export const choose = (state: AnswerState, questionId: string, index: number): AnswerState => ({
  ...state,
  choices: { ...state.choices, [questionId]: index },
});

/** Sets the spoken answer; an empty text clears it. */
export function speak(state: AnswerState, questionId: string, text: string): AnswerState {
  const spoken = { ...state.spoken };
  if (text.trim()) spoken[questionId] = text.trim();
  else delete spoken[questionId];
  return { ...state, spoken };
}

/** A question's answer as sent: the spoken text, else the chosen option's label, value or index; or null. */
export function answerOf(state: AnswerState, question: ChatQuestion, index: number): string | null {
  const id = questionId(question, index);
  if (state.spoken[id]) return state.spoken[id];
  const choice = state.choices[id];
  if (choice == null) return null;
  const option = question.options?.[choice];
  return option?.label || option?.value || String(choice);
}

export function readyToSend(state: AnswerState): { ok: true } | { ok: false; message: string } {
  const questions = state.request.questions || [];
  return questions.every((q, i) => answerOf(state, q, i) != null) ? { ok: true } : { ok: false, message: ANSWER_EACH };
}

export function toResponse(state: AnswerState): QuestionResponse {
  const questions = state.request.questions || [];
  if (questions.some(q => q.isSecret)) throw new Error(NO_SECRETS);
  const answers: QuestionResponse['answers'] = {};
  questions.forEach((q, i) => {
    const answer = answerOf(state, q, i);
    if (answer != null) answers[questionId(q, i)] = { answers: [answer] };
  });
  return { answers };
}

export const approvalResponse = (accept: boolean): ApprovalResponse => ({ decision: accept ? 'accept' : 'decline' });
