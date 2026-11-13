// Where the user is, read from the signals: the open problem card, the selected file, the landed function and the code
// card (src/core/chat/context.ts turns it into the chip's label and the note sent to the model).
import { hasSelection } from '../core/code-view.ts';
import type { Where } from '../core/chat/context.ts';
import { codeCardOpen, codeView, landedPath, landedTown, phase, scenario, scenarioState, selectedPath } from './app-state.ts';

/** `withText` adds the code card's file text, which only the note needs. */
export function whereNow(withText = false): Where {
  const s = scenario.peek(),
    view = codeView.peek(),
    landed = phase.peek() === 'landed' ? landedPath.peek() : null;
  const region = view && view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
  const code = view && codeCardOpen.peek() && hasSelection(view) ? view : null;
  return {
    problem: s && scenarioState.peek() === 'broken' ? { title: s.shortTitle, text: s.problem, file: s.file, line: s.line, fn: s.function } : null,
    selected: landed ? null : selectedPath.peek(),
    landed: landed ? { file: landed, fn: landedTown.peek()?.name ?? (view && view.file === landed && region ? region.name : null) } : null,
    code: code
      ? {
          file: code.file,
          fn: region?.name ?? null,
          fnRange: region ? { start: region.start, end: region.end } : null,
          range: code.selectedRange,
          lines: withText ? code.lines.map(segments => segments.map(seg => seg.text).join('')) : [],
        }
      : null,
  };
}
