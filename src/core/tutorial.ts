// The tutorial as a state machine: four gestures in order, each step advanced by the app event that proves it.

export type TutorialStep = 'point' | 'turn' | 'open' | 'read' | 'done';
export type TutorialEvent = 'selected' | 'orbited' | 'landed' | 'codeShown' | 'skip';

export const TUTORIAL_STEPS: readonly TutorialStep[] = ['point', 'turn', 'open', 'read', 'done'];

/** One short sentence per step (twelve words at most). */
export const TUTORIAL_TEXT: Record<Exclude<TutorialStep, 'done'>, string> = {
  point: 'Point at the glowing planet and pinch.',
  turn: 'Pinch in the air and drag to turn the model.',
  open: 'Pinch the planet again to open it.',
  read: 'Pinch a town on the globe to read its code.',
};

const ADVANCES: Record<TutorialStep, TutorialEvent | null> = {
  point: 'selected',
  turn: 'orbited',
  open: 'landed',
  read: 'codeShown',
  done: null,
};

export function nextStep(step: TutorialStep, event: TutorialEvent): TutorialStep {
  if (event === 'skip') return 'done';
  if (ADVANCES[step] !== event) return step;
  return TUTORIAL_STEPS[TUTORIAL_STEPS.indexOf(step) + 1];
}
