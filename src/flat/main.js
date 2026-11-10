// Flat reference view: the copied constellation running in an ordinary browser tab with the mouse, fed by a baked
// dataset. It exists to check the migrated code and data against the desktop app; it is not the product.
// Open flat.html?dataset=<name> (default: sample). Add &land=<path> to land on a file's planet once loaded, and
// &line=<n> to fly to the town that holds that source line. &cannon=off leaves out the agent's cannon.
import '../../galaxy/viewer/scene/color-space.js';
import { constellation } from '../../galaxy/viewer/galaxy/constellation.js';
import { createAgentCannon } from '../../galaxy/viewer/agents/agent-cannon.js';
import { loadGalaxyMemory } from '../../galaxy/viewer/app/galaxy-memory.ts';
import { loadDataset, prepare, regroup } from '../../galaxy/viewer/app/graph.ts';
import { actions, projects, state, update } from '../../galaxy/viewer/app/state.ts';
import { createFlatHost } from './flat-host.js';

const query = new URLSearchParams(location.search);
const dataset = query.get('dataset') || 'sample';
const host = createFlatHost();

Object.assign(actions, {
  render() {},
  showHover(node) {
    host.windows.context.hover(node ? { kind: 'File', title: node.path } : null);
  },
  selectFile(i, { fly = true } = {}) {
    if (i != null && i === state.selected && state.view?.pinned === i) return actions.enterPlanet(i);
    update({ selected: i });
    state.view?.select(i, { fly });
    host.report('selected', i == null ? '' : state.nodes[i].path);
  },
  enterPlanet(i, { line = null, arrival = null, townId = null } = {}) {
    if (i == null || i < 0) return;
    update({ selected: i });
    state.view.land(i, { line, arrival, townId });
    host.report('landed', state.nodes[i].path);
  },
  exitPlanet() {
    state.view?.leave?.();
    host.report('landed', '');
  },
});

window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (state.view?.landed) actions.exitPlanet();
  else if (state.selected != null) actions.selectFile(null);
});

async function start() {
  projects.set(dataset, { version: 1 });
  const [loaded] = await Promise.all([loadDataset(dataset), loadGalaxyMemory(dataset)]);
  update({ dataset, current: 'constellation', revision: loaded.revision, generation: loaded.generation });
  prepare(loaded.data);
  regroup();
  const view = constellation(host);
  // The agent's cannon and its island sit at the heart of a project.
  if (query.get('cannon') !== 'off') {
    const cannon = createAgentCannon(view, host),
      stop = view.stop;
    view.cannon = cannon;
    view.stop = () => {
      cannon.stop();
      stop();
    };
  }
  update({ view });
  host.report('dataset', `${dataset} · ${state.nodes.length} files · ${state.links.length} imports`);
  const land = query.get('land');
  if (land) {
    const node = state.nodes.find(n => n.path === land);
    if (node) actions.enterPlanet(node.i, { line: query.get('line') ? Number(query.get('line')) : null });
    else host.report('land', `no such file: ${land}`);
  }
  // For automated checks: the page is ready once a view exists.
  window.__flat = { state, actions, view, host };
}

start().catch(error => {
  console.error(error);
  host.report('error', error.message);
  window.__flatError = error.message;
});
