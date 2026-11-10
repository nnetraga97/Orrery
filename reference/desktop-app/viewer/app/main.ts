// The viewer shell: loads a dataset, runs one view at a time, and owns selection, search and the toolbar.
import '../scene/color-space.js';
import { agentShowDatasetReady } from './agent-show.ts';
import { beginSceneLoading, scenePaint } from './scene-loading.ts';
import { createAgentCannon } from '../agents/agent-cannon.js';
import { ctxWin, mountContextWindows } from './context-windows.tsx';
import { forgetDataset } from '../planet/planet.js';
import { projectUI } from './projects.ts';
import { remember, remembered } from './project-store.ts';
import { installCheckSurface } from './check-surface.ts';
import { createRendererHost } from './host.ts';
import { $ } from './dom.ts';
import { USE_TAG, importUse, loadDataset, prepare, regroup, type ImportUse } from './graph.ts';
import { diffSnapshots } from './snapshot-diff.ts';
import { fileKey, forgetGalaxyMemory, loadGalaxyMemory } from './galaxy-memory.ts';
import { closeHeaderPopovers, initHeaderPopovers } from './header.ts';
import { mountPanels } from './panels/mount.tsx';
import { stage } from './stage-viewport.ts';
import { G, actions, projects, state, subscribe, update, type View, type ViewName } from './state.ts';
import type { FileNode } from './types.ts';
import { VIEWS } from './views.js';
import { openFile } from './workspace-files.ts';

const host = createRendererHost();
installCheckSurface(host);

const WELCOME = '__desktop-welcome__';

let cleanup = () => {};

// The view chooser follows the current view.
function paintViewChooser() {
  const current = state.current;
  document.querySelectorAll<HTMLElement>('header button[data-v]').forEach(b => {
    b.classList.toggle('on', b.dataset.v === current);
    b.setAttribute('aria-pressed', String(b.dataset.v === current));
  });
}
// The location hash records the dataset, view and grouping, so a reload returns to them.
function syncHash() {
  try {
    history.replaceState(
      null,
      '',
      state.dataset === WELCOME ? '#welcome' : `#${state.dataset}/${state.current}/${state.grouping}`,
    );
  } catch {}
}

// ---------- file context windows ----------
// Hovering a file previews it next to the pointer (context-windows.tsx); the full window pins on click (renderSelected).
function showHover(n?: FileNode | null) {
  ctxWin.hover(n ? fileWindow(n.i) : null);
}
const KIND_LABEL = {
  planet: 'Planet · hub file',
  asteroid: 'Asteroid · small file',
  comet: 'Comet · reaches other groups',
};
function fileWindow(i: number) {
  const { nodes, out, inc, color } = state;
  const n = nodes[i],
    esc = ctxWin.esc,
    tag = (u: ImportUse | null) => (u ? `<span class="use ${u.kind}">${USE_TAG[u.kind](u)}</span>` : '');
  const row = (j: number, u: ImportUse | null) =>
    `<li data-go="${j}" style="color:${color(G(nodes[j]))}">${tag(u)}${esc(nodes[j].path)}</li>`;
  const byImp = (list: number[], useOf: (j: number) => ImportUse | null) =>
    list
      .map(j => [j, useOf(j)] as const)
      .sort((a, b) => (b[1]?.refs || 0) - (a[1]?.refs || 0) || inc[b[0]].length - inc[a[0]].length)
      .map(([j, u]) => row(j, u));
  return {
    key: 'file:' + i,
    kind:
      state.current === 'constellation' && n.kind
        ? KIND_LABEL[n.kind]
        : (state.current === 'board' && state.view?.partOf?.(i)) || 'File',
    title: n.name,
    sub: n.path,
    color: color(G(n)),
    preview: [`${n.rloc} lines · imports ${out[i].length} · imported by ${inc[i].length}`, G(n)],
    anchor: () => state.view?.anchorOf?.(i) ?? null,
    body: (el: HTMLElement) => {
      el.innerHTML = `<h4 style="color:#ffd66b">Imports ${out[i].length}</h4><ul>${byImp(out[i], j => importUse(i, j)).join('') || '<li class="note">none</li>'}</ul>
        <h4 style="color:#7cc4ff">Imported by ${inc[i].length}</h4><ul>${byImp(inc[i], j => importUse(j, i)).join('') || '<li class="note">none</li>'}</ul>`;
      el.querySelectorAll<HTMLElement>('li[data-go]').forEach(li => (li.onclick = () => selectFile(+li.dataset.go!)));
    },
    actions: [
      ...(state.current === 'constellation'
        ? [{ label: 'Land on this planet ▸', primary: true, onClick: () => enterPlanet(i) }]
        : []),
      ...(state.current === 'board' && projects.has(state.dataset)
        ? [
            { label: 'Open file', primary: true, onClick: () => void openFile(state.dataset, n.path, true) },
            { label: 'Explore in 3D ▸', onClick: () => enterPlanet(i) },
          ]
        : []),
    ],
    onClose: () => {
      if (state.selected === i) selectFile(null);
    },
  };
}

// ---------- rendering the current view ----------
function render() {
  cleanup();
  cleanup = () => {};
  update({ view: null });
  $('extra').innerHTML = '';
  $('legendExtra').innerHTML = '';
  if (state.dataset === WELCOME) {
    ctxWin.close();
    $('labels').replaceChildren();
    stage.querySelectorAll('canvas').forEach(c => c.remove());
    document.body.classList.remove('planet-mode');
    $('sceneError').hidden = true;
    projectUI.paint();
    return;
  }
  ctxWin.close();
  showHover();
  update({ loadError: null });
  regroup();
  // A workspace with no sources yet has no country to map; the board and the constellation show the agent's first files.
  if (projects.has(state.dataset) && !state.nodes.length && state.current === 'graph') update({ current: 'board' });
  try {
    const view = VIEWS[state.current](host) as View;
    update({ view });
    cleanup = view.stop;
    // The agent's cannon sits at the heart of a project.
    if (state.current === 'constellation' && projects.has(state.dataset)) {
      const cannon = createAgentCannon(view, host),
        stop = view.stop;
      view.cannon = cannon;
      cleanup = view.stop = () => {
        cannon.stop();
        stop();
      };
    }
    projectUI.paint();
    if (state.selected != null) {
      view.select(state.selected, { fly: true });
      renderSelected();
    }
  } catch (err) {
    [...stage.querySelectorAll('canvas')].forEach(c => c.remove());
    console.error(err);
    update({ loadError: (err as Error).message });
  }
}

// ---------- selection ----------
function selectFile(i: number | null, { fly = true } = {}) {
  const view = state.view;
  if (state.current === 'constellation' && i != null && i === state.selected && view?.pinned === i)
    return enterPlanet(i); // click again to land
  update({ selected: i });
  view?.select(i, { fly });
  renderSelected();
}
// Land on a file: the constellation flies down to the body; its surface and towns build as the camera gets close.
function enterPlanet(
  i: number,
  {
    line = null,
    arrival = null,
    townId = null,
  }: { line?: number | null; arrival?: unknown; townId?: string | null } = {},
) {
  if (i == null || i < 0) return;
  if (state.current !== 'constellation') {
    update({ current: 'constellation', selected: null });
    render();
  }
  update({ selected: i });
  state.view!.land!(i, { line, arrival, townId });
  if (ctxWin.pinned?.key?.startsWith('file:')) ctxWin.close({ silent: true }); // the surface has its own windows
}
function exitPlanet() {
  state.view?.leave?.();
}
function renderSelected() {
  if (state.selected == null) {
    if (ctxWin.pinned?.key?.startsWith('file:')) ctxWin.close();
    return;
  }
  ctxWin.pin(fileWindow(state.selected));
}

// ---------- keyboard ----------
// Esc leaves a planet, then clears the selection. The file search (panels/FileSearch.tsx) owns '/'.
function wireEscape() {
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return; // Esc closed a context window first
    if (
      e.target instanceof Element &&
      e.target.closest('input, textarea, select, dialog, [role="textbox"], [contenteditable="true"]')
    )
      return;
    if (state.view?.landed) exitPlanet();
    else if (state.selected != null) selectFile(null);
  });
}

// ---------- datasets ----------
async function busyThen(fn: () => void) {
  const loading = beginSceneLoading('Preparing scene', 'Arranging files and connections…');
  try {
    await scenePaint();
    fn();
    await scenePaint();
  } finally {
    loading.finish();
  }
}
// A dataset's cached symbols and source text, dropped when it is opened afresh; its graph is replaced by the next load.
function invalidateDataset(name: string) {
  forgetDataset(name);
}
// Each project load or switch starts a new token; work begun under an older token stops at its next await.
let datasetToken = 0;
// Live rebuilds run one at a time. Requests that arrive meanwhile collapse into the newest; a revision that is
// already loaded (a reconnect's snapshot, a duplicate message) is ignored.
let reloadNext: { name: string; revision: number | null; generation: string | null } | null = null,
  reloading: Promise<void> | null = null;
function reloadDataset(name: string, revision: number | null = null, generation: string | null = null) {
  if (name !== state.dataset) return Promise.resolve();
  reloadNext = { name, revision, generation };
  reloading ||= (async () => {
    try {
      while (reloadNext) {
        const next = reloadNext;
        reloadNext = null;
        await reloadOnce(next.name, next.revision, next.generation);
      }
    } finally {
      reloading = null;
    }
  })();
  return reloading;
}
// Rebuild after source changes, preserving the camera; follow mode may frame the first sources.
async function reloadOnce(name: string, revision: number | null, generation: string | null) {
  const token = datasetToken;
  const current = () => token === datasetToken && name === state.dataset;
  if (!current()) return;
  if (revision != null && revision === state.revision && (generation == null || generation === state.generation))
    return;
  const previous = window.DATASETS?.[name];
  let loaded;
  try {
    loaded = await loadDataset(name, revision);
  } catch (error) {
    // That revision was already superseded and dropped; the newest one stands in for it.
    if ((error as { status?: number }).status !== 410) throw error;
    loaded = await loadDataset(name);
  }
  if (!current()) return;
  const changes = diffSnapshots(previous, loaded.data);
  update({ revision: loaded.revision, generation: loaded.generation });
  if (changes.same) return;
  // Only the files whose text or symbols changed lose their cached detail.
  forgetDataset(name, [...changes.content, ...changes.detail, ...changes.removed]);
  const selPath = state.selected != null ? state.nodes[state.selected]?.path : null;
  // Selection follows the file's layout identity, so a renamed file stays selected.
  const selKey = selPath ? fileKey(selPath) : null;
  const reselect = () => (selKey ? state.nodes.findIndex(n => fileKey(n.path) === selKey) : -1);
  // The constellation takes the new snapshot in place: same scene, camera and cannon, bodies easing to new orbits.
  const live = state.view;
  if (live?.update) {
    const firstSource = !state.nodes.length;
    prepare(loaded.data, { after: state.nodes });
    regroup();
    update({ selected: null });
    live.update({ refresh: new Set([...changes.content, ...changes.detail]) });
    const i = reselect();
    if (i >= 0) update({ selected: i });
    if (selPath) live.select(i >= 0 ? i : null, { fly: false });
    renderSelected();
    projectUI.paint();
    if (firstSource && state.nodes.length) live.cannon?.frameWorkspace();
    return;
  }
  // Other views are rebuilt. Shots already in the air land before the cannon is rebuilt; new ones wait in its queue.
  await state.view?.cannon?.settle?.();
  if (!current()) return;
  const view = state.view;
  const cam =
    view?.camera && view.controls ? { p: view.camera.position.clone(), t: view.controls.target.clone() } : null;
  const firstSource = !state.nodes.length;
  const wasLanded = !!view?.landed;
  cleanup();
  cleanup = () => {};
  update({ view: null });
  prepare(loaded.data, { after: state.nodes });
  update({ selected: null });
  const i = reselect();
  render();
  const next = state.view;
  if (cam && next?.camera && next.controls) {
    next.camera.position.copy(cam.p);
    next.controls.target.copy(cam.t);
    next.clearControlMotion?.();
  }
  if (firstSource && state.nodes.length) next?.cannon?.frameWorkspace();
  if (i >= 0 && next) {
    update({ selected: i });
    next.select(i, { fly: false });
    renderSelected();
    if (wasLanded) enterPlanet(i);
  }
}
async function useDataset(name: string) {
  agentShowDatasetReady(null);
  const token = ++datasetToken;
  update({ dataset: name, selected: null, revision: null, generation: null });
  $<HTMLSelectElement>('dataset').value = name;
  const loading = beginSceneLoading('Loading scene', 'Reading project structure…');
  renderSelected();
  cleanup();
  cleanup = () => {};
  update({ view: null });
  try {
    invalidateDataset(name);
    const [loaded] = await Promise.all([loadDataset(name), loadGalaxyMemory(projects.has(name) ? name : null)]);
    if (token !== datasetToken) return;
    update({ revision: loaded.revision, generation: loaded.generation });
    loading.update('Arranging files and connections…');
    await scenePaint();
    if (token !== datasetToken) return;
    prepare(loaded.data);
    render();
    loading.update('Preparing the view…');
    await projectUI.changed(name);
    agentShowDatasetReady(name);
    await scenePaint();
  } catch (e) {
    if (token !== datasetToken) return;
    console.error(e);
    update({ loadError: 'Could not load this project.' });
  } finally {
    loading.finish();
  }
}

Object.assign(actions, {
  selectFile,
  enterPlanet,
  exitPlanet,
  renderSelected,
  showHover,
  render,
  useDataset,
  reloadDataset,
  invalidateDataset,
});

// ---------- toolbar and startup ----------
subscribe(['current'], paintViewChooser);
subscribe(['grouping'], () => ($<HTMLSelectElement>('groupSel').value = state.grouping));
// An empty workspace has no country map yet; the board and the constellation show the agent's first files.
subscribe(['emptyWorkspace'], () => {
  const empty = state.emptyWorkspace;
  document.querySelectorAll<HTMLButtonElement>('header button[data-v]').forEach(b => {
    b.disabled = empty && b.dataset.v === 'graph';
  });
  $<HTMLSelectElement>('groupSel').disabled = empty;
});
subscribe(['dataset', 'current', 'grouping'], syncHash);
wireEscape();
mountContextWindows();
mountPanels();
initHeaderPopovers();
document.querySelectorAll<HTMLElement>('header button[data-v]').forEach(
  b =>
    (b.onclick = () => {
      if (b.dataset.v === state.current) return;
      update({ current: b.dataset.v as ViewName });
      remember('galaxyView', state.current);
      closeHeaderPopovers();
      busyThen(render);
    }),
);
$<HTMLSelectElement>('groupSel').onchange = e => {
  update({ grouping: (e.target as HTMLSelectElement).value as 'cluster' | 'folder' });
  busyThen(render);
};
$<HTMLSelectElement>('dataset').onchange = e => useDataset((e.target as HTMLSelectElement).value);
// The galaxy keeps its shape as files change; this regroups the files and lays it out afresh.
$('reorganizeBtn').onclick = () => {
  const data = window.DATASETS?.[state.dataset];
  if (!data) return;
  closeHeaderPopovers();
  forgetGalaxyMemory();
  const selPath = state.selected != null ? state.nodes[state.selected]?.path : null;
  prepare(data);
  const i = selPath ? state.nodes.findIndex(n => n.path === selPath) : -1;
  update({ selected: i >= 0 ? i : null });
  busyThen(render);
};
// Panel changes resize the canvas too, without rebuilding a live 3D scene.
let stageResizeFrame = 0;
new ResizeObserver(() => {
  if (stageResizeFrame) return;
  stageResizeFrame = requestAnimationFrame(() => {
    stageResizeFrame = 0;
    const view = state.view;
    if (view) view.resize ? view.resize() : render();
  });
}).observe(stage);

// The hash (a reload, or --view= at launch) wins over the view the user last chose.
const [, hv, hg] = location.hash.slice(1).split('/');
if (hv in VIEWS) update({ current: hv as ViewName });
if (hg === 'folder') update({ grouping: 'folder' });
paintViewChooser();
const startupLoading = beginSceneLoading('Opening workspace', 'Preparing your scene…');
projectUI
  .init()
  .then(name => {
    // Preferences have loaded: without a view in the hash, open the view the user last chose.
    const last = remembered('galaxyView');
    if (!(hv in VIEWS) && last && last in VIEWS) update({ current: last as ViewName });
    return useDataset(name);
  })
  .catch(error => {
    startupLoading.finish();
    console.error(error);
    update({ loadError: 'Could not open the workspace.' });
  });
