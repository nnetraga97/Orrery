// The Activity tab of the chat window: the agent's tool calls this visit, newest first, a heading per turn, each call
// with its file and whether it is running, done or failed (src/core/activity.ts). Pinching a call's row selects its
// file, so the galaxy flies to it.
import { createSystem } from '@iwsdk/core';
import { layoutActivity } from '../core/activity.ts';
import { canvasMeasure } from '../panels/draw-chat.ts';
import { activity, dataset } from '../state/app-state.ts';
import { selectFile, showChatPage } from '../state/commands.ts';
import { ChatWindowSystem } from './chat-window-system.ts';

export class ActivitySystem extends createSystem({}) {
  init() {
    const chat = this.world.getSystem(ChatWindowSystem);
    if (!chat) return;
    chat.activityPage = {
      layout: (m, ctx) => layoutActivity(activity.peek(), m, canvasMeasure(ctx, m)),
      press: id => {
        if (id.startsWith('file:')) selectFile(id.slice(5));
      },
    };
    chat.enableTab('activity', () => showChatPage('activity'));
    this.cleanupFuncs.push(
      activity.subscribe(() => chat.refresh()),
      // Another project: its calls no longer apply.
      dataset.subscribe(() => (activity.value = [])),
    );
  }
}
