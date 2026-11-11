// The tutorial panel: a drawn hand showing the gesture, one short sentence, and a Skip button.
import type { HitRegion } from '../core/panel-hit.ts';
import type { TutorialStep } from '../core/tutorial.ts';
import { COLORS, UI_FONT, button, panelBackground, wrap } from './paint.ts';

export const TUTORIAL_PANEL = { widthPx: 1280, heightPx: 384, widthM: 0.4, heightM: 0.12 };

/** A hand in profile pinching (thumb and index meeting), with a ray, a drag arrow or a second pinch per step. */
function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, step: TutorialStep) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.text;
  // Palm and wrist.
  ctx.beginPath();
  ctx.moveTo(10, 150);
  ctx.lineTo(10, 95);
  ctx.quadraticCurveTo(12, 60, 50, 55);
  ctx.lineTo(95, 50);
  ctx.moveTo(10, 150);
  ctx.lineTo(80, 150);
  ctx.quadraticCurveTo(110, 148, 112, 118);
  ctx.stroke();
  // Index finger curling down to the thumb.
  ctx.beginPath();
  ctx.moveTo(95, 50);
  ctx.quadraticCurveTo(150, 40, 150, 80);
  ctx.stroke();
  // Thumb rising to meet it.
  ctx.beginPath();
  ctx.moveTo(112, 118);
  ctx.quadraticCurveTo(140, 110, 148, 88);
  ctx.stroke();
  // Pinch point.
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(150, 84, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.accent;
  if (step === 'point' || step === 'read') {
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(160, 70);
    ctx.lineTo(250, 20);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (step === 'turn') {
    ctx.beginPath();
    ctx.moveTo(170, 120);
    ctx.quadraticCurveTo(215, 150, 255, 112);
    ctx.lineTo(240, 112);
    ctx.moveTo(255, 112);
    ctx.lineTo(253, 128);
    ctx.stroke();
  } else if (step === 'open') {
    for (const r of [22, 38]) {
      ctx.beginPath();
      ctx.arc(150, 84, r, -0.9, 0.9);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawTutorial(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  step: TutorialStep,
  text: string,
  index: number,
  hovered: string | null = null,
): HitRegion[] {
  panelBackground(ctx, w, h, COLORS.accent);
  drawHand(ctx, 40, 60, 1.35, step);
  const x = 420;
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 30px ${UI_FONT}`;
  ctx.fillText(`STEP ${index} OF 4`, x, 90);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 50px ${UI_FONT}`;
  wrap(ctx, text, w - x - 230)
    .slice(0, 3)
    .forEach((line, k) => ctx.fillText(line, x, 160 + k * 62));
  return [button(ctx, 'skip', 'Skip', w - 210, h - 130, 170, 90, { hovered: hovered === 'skip' })];
}
