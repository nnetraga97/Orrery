// Replays the scenario's code step by step (docs/plans/changes-after-review.md, Task 14): no replay panel. Starting a
// replay opens the code card on the step's line, with the step's note and values under its header and Back, Step,
// Play and the position in its footer. The copied galaxy's execution ship flies to the step's file and labels its
// call stack (view.executionAt). The Replay tab starts the failing run before the fix and the fixed run after; the
// agent's run_replay does the same. An "Agent is debugging" card (callout-system.ts) offers Follow ship, Stop
// following and Dismiss.
import { createSystem } from '@iwsdk/core';
import { createReplay, replayErrors } from '../core/replay.ts';
import type { Replay, ReplayData } from '../core/replay.ts';
import { galaxyState } from '../galaxy-bridge/galaxy-session.js';
import { codeCardOpen, replay, replayRequest, scenario, scenarioState } from '../state/app-state.ts';
import { connectReplay, showCode } from '../state/commands.ts';
import { ChatWindowSystem } from './chat-window-system.ts';

const STEP_MS = 1600;
type View = { executionAt?(place: { file: string; line: number; label: string; paused: boolean; stack: unknown[] } | null): unknown };

export class ReplaySystem extends createSystem({}) {
  private run: Replay | null = null;
  private which: 'failing' | 'fixed' = 'failing';
  private following = true;
  private dismissed = false;
  private cache = new Map<string, ReplayData>();
  private token = 0;

  init() {
    this.cleanupFuncs.push(
      connectReplay({
        start: which => void this.start(which),
        step: () => this.move(r => r.step()),
        back: () => this.move(r => r.back()),
        play: () => {
          if (!this.run) return;
          if (this.run.playing) this.run.pause();
          else this.run.play(STEP_MS, performance.now());
          this.publish();
        },
        stop: () => this.endReplay(),
        follow: on => {
          this.following = on;
          this.publish();
          if (on) this.show();
        },
        dismissNotice: () => {
          this.dismissed = true;
          this.publish();
        },
      }),
      replayRequest.subscribe(r => {
        if (!r) return;
        replayRequest.value = null;
        void this.start(r.which);
      }),
      // Closing the code card ends the replay.
      codeCardOpen.subscribe(open => {
        if (!open && this.run) this.endReplay();
      }),
    );
    this.world.getSystem(ChatWindowSystem)?.enableTab('replay', () => void this.start(scenarioState.peek() === 'broken' ? 'failing' : 'fixed'));
  }

  private async load(name: string): Promise<ReplayData | null> {
    const hit = this.cache.get(name);
    if (hit) return hit;
    try {
      const res = await fetch(`scenarios/${encodeURIComponent(name)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as ReplayData;
      // Files must be in the open project; line ranges were checked when the runs were written (core test).
      const errors = replayErrors(data, file => (galaxyState.nodes.some(n => n.path === file) ? Number.MAX_SAFE_INTEGER : null));
      if (errors.length) {
        console.warn('[orrery] replay', name, errors);
        return null;
      }
      this.cache.set(name, data);
      return data;
    } catch {
      return null;
    }
  }

  private async start(which: 'failing' | 'fixed') {
    const s = scenario.peek();
    if (!s) return;
    const token = ++this.token;
    const data = await this.load(s.replay[which]);
    if (!data || token !== this.token) return;
    this.which = which;
    this.run = createReplay(data);
    this.following = true;
    this.dismissed = false;
    this.show();
  }

  private move(f: (r: Replay) => unknown) {
    if (!this.run) return;
    f(this.run);
    this.show();
  }

  private endReplay() {
    this.token++;
    this.run = null;
    replay.value = null;
    this.execution(null);
  }

  private execution(place: Parameters<NonNullable<View['executionAt']>>[0]) {
    try {
      void (galaxyState.view as View | null)?.executionAt?.(place);
    } catch (e) {
      console.warn('[orrery] the execution ship could not move', e);
    }
  }

  /** Shows the current step: the code card on its line (when following) and the ship at its file. */
  private show() {
    const r = this.run;
    if (!r) return;
    const step = r.current();
    if (this.following) showCode(step.file, step.line);
    // The ship's stack runs from the innermost frame out.
    this.execution({ file: step.file, line: step.line, label: step.label, paused: true, stack: [...step.stack].reverse() });
    this.publish();
  }

  private publish() {
    const r = this.run;
    if (!r) return;
    const step = r.current();
    replay.value = {
      which: this.which,
      title: r.data.title,
      outcome: r.data.outcome,
      index: r.index,
      total: r.data.steps.length,
      playing: r.playing,
      file: step.file,
      line: step.line,
      label: step.label,
      note: step.note ?? null,
      variables: step.variables,
      following: this.following,
      noticeDismissed: this.dismissed,
    };
  }

  update() {
    if (this.run?.tick(performance.now())) this.show();
  }
}
