// The composer at the bottom of the chat window, laid out by src/core/chat/composer-layout.ts and drawn like the
// transcript (draw-chat.ts, drawChatWindow).
import { layoutComposer } from '../core/chat/composer-layout.ts';
import type { ComposerView } from '../core/chat/composer-layout.ts';
import type { ChatMetrics } from '../core/chat/layout.ts';
import { canvasMeasure } from './draw-chat.ts';

export type { ComposerView };

/** The composer's layout for a chat window `metrics.width` wide, measured on the window's canvas. */
export function composerLayout(ctx: CanvasRenderingContext2D, view: ComposerView, metrics: ChatMetrics) {
  return layoutComposer(view, metrics, canvasMeasure(ctx, metrics));
}
