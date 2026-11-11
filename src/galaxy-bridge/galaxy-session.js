// Opens a baked dataset and builds the constellation in the XR host, as src/flat/main.js does for the flat view, and
// installs the copied actions so that selection and landing publish to the app state.
import '../../galaxy/viewer/scene/color-space.js';
import { constellation } from '../../galaxy/viewer/galaxy/constellation.js';
import { createAgentCannon } from '../../galaxy/viewer/agents/agent-cannon.js';
import { loadGalaxyMemory } from '../../galaxy/viewer/app/galaxy-memory.ts';
import { loadDataset, prepare, regroup } from '../../galaxy/viewer/app/graph.ts';
import { actions, projects, state, update } from '../../galaxy/viewer/app/state.ts';

// The pieces of the copied app layer the XR host uses, re-exported here so TypeScript sees them through
// galaxy-session.d.ts instead of type-checking the copied files.
export {
  fileAppearance,
  galaxyLayoutNotice,
  layoutMemory,
  saveGalaxyMemory,
  townKeys,
} from '../../galaxy/viewer/app/galaxy-memory.ts';
export { fetchSymbols, groupArms, importUse, importsIndexed, membersOf, nodeOf } from '../../galaxy/viewer/app/graph.ts';
export { remember, remembered } from '../../galaxy/viewer/app/project-store.ts';
export { G, actions, projects } from '../../galaxy/viewer/app/state.ts';
export { planetBuildBudget } from '../../galaxy/viewer/shared/build-budget.js';
export { languageOf } from '../../galaxy/source-model/languages.js';
export { loadTypeScript } from '../../galaxy/viewer/towns/town-assets.js';
export { UIIcons } from '../../galaxy/viewer/shared/ui-icons.js';

/** The copied code's shared state (files, links, the running view). */
export const galaxyState = state;

export function installActions(host, publish) {
  Object.assign(actions, {
    render() {},
    showHover(node) {
      host.windows.context.hover(node ? { key: `file:${node.path}`, kind: 'File', title: node.path } : null);
    },
    selectFile(i, { fly = true } = {}) {
      if (i != null && i === state.selected && state.view?.pinned === i) return actions.enterPlanet(i);
      update({ selected: i });
      state.view?.select(i, { fly });
      publish.selected(i == null ? null : state.nodes[i].path);
      host.windows.context.pin(i == null ? null : fileCard(host, i));
    },
    enterPlanet(i, { line = null, arrival = null, townId = null } = {}) {
      if (i == null || i < 0) return;
      update({ selected: i });
      publish.selected(state.nodes[i].path);
      state.view.land(i, { line, arrival, townId });
    },
    exitPlanet() {
      state.view?.leave?.();
    },
  });
}

// The card a selected file shows: what it is, how connected it is, and a way in.
function fileCard(host, i) {
  const n = state.nodes[i];
  const group = host.graph.groupOf(n);
  return {
    key: `file:${n.path}`,
    kind: 'File',
    title: n.name,
    sub: n.path,
    color: host.graph.color(group),
    text: `${n.rloc.toLocaleString()} lines · imports ${state.out[i].length} · imported by ${state.inc[i].length}\nGroup: ${group}`,
    actions: [
      { label: 'Open', primary: true, onClick: () => actions.enterPlanet(i) },
      { label: 'Deselect', onClick: () => actions.selectFile(null) },
    ],
    anchor: host.windows.worldAnchor(() => state.view.bodyPos(i)),
  };
}

/** Loads `dataset` and builds its constellation in `host`. Resolves to the view, or to null when `isCurrent()` says a
 * later open has taken over while this one was loading (it then builds nothing). */
export async function openGalaxy(host, dataset, { cannon = true, isCurrent = () => true } = {}) {
  try {
    state.view?.stop();
  } finally {
    update({ view: null, selected: null });
  }
  projects.set(dataset, { version: 1 });
  const [loaded] = await Promise.all([loadDataset(dataset), loadGalaxyMemory(dataset)]);
  if (!isCurrent()) return null;
  update({ dataset, current: 'constellation', revision: loaded.revision, generation: loaded.generation });
  prepare(loaded.data);
  regroup();
  const view = constellation(host);
  // The agent's cannon and its island sit at the heart of a project.
  if (cannon) {
    const shooter = createAgentCannon(view, host),
      stop = view.stop;
    view.cannon = shooter;
    view.stop = () => {
      shooter.stop();
      stop();
    };
  }
  update({ view });
  return view;
}

/** The file index of `path`, or -1. */
export const fileIndex = path => state.nodes.findIndex(n => n.path === path);
