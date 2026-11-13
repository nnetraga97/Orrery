// Owns selection tint, galaxy labels, toolbar controls and contextual pickers.
import * as THREE from 'three';
import * as d3 from 'd3';
import { canvasTexture } from '../scene/textures.js';
import { UIIcons } from '../shared/ui-icons.js';
import { importCounts } from './import-counts.js';

const targetTex = canvasTexture(x => {
  x.strokeStyle = '#fff';
  x.lineWidth = 6;
  x.beginPath();
  x.arc(64, 64, 50, 0, 7);
  x.stroke();
  x.lineWidth = 5;
  [
    [64, 4, 64, 26],
    [64, 102, 64, 124],
    [4, 64, 26, 64],
    [102, 64, 124, 64],
  ].forEach(([a, b, c, d]) => {
    x.beginPath();
    x.moveTo(a, b);
    x.lineTo(c, d);
    x.stroke();
  });
});

export function createSelection(ctx) {
  const { host, T, u, model, instances, lod, frame: frameState } = ctx;
  function refreshTint() {
    const focusFile = T.pinned ?? frameState.hoverSel;
    const nb = focusFile == null ? null : new Set([focusFile, ...host.data.out()[focusFile], ...host.data.inc()[focusFile]]);
    host.data.nodes().forEach(n => {
      model.tint[n.i] = nb ? (nb.has(n.i) ? 1 : 0.18) : 1;
    });
    ctx.bodies.paintBodies();
  }

  T.setPick(
    instances.pickBodies,
    hit => hit.object.userData.fileIds[hit.instanceId],
    i => model.pos[i].clone(),
    {
      follow: true,
      flyDist: 32 * u,
      highlight: i => {
        frameState.hoverSel = i;
        ctx.fleet.highlight(i);
      },
    },
  );
  // Arm and system names, replaced with each build; the cannon's own labels are left alone. An arm whose one system
  // already carries the folder's name (grouping by folder) needs no name of its own. Where labels would overlap, arm
  // names win over file names, then system names. Frequently imported files get names first. System names follow their easing holes.
  let removeLabels = () => {};
  function labelGalaxy() {
    removeLabels();
    const armLabels =
      model.galaxy.arms.length > 1
        ? model.galaxy.arms
            .filter(arm => !(arm.members.length === 1 && host.data.groups()[arm.members[0]] === arm.name))
            .map(arm => ({
              text: arm.name,
              col: host.graph.color(host.data.groups()[arm.members[0]]),
              cls: 'arm',
              priority: 100,
              pos: new THREE.Vector3(arm.at[0], 0, arm.at[1]),
            }))
        : [];
    const systemLabels = model.holes.slice(0, 30).map(h => {
      const at = new THREE.Vector3();
      return {
        text: h.g,
        col: host.graph.color(h.g),
        pos: () => at.copy(h.center).setY(h.center.y + h.base * h.scale * 2.2 + 1.5 * u),
      };
    });
    // Only substantial or much-used files need names in the overview. The files most others depend on come first
    // and are written larger (the first three, then the next five), so the overview itself ranks them. A selected
    // star's name is on its marker, so its overview name steps aside.
    const used = new Map(host.data.nodes().map(n => [n.i, importCounts(host, n.i).inRun]));
    const planetLabels = [...host.data.nodes()]
      .filter(n => model.orbit[n.i].kind === 'planet' && (n.rloc >= 250 || used.get(n.i) >= 3))
      .sort((a, b) => used.get(b.i) - used.get(a.i) || b.rloc - a.rloc)
      .slice(0, Math.min(16, Math.max(1, Math.ceil(host.data.nodes().length * 0.2))))
      .map((n, rank) => ({
        text: n.name,
        col: '#dce6f2',
        cls: 'planet-label',
        // Above the star, clear of its disc.
        clear: model.orbit[n.i].size,
        scale: rank < 3 ? 1.5 : rank < 8 ? 1.2 : 1,
        priority: 16 - rank,
        pos: () => model.pos[n.i],
        shown: () => T.pinned !== n.i,
      }));
    removeLabels = T.addLabels(
      [...armLabels, ...planetLabels, ...systemLabels].map(l => ({
        ...l,
        avoidOverlap: true,
        visible: () => (lod.host?.opacity || 0) < 0.5 && (!l.shown || l.shown()),
      })),
    );
  }
  labelGalaxy();

  // ---------- header controls and legend ----------
  host.dom('extra').innerHTML =
    `<button id="trafficBtn" class="on"></button><span id="orbitLabel"></span><input id="speed" type="range" min="0" max="3" step="0.05" value="1" title="Orbit speed" aria-label="Orbit speed">`;
  UIIcons.set(host.dom('trafficBtn'), 'traffic', 'Traffic: on', { pressed: true });
  UIIcons.set(host.dom('orbitLabel'), 'orbit', 'Orbit speed');
  host.dom('legendExtra').innerHTML = `
    <div class="legend3d">
      <div class="lg-h">Layout</div>
      <div>The agent's cannon sits at the centre</div>
      <div>Arms are folders, one colour family each</div>
      <div>Along an arm, groups the rest of the code imports sit nearest the cannon</div>
      <div class="lg-h">Bodies</div>
      <div><i class="ico hole"></i>Black hole — a group of related files</div>
      <div><i class="ico planet"></i>Planet — hub file, many files import it</div>
      <div><i class="ico rock"></i>Asteroid — small file, rarely imported</div>
      <div><i class="ico comet"></i>Comet — mostly imports other groups</div>
      <div class="lg-h">Ships (imports)</div>
      <div><i class="ico ship" style="--c:#8791a8"></i><span id="trafficWhat">Dependency traffic · illustrative static routes</span></div>
      <div><i class="ico ship" style="--c:#ffc93c"></i>Selected file → its imports</div>
      <div><i class="ico ship" style="--c:#39b8ff"></i>Importers → selected file</div>
      <div id="trafficRule" style="color:var(--muted)"></div>
    </div>
`;
  host.dom('trafficBtn').onclick = () => {
    frameState.traffic = !frameState.traffic;
    UIIcons.set(host.dom('trafficBtn'), 'traffic', 'Traffic: ' + (frameState.traffic ? 'on' : 'off'), { pressed: frameState.traffic });
    host.dom('trafficBtn').classList.toggle('on', frameState.traffic);
  };
  host.dom('speed').oninput = e => {
    frameState.speed = +e.target.value;
  };
  function describeTraffic() {
    if (!host.dom('trafficWhat')) return;
    host.dom('trafficWhat').textContent =
      `Dependency traffic · ${ctx.fleet.ambient.routes.length} ships across ${ctx.fleet.ambient.shown} static import lanes`;
    host.dom('trafficRule').textContent =
      `Illustrative traffic, not observed execution. ${ctx.fleet.ambient.unclassified ? `${ctx.fleet.ambient.unclassified} unclassified dependencies are unweighted. ` : ''}Known type-only and re-export lanes carry no ships.`;
  }
  describeTraffic();

  // ---------- context windows: black holes, ships and import lanes (files are handled by app/main.ts) ----------
  const esc = host.windows.context.esc,
    fileRow = j =>
      `<li data-go="${j}" style="color:${host.graph.color(host.graph.groupOf(host.data.nodes()[j]))}">${esc(host.data.nodes()[j].path)}</li>`;
  const wireGo = el =>
    el.querySelectorAll('[data-go]').forEach(li => (li.onclick = () => host.actions.selectFile(+li.dataset.go)));
  T.addPicker({
    objects: () => model.holes.map(h => h.core),
    describe: hit => {
      const h = model.holes.find(x => x.core === hit.object);
      if (!h) return null;
      const files = model.members[h.gi],
        lines = d3.sum(files, n => n.rloc),
        reach = new Map();
      files.forEach(n =>
        host.data.out()[n.i].forEach(t => {
          const g2 = host.graph.groupOf(host.data.nodes()[t]);
          if (g2 !== h.g) reach.set(g2, (reach.get(g2) || 0) + 1);
        }),
      );
      const top = [...reach].sort((a, b) => b[1] - a[1]).slice(0, 6);
      return {
        key: 'hole:' + h.gi,
        kind: 'Black hole · group of files',
        title: h.g,
        color: host.graph.color(h.g),
        preview: [
          `${files.length} files · ${lines.toLocaleString()} lines`,
          `${files.filter(n => model.orbit[n.i].kind === 'planet').length} planets · imports ${reach.size} other groups`,
        ],
        anchor: host.windows.worldAnchor(() => h.center),
        body: el => {
          el.innerHTML = `<h4>Biggest hubs</h4><ul>${files
            .slice(0, 12)
            .map(n => fileRow(n.i))
            .join('')}</ul>${files.length > 12 ? `<div class="note">+ ${files.length - 12} more files</div>` : ''}
          <h4>Imports into other groups</h4><ul>${top.map(([g2, n]) => `<li style="color:${host.graph.color(g2)}">${esc(g2)} <small>${n} import${n === 1 ? '' : 's'}</small></li>`).join('') || '<li class="note">none</li>'}</ul>`;
          wireGo(el);
        },
        actions: [
          {
            label: 'Fly to this system',
            primary: true,
            onClick: () => T.flyTo(h.center.clone(), h.sysR * 2.4, { duration: 1400 }),
          },
        ],
      };
    },
  });
  const SHIP_KIND = {
    ambient: 'background traffic',
    out: 'from the selected file',
    in: 'into the selected file',
    probe: 'debug probe · failing call path',
  };
  function importWindow(a, b, what) {
    const u = host.graph.importUse(a, b),
      mid = () => ctx.fleet.curveFor(a, b).getPoint(0.5);
    return {
      key: `import:${a}:${b}`,
      kind: what,
      title: `${host.data.nodes()[a].name} → ${host.data.nodes()[b].name}`,
      sub: `${host.data.nodes()[a].path} imports ${host.data.nodes()[b].path}`,
      color: '#ffd66b',
      preview: [
        u
          ? {
              runtime: `${u.refs} static value reference${u.refs === 1 ? '' : 's'}`,
              type: 'Type-only import',
              reexport: 'Re-export',
              unknown: 'Static dependency · usage not classified',
            }[u.kind]
          : 'Static import (no symbol index)',
      ],
      anchor: host.windows.worldAnchor(mid),
      body: `<div class="note">Ships illustrate source dependencies. Convoy density is visual; it is not a call count or execution frequency.</div>
        <div class="fact"><span>Importer</span><code>${esc(host.data.nodes()[a].path)}</code></div><div class="fact"><span>Imported</span><code>${esc(host.data.nodes()[b].path)}</code></div>`,
      actions: [
        { label: `Select ${host.data.nodes()[a].name}`, onClick: () => host.actions.selectFile(a) },
        { label: `Select ${host.data.nodes()[b].name}`, onClick: () => host.actions.selectFile(b) },
      ],
    };
  }
  T.addPicker({
    objects: () => [
      ...ctx.fleet.ships.batches.filter(b => b.mesh.visible).map(b => b.mesh),
      ...[...ctx.fleet.ships.heroes.values()].filter(rig => rig.root.visible).map(rig => rig.root),
      ...(ctx.fleet.ships.glow?.visible ? [ctx.fleet.ships.glow] : []),
    ],
    describe: hit => {
      let ancestor = hit.object;
      while (ancestor && !ancestor.userData.route) ancestor = ancestor.parent;
      const r =
        hit.object.userData.fleetBatch?.slots[hit.instanceId] ||
        ancestor?.userData.route ||
        (hit.object === ctx.fleet.ships.glow && ctx.fleet.ships.routes[hit.index]);
      if (!r || typeof r.a !== 'number' || typeof r.b !== 'number') return null;
      const item = importWindow(r.a, r.b, `Ship · ${SHIP_KIND[r.kind] || 'import'}`);
      item.onClick = () => {
        host.windows.context.pin(item);
        ctx.navigation.followShip(r);
      };
      return item;
    },
  });
  T.addPicker({
    objects: () => (ctx.fleet.routeLines.visible ? ctx.fleet.routeLines.children : []),
    describe: hit => {
      const r = ctx.fleet.focusLanes[ctx.fleet.routeLines.children.indexOf(hit.object)];
      return r ? importWindow(r.a, r.b, `Import lane · ${r.kind === 'out' ? 'outgoing' : 'incoming'}`) : null;
    },
  });

  return { refreshTint, labelGalaxy, describeTraffic };
}
