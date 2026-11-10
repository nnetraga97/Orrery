import type { ExceptionMode } from './settings.ts';
import { remembered } from './project-store.ts';
import { state, actions } from './state.ts';
import { activeFolder, command, showGalaxy, showsWelcome, workbenchStore } from './workbench.ts';
import { filesStore, openFile } from './workspace-files.ts';
import { frameParts } from '../shared/debug-frames.js';
export type DebugFrame = {
  id: string;
  name: string;
  file: string;
  line: number;
  column: number;
  depth: number;
  context: string;
  continues?: string;
  mapping: string;
  text: string | null;
  local: boolean;
};
export type Breakpoint = {
  id: string;
  file: string;
  line: number;
  column: number;
  text: string;
  mode: 'pause' | 'trace';
  status?: string;
  locations?: { file: string; line: number; column: number }[];
};
export type VariableKind = 'parameter' | 'local' | 'receiver' | 'field' | 'index' | 'scope';
export type Variable = { name: string; display: string; handle: string | null; type?: string; kind?: VariableKind };
export type DebugState = {
  adapter?: string;
  configuration?: string;
  driver: 'user' | 'agent';
  agent?: string | null;
  handoff: { message: string; time: number } | null;
  breakpoints?: Breakpoint[];
  trace?: (DebugFrame & { sequence: number; time: number }) | null;
  status: string;
  entry?: string;
  session?: string;
  projectId?: string;
  pause?: number;
  frames: DebugFrame[];
  output: string;
  exception?: string;
  /** Why the debuggee last stopped, as its adapter reported it ('step', 'breakpoint', 'exception', …). */
  reason?: string;
  error?: string;
  selected?: number;
};
type Bridge = {
  debugBreakpoints(projectId: string, specs: Breakpoint[]): Promise<Breakpoint[]>;
  debugVariables(session: string, pause: number, frame: string): Promise<Variable[]>;
  debugProperties(session: string, pause: number, handle: string): Promise<{ values: Variable[]; truncated: boolean }>;
  debugState(): Promise<DebugState>;
  debugLaunch(config: {
    projectId: string;
    entry?: string;
    args?: string[];
    configuration?: string;
    exceptionMode: ExceptionMode;
  }): Promise<DebugState>;
  debugEvaluate(
    session: string,
    pause: number,
    frameId: string,
    expression: string,
  ): Promise<{ display: string; type?: string; handle: string | null }>;
  debugCommand(session: string, action: string): Promise<DebugState>;
  onDebugEvent(callback: (state: DebugState) => void): () => void;
};
const bridge = window.galaxyDesktop as unknown as Bridge;
let snapshot = {
  runtime: { status: 'idle', frames: [], output: '', driver: 'user', handoff: null } as DebugState,
  open: false,
  error: '',
  variables: [] as Variable[],
  variablesError: '',
  followShip: false,
  // The agent's current session: followed automatically for users who follow the agent, otherwise offered.
  agentShip: null as { session: string; following: boolean } | null,
  breakpointBusy: false,
  location: '',
  reveal: null as { frame: DebugFrame; projectId: string } | null,
};
const listeners = new Set<() => void>();
const update = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  for (const f of listeners) f();
};
// A frame card's lines: the frame's arguments, objects as {Type@id}, as the Variables view shows them.
function argumentLines(variables: Variable[]) {
  return variables
    .filter(v => v.kind === 'parameter')
    .slice(0, 4)
    .map(v => {
      const value = v.handle && v.type !== 'lambda' && !/^[{[]/.test(v.display) ? `{${v.display}}` : v.display;
      return `${v.name} = ${value.length > 40 ? value.slice(0, 39) + '…' : value}`;
    });
}
// Where the constellation's execution ship rides: the paused frame's file, or the last trace hit's while running.
function executionPlace(r: DebugState) {
  const top = r.status === 'paused' ? r.frames[0] : null;
  if (top?.local) {
    const { method } = frameParts(top);
    // The whole stack, innermost first, so the constellation can trace how execution reached this planet.
    const stack = r.frames.map((f, index) => ({
      file: f.local ? f.file : null,
      label: `${index + 1} ${frameParts(f).method}:${f.line}`,
      index,
    }));
    return { file: top.file, line: top.line, label: `Paused · ${method}:${top.line}`, paused: true, stack };
  }
  if (r.status === 'running' && r.trace?.local)
    return {
      file: r.trace.file,
      line: r.trace.line,
      label: `Running · ${r.trace.file.split('/').pop()}:${r.trace.line}`,
      paused: false,
    };
  return null;
}
export const debugStore = {
  get: () => snapshot,
  subscribe: (f: () => void) => {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};
let selectionVersion = 0;
let started = false;
export function startDebug() {
  if (started) return;
  started = true;
  const receive = (runtime: DebugState) => {
    const previous = snapshot.runtime;
    if (runtime.status !== 'paused') {
      ++selectionVersion;
      update({ variables: [], variablesError: '' });
    }
    const newPause =
      runtime.status === 'paused' &&
      (previous.status !== 'paused' || previous.session !== runtime.session || previous.pause !== runtime.pause);
    if (!newPause && runtime.status === 'paused') runtime = { ...runtime, selected: previous.selected };
    const agentShip =
      runtime.session && runtime.session !== previous.session
        ? runtime.driver === 'agent'
          ? { session: runtime.session, following: remembered('galaxyFollow') === 'on' }
          : null
        : snapshot.agentShip;
    update({ runtime, agentShip, ...(runtime.status === 'paused' ? { open: true } : { reveal: null, location: '' }) });
    if (newPause || runtime.handoff) void command('closeProblems');
    // Before navigating, so a pause in another file finds the ship already flying there.
    void state.view?.executionAt?.(executionPlace(runtime));
    if (newPause) {
      // A pause seen from the constellation stays there: the execution ship moves to the paused file's planet.
      // Otherwise it is shown where the user is: in the editor, or on the (followed or landed) planet.
      const inGalaxy = !filesStore.get().active && !showsWelcome(workbenchStore.get());
      const world = following() || (inGalaxy && !!state.view?.landed);
      void selectDebugFrame(0, world, world || !inGalaxy);
    }
    if (runtime.trace?.sequence !== previous.trace?.sequence || runtime.session !== previous.session) {
      if (following()) void queueShip();
      // While paused, the frame cards mark where execution stands; the ship shows travel between observations.
      else void state.view?.runtimeTrace?.(runtime.status === 'paused' ? null : runtime.trace || null);
    }
    if (!runtime.trace) void state.view?.runtimeTrace?.(null);
    if (runtime.status !== 'paused') void state.view?.runtimeStack?.([], null);
    void state.view?.runtimeBreakpoints?.(runtime.breakpoints || []);
  };
  bridge.onDebugEvent(receive);
  void bridge.debugState().then(receive);
  workbenchStore.subscribe(() => {
    const r = snapshot.runtime;
    if (
      r.projectId &&
      activeFolder()?.project.id !== r.projectId &&
      ['starting', 'running', 'paused', 'resuming'].includes(r.status)
    )
      void debugCommand('stop');
  });
}
export function toggleDebug() {
  update({ open: !snapshot.open });
}
export async function launchDebug(
  entry: string,
  args: string,
  exceptionMode: ExceptionMode = 'failures',
  configuration?: string,
) {
  try {
    const folder = activeFolder();
    if (!folder) throw new Error('Open a project first');
    const parsed: unknown = configuration ? [] : JSON.parse(args || '[]');
    if (!Array.isArray(parsed) || parsed.some(a => typeof a !== 'string'))
      throw new Error('Arguments must be a JSON array of strings');
    update({ error: '', location: '', reveal: null });
    await bridge.debugLaunch({
      projectId: folder.project.id,
      ...(configuration ? { configuration } : { entry, args: parsed }),
      exceptionMode,
    });
  } catch (e) {
    update({ error: String(e) });
  }
}
export async function debugCommand(action: string) {
  try {
    update({ error: '' });
    await bridge.debugCommand(snapshot.runtime.session!, action);
  } catch (e) {
    update({ error: String(e) });
  }
}
/** Selects a frame and loads its variables; `navigate` then shows it in the world or the editor. */
export async function selectDebugFrame(index: number, world = false, navigate = true) {
  const selection = ++selectionVersion;
  const r = snapshot.runtime,
    frame = r.frames[index];
  if (!frame) return;
  update({ runtime: { ...r, selected: index }, error: '', location: '', variables: [], variablesError: '' });
  void bridge
    .debugVariables(r.session!, r.pause!, frame.id)
    .then(variables => {
      if (selection !== selectionVersion) return;
      update({ variables });
      void state.view?.runtimeArguments?.(index, argumentLines(variables));
    })
    .catch(e => {
      if (selection === selectionVersion) update({ variablesError: String(e) });
    });
  if (!navigate) return;
  try {
    if (!frame.local || frame.text == null)
      throw new Error(
        'No verified workspace source for this frame. Its reported runtime location remains in the stack.',
      );
    if (r.projectId !== activeFolder()?.project.id) throw new Error('This frame belongs to another project');
    if (world) {
      if (state.dataset !== r.projectId) throw new Error('Wait for this project to finish loading');
      const i = state.nodes.findIndex(n => n.path === frame.file);
      if (i < 0) throw new Error('This source file is not in the analyzed project');
      showGalaxy();
      // Execution moved to another planet: ride behind the execution ship there before landing.
      await state.view?.followExecution?.(frame.file);
      if (selection !== selectionVersion) return;
      // Re-entering the planet being shown would reset the camera to a town view on every step.
      if (state.view?.debugFile?.() !== frame.file || !state.view?.landed) actions.enterPlanet(i);
      const rows = await state.view?.runtimeStack?.(r.frames, index, r.exception ?? null, r.reason ?? null);
      // Arguments that arrived before the planet's stack was drawn go onto its card now.
      if (selection === selectionVersion && snapshot.variables.length)
        void state.view?.runtimeArguments?.(index, argumentLines(snapshot.variables));
      await state.view?.runtimeBreakpoints?.(r.breakpoints || []);
      // A paused frame is marked by its card; the ship only travels while running.
      await state.view?.runtimeTrace?.(null);
      if (
        snapshot.runtime.session !== r.session ||
        snapshot.runtime.pause !== r.pause ||
        snapshot.runtime.status !== 'paused'
      ) {
        await state.view?.runtimeStack?.([], null);
        return;
      }
      if (selection !== selectionVersion) return;
      const status = rows?.find(row => row.n === index + 1)?.status;
      update({
        location:
          status === 'exact'
            ? 'Exact source mapped to town / building'
            : `Building mapping: ${status || 'unavailable'}. No approximate building selected.`,
      });
    } else {
      await openFile(r.projectId!, frame.file, true);
      if (
        snapshot.runtime.session !== r.session ||
        snapshot.runtime.pause !== r.pause ||
        snapshot.runtime.status !== 'paused'
      )
        return;
      if (selection !== selectionVersion) return;
      const doc = filesStore.get().documents.find(d => d.projectId === r.projectId && d.path === frame.file);
      if (doc?.text !== frame.text)
        throw new Error(
          'Source changed since execution. Current editor is not highlighted; inspect the captured source below or restart.',
        );
      update({ reveal: { frame, projectId: r.projectId! }, location: `Exact source · ${frame.mapping}` });
    }
  } catch (e) {
    if (selection === selectionVersion) update({ error: String(e), reveal: null });
  }
}

export async function inspectVariable(handle: string) {
  const r = snapshot.runtime;
  return bridge.debugProperties(r.session!, r.pause!, handle);
}
export async function replaceBreakpoints(specs: Breakpoint[]) {
  if (snapshot.breakpointBusy) return;
  try {
    const project = activeFolder()?.project.id;
    if (!project) throw new Error('Open a project first');
    update({ breakpointBusy: true, error: '' });
    await bridge.debugBreakpoints(project, specs);
  } catch (e) {
    update({ error: String(e) });
  } finally {
    update({ breakpointBusy: false });
  }
}
export async function toggleBreakpoint(file: string, line: number, column: number, text: string) {
  const list = snapshot.runtime.projectId === activeFolder()?.project.id ? snapshot.runtime.breakpoints || [] : [];
  const existing = list.find(b => b.file === file && b.line === line);
  await replaceBreakpoints(
    existing
      ? list.filter(b => b.id !== existing.id)
      : [...list, { id: `${file}:${line}:${column}`, file, line, column, text, mode: 'pause' }],
  );
}
export async function breakpointAtBuilding() {
  const at = await state.view?.debugSelection?.();
  if (!at) {
    update({ error: 'Select a statement building first.' });
    return;
  }
  const list = snapshot.runtime.projectId === activeFolder()?.project.id ? snapshot.runtime.breakpoints || [] : [];
  const existing = list.find(
    b =>
      b.file === at.file &&
      ((b.line === at.line && b.column === at.column) ||
        b.locations?.some(
          l =>
            l.line >= at.line &&
            l.line <= at.end &&
            (l.line !== at.line || l.column >= at.column) &&
            (l.line !== at.end || l.column < at.endColumn),
        )),
  );
  await replaceBreakpoints(
    existing
      ? list.filter(b => b.id !== existing.id)
      : [
          ...list,
          {
            id: `${at.file}:${at.line}:${at.column}`,
            file: at.file,
            line: at.line,
            column: at.column,
            text: at.text,
            mode: 'pause',
          },
        ],
  );
}
function following() {
  const ship = snapshot.agentShip;
  return snapshot.followShip || (ship?.following === true && ship.session === snapshot.runtime.session);
}
export function followAgentShip() {
  const ship = snapshot.agentShip;
  if (!ship || ship.session !== snapshot.runtime.session) return;
  update({ agentShip: { ...ship, following: true } });
  const r = snapshot.runtime;
  if (r.status === 'paused') void selectDebugFrame(r.selected ?? 0, true);
  else void queueShip();
}
export function dismissAgentShip() {
  update({ agentShip: null });
}
export function toggleFollowShip() {
  update({ followShip: !snapshot.followShip });
  if (snapshot.followShip) queueShip();
}
let shipBusy = false,
  shipAgain = false;
async function queueShip() {
  if (shipBusy) {
    shipAgain = true;
    return;
  }
  shipBusy = true;
  try {
    do {
      shipAgain = false;
      const r = snapshot.runtime,
        point = r.trace;
      if (!following()) break;
      if (r.status === 'paused') {
        await state.view?.runtimeTrace?.(null);
        break;
      }
      if (!point || !point.local || point.text == null || state.dataset !== r.projectId) {
        await state.view?.runtimeTrace?.(null);
        break;
      }
      const i = state.nodes.findIndex(n => n.path === point.file);
      if (i < 0) {
        await state.view?.runtimeTrace?.(null);
        break;
      }
      showGalaxy();
      if (state.view?.debugFile?.() !== point.file) {
        await state.view?.followExecution?.(point.file);
        actions.enterPlanet(i);
      }
      await state.view?.runtimeTrace?.(point, true);
      await state.view?.runtimeBreakpoints?.(r.breakpoints || []);
      if (snapshot.runtime.session !== r.session || !snapshot.runtime.trace) await state.view?.runtimeTrace?.(null);
    } while (shipAgain);
  } catch (e) {
    update({ error: String(e) });
  } finally {
    shipBusy = false;
  }
}

export async function inspectBuilding() {
  const index = await state.view?.debugFrameAtSelection?.(snapshot.runtime.frames);
  if (index == null || index < 0) {
    update({ error: 'No paused invocation at this building. Select a matching call-stack frame.' });
    return;
  }
  await selectDebugFrame(index, true);
}

export async function evaluateDebug(expression: string) {
  const r = snapshot.runtime,
    frame = r.frames[r.selected ?? 0];
  if (r.status !== 'paused' || !frame || !r.session || r.pause == null)
    throw new Error('Pause and select a frame first');
  return bridge.debugEvaluate(r.session, r.pause, frame.id, expression);
}
