// Find a file by voice: the Search tab of the chat window. Pinch and hold "Hold to speak", say part of a file name, and
// let go; the files that match are listed (src/core/file-search.ts over the copied search), and pinching one selects
// it, so the galaxy flies to its planet as the desktop's search does.
import { createSystem } from '@iwsdk/core';
import { canvasMeasure } from '../panels/draw-chat.ts';
import { findFiles, layoutSearch } from '../core/file-search.ts';
import { searchFiles } from '../galaxy-bridge/galaxy-session.js';
import { dataset, fileSearch, speech, voiceTarget } from '../state/app-state.ts';
import { selectFile, showChatPage } from '../state/commands.ts';
import { ChatWindowSystem } from './chat-window-system.ts';

export class SearchSystem extends createSystem({}) {
  init() {
    const chat = this.world.getSystem(ChatWindowSystem);
    if (!chat) return;
    chat.searchPage = {
      layout: (m, ctx) => {
        const s = speech.peek(),
          f = fileSearch.peek(),
          listening = s.phase === 'listening' && voiceTarget.peek().kind === 'search';
        return layoutSearch(
          { heard: f.heard, results: f.results, listening, partial: listening ? s.text : '', selected: f.selected, micAvailable: s.phase !== 'unavailable' },
          m,
          canvasMeasure(ctx, m),
        );
      },
      press: id => {
        if (!id.startsWith('file:')) return;
        const path = id.slice(5);
        fileSearch.value = { ...fileSearch.peek(), selected: path };
        selectFile(path);
      },
    };
    chat.enableTab('search', () => showChatPage('search'));
    let lastHeard: string | null = null;
    this.cleanupFuncs.push(
      fileSearch.subscribe(f => {
        // New words: search the open project once, then redraw.
        if (f.heard !== lastHeard) {
          lastHeard = f.heard;
          if (f.heard != null) fileSearch.value = { ...f, results: findFiles(f.heard, q => searchFiles(q).map(n => ({ path: n.path, name: n.name }))) };
        }
        chat.refresh();
      }),
      // Another project: the old results no longer apply.
      dataset.subscribe(() => {
        lastHeard = null;
        fileSearch.value = { heard: null, results: [], selected: null };
      }),
    );
  }
}
