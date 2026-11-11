// The tutorial card, 0.30 × 0.10 m above the model: a drawn hand showing the gesture, one short sentence, and a Skip
// button. It is a window titled "Step n of 4" (drawn by CanvasPanel); the hand is drawn in glowing lines.
import type { HitRegion } from '../core/panel-hit.ts';
import type { TutorialStep } from '../core/tutorial.ts';
import { THEME, button, font, glowStroke, stateOf, wrap } from './paint.ts';

export const TUTORIAL_PANEL = { widthPx: 1020, heightPx: 340, widthM: 0.3, heightM: 0.1 };

export const tutorialTitle = (index: number) => `Step ${index} of 4`;

/** A hand in profile pinching (thumb and index meeting), with a ray, a drag arrow or a second pinch per step. */
function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, step: TutorialStep) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const hand = new Path2D();
  // Palm and wrist.
  hand.moveTo(10, 150);
  hand.lineTo(10, 95);
  hand.quadraticCurveTo(12, 60, 50, 55);
  hand.lineTo(95, 50);
  hand.moveTo(10, 150);
  hand.lineTo(80, 150);
  hand.quadraticCurveTo(110, 148, 112, 118);
  // Index finger curling down to the thumb.
  hand.moveTo(95, 50);
  hand.quadraticCurveTo(150, 40, 150, 80);
  // Thumb rising to meet it.
  hand.moveTo(112, 118);
  hand.quadraticCurveTo(140, 110, 148, 88);
  glowStroke(ctx, hand, THEME.white, 4);
  // Pinch point.
  ctx.fillStyle = THEME.line;
  ctx.beginPath();
  ctx.arc(150, 84, 8, 0, Math.PI * 2);
  ctx.fill();
  const gesture = new Path2D();
  if (step === 'point' || step === 'read') {
    for (let k = 0; k < 5; k++) {
      gesture.moveTo(160 + k * 18, 70 - k * 10);
      gesture.lineTo(169 + k * 18, 65 - k * 10);
    }
  } else if (step === 'turn') {
    gesture.moveTo(170, 120);
    gesture.quadraticCurveTo(215, 150, 255, 112);
    gesture.lineTo(240, 112);
    gesture.moveTo(255, 112);
    gesture.lineTo(253, 128);
  } else if (step === 'open') {
    for (const r of [22, 38]) gesture.arc(150, 84, r, -0.9, 0.9);
  }
  glowStroke(ctx, gesture, THEME.line, 4);
  ctx.restore();
}

export function drawTutorial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  step: TutorialStep,
  text: string,
  hovered: string | null = null,
): HitRegion[] {
  drawHand(ctx, 12 * u, 36 * u, 0.2 * u, step);
  const x = 74 * u,
    bw = 52 * u,
    bh = 22 * u;
  ctx.fillStyle = THEME.white;
  ctx.font = font('body', 15 * u);
  wrap(ctx, text, w - x - 12 * u)
    .slice(0, 2)
    .forEach((line, k) => ctx.fillText(line, x, 52 * u + k * 19 * u));
  // Skip sits in the title row, where a window's close mark would be.
  const skip = button(ctx, 'skip', 'Skip', w - bw - 8 * u, 7 * u, bw, bh, u, { state: stateOf(hovered, 'skip'), px: 12 });
  return skip ? [skip] : [];
}
