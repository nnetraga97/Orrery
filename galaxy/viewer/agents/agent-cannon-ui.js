// Owns status and hit labels, preview controls, camera following, picking and history.
import * as THREE from 'three';
import { CONTEXT_CATEGORIES } from './context-state.js';
import { UIIcons } from '../shared/ui-icons.js';

export function createCannonLabels(ctx) {
  const { v2, core, T, now, v1, u } = ctx.shared;
  // ---------- status label above the cannon ----------
  const status = { text: 'Agent', mode: 'idle', until: 0, context: '' };
  const label = { text: 'Agent', col: '#cfe6ff', pos: () => v2.set(0, core * 0.95, 0) };
  const removeLabel = T.addLabels(
    [label],
    undefined,
    () => !ctx.world.contextDistrict.state.ready || now() < status.until,
  );
  const say = (text, secs = 3, mode = null) => {
    if (!text) return;
    status.text = text;
    status.until = now() + secs;
    if (mode) status.mode = mode;
  };

  // ---------- hit labels: "types.ts +12 −3" floating over the planet for a few seconds ----------
  const hitLabels = [];
  function hitLabel(target, text, col) {
    if (!text.trim()) return;
    if (hitLabels.length >= 5) hitLabels.shift().remove();
    const def = { text, col, cls: 'hot', pos: () => v2.copy(target()).add(v1.set(0, 2.2 * u, 0)) };
    const remove = T.addLabels([def]),
      item = { remove, until: now() + 3.5 };
    hitLabels.push(item);
  }

  return { status, label, removeLabel, say, hitLabels, hitLabel };
}

export function createCannonUI(ctx) {
  const { T, now, u, carry, host, stats, core, v2 } = ctx.shared;
  const { state } = ctx;
  const { status, label, say, hitLabels } = ctx.ui;
  // ---------- follow camera: swing to each hit; backs off for a while after the user moves the camera ----------
  const follow = {
    on: true,
    last: carry?.follow?.last ?? -10,
    userAt: carry?.follow?.userAt ?? -10,
    rev: T.navigationRevision,
    home: false,
  };
  follow.on = host.preferences.recall('galaxyFollow') === 'on';
  const extra = document.getElementById('extra');
  if (extra) {
    const row = document.createElement('div');
    row.className = 'row';
    // Off by default: the camera stays where the user put it while the agent works.
    const toggle = document.createElement('label');
    toggle.className = 'follow-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'followAgent';
    box.checked = follow.on;
    toggle.append(box, 'Camera follows agent shots');
    row.appendChild(toggle);
    extra.prepend(row);
    box.onchange = () => {
      follow.on = box.checked;
      host.preferences.remember('galaxyFollow', follow.on ? 'on' : 'off');
    };
    state.previewButton = document.createElement('button');
    UIIcons.set(state.previewButton, 'cannon', 'Preview cannon');
    state.previewButton.title = 'Preview cannon · Play the local rig animation';
    state.previewButton.disabled = !ctx.world.rig.state.ready;
    state.previewButton.onclick = () => {
      if (ctx.world.rig.preview()) say('Local rig preview', 3, 'preview');
    };
    row.appendChild(state.previewButton);
    const choice = document.createElement('select');
    choice.id = 'creationPreviewType';
    choice.setAttribute('aria-label', 'Creation preview type');
    for (const [value, title] of [
      ['directory', 'Directory'],
      ['code', 'Code'],
      ['test', 'Test'],
      ['config', 'Config'],
      ['data', 'Data'],
      ['asset', 'Asset'],
      ['document', 'Document'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = title;
      choice.appendChild(option);
    }
    const creationButton = document.createElement('button');
    creationButton.id = 'previewCreation';
    UIIcons.set(creationButton, 'sparkles', 'Preview creation');
    creationButton.title = 'Preview creation · Local animation; no files are written and no provider is called';
    creationButton.onclick = () => ctx.shots.previewCreation(choice.value);
    row.append(choice, creationButton);
    follow.button = row;
  }
  function focusOn(i) {
    const t = now();
    if (
      ctx.jobs?.following() ||
      !follow.on ||
      i == null ||
      T.landedDetail?.() ||
      t - follow.userAt < 8 ||
      t - follow.last < 1.4
    )
      return;
    follow.last = t;
    follow.home = true;
    T.flyTo(new THREE.Vector3(), T.bodySize(i) * 14 + 8 * u, { frame: T.bodyFrame(i), duration: 1100 });
  }
  function goHome() {
    if (ctx.jobs?.following() || !follow.on || !follow.home || T.landedDetail?.() || now() - follow.userAt < 8) return;
    follow.home = false;
    const home = T.overview();
    T.flyTo(home.target, 0, { cam: home.position, duration: 1600 });
  }
  function frameWorkspace() {
    if (T.navigationRevision !== follow.rev) {
      follow.rev = T.navigationRevision;
      follow.userAt = now();
    }
    if (ctx.jobs?.following() || !follow.on || T.landedDetail?.() || now() - follow.userAt < 8) return false;
    const home = T.overview();
    T.flyTo(home.target, 0, { cam: home.position, duration: 1100 });
    return true;
  }

  // ---------- context windows: the cannon, drones, the satellite station and the terminal moon ----------
  const recent = [],
    lastBy = { station: null, mortar: null };
  function remember(ev) {
    const text =
      ev.kind === 'fire'
        ? ev.label
        : ev.kind === 'file-change'
          ? `${ev.files[0]}${ev.added != null ? ` +${ev.added} −${ev.removed}` : ''}`
          : ev.kind === 'prompt'
            ? `› ${ev.text}`
            : ev.kind === 'resolve' && !ev.ok
              ? `✗ ${ev.tool} failed`
              : null;
    if (text) {
      recent.unshift({ text, agent: ev.agent, t: Date.now() });
      recent.length = Math.min(recent.length, 14);
    }
    if (ev.kind === 'fire' && (ev.ammo === 'station' || ev.ammo === 'mortar'))
      lastBy[ev.ammo] = { label: ev.label, command: ev.command, t: Date.now() };
    if (ev.kind === 'resolve' && (ev.action === 'command' || ev.ammo === 'mortar') && lastBy.mortar)
      Object.assign(lastBy.mortar, { output: ev.output, ok: ev.ok });
  }
  const ago = t => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
  };
  const escH = host.windows.context.esc;
  const inside = (hit, obj) => {
    for (let o = hit.object; o; o = o.parent) if (o === obj) return true;
    return false;
  };
  function focusObject(object, target = null, minimumRadius = ctx.world.S) {
    const box = new THREE.Box3().setFromObject(object),
      boundsCenter = box.getCenter(new THREE.Vector3()),
      center = target || boundsCenter;
    const radius = Math.max(
      box.getSize(new THREE.Vector3()).length() * 0.5 + center.distanceTo(boundsCenter),
      minimumRadius,
    );
    // Fit its full silhouette to the tighter field of view, including narrow VS Code panels.
    const vertical = THREE.MathUtils.degToRad(T.camera.fov) * 0.5;
    const halfFov = Math.min(vertical, Math.atan(Math.tan(vertical) * T.camera.aspect));
    const distance = (radius / Math.sin(halfFov)) * 1.2;
    host.actions.selectFile(null, { fly: false });
    host.windows.context.close();
    host.windows.context.hover(null);
    T.interruptNavigation();
    follow.userAt = now();
    follow.home = false;
    clearTimeout(state.homeTimer);
    T.flyTo(center, distance, { duration: 1000 });
  }
  const removePicker = T.addPicker?.({
    objects: () => [
      ctx.world.base,
      ctx.world.station,
      ctx.world.moon,
      ...ctx.world.island.pickables,
      ...ctx.world.contextDistrict.pickables,
      ...[...ctx.world.drones.values()].map(d => d.obj),
    ],
    describe: (hit, ray) => {
      const category = ctx.world.contextDistrict.buildingAt(hit);
      if (category) {
        const definition = CONTEXT_CATEGORIES.find(c => c.id === category);
        return {
          key: 'context:' + category,
          kind: category === 'standby' ? 'Context district · outside occupied context' : 'Context district',
          title: definition?.name || 'Context energy ring',
          preview: [definition?.meaning || 'Aggregate provider usage · category allocation unavailable'],
          anchor: host.windows.worldAnchor(() => ctx.world.contextDistrict.target(category)),
          body: el => {
            el.innerHTML = ctx.world.contextDistrict.details(category);
          },
          actions: [
            { label: 'View context district', primary: true, onClick: () => focusObject(ctx.world.contextDistrict.group) },
            ...(definition
              ? [
                  {
                    label: 'Preview mechanism',
                    title: 'Mechanical preview only; does not imply a context change',
                    onClick: () => ctx.world.contextDistrict.preview(category),
                  },
                ]
              : []),
          ],
        };
      }
      if (hit.object.userData.islandLot) {
        const lot = ctx.world.island.buildingAt(hit, ray);
        if (!lot) return null;
        const tier = lot.tier === 'terrace' ? 'Middle terrace' : 'Lower promenade';
        const spec = {
          key: 'island:' + lot.id,
          kind: 'Island building · ' + tier,
          title: lot.title,
          color: '#a8e5ff',
          preview: [tier],
          anchor: host.windows.worldAnchor(() => lot.object.localToWorld(new THREE.Vector3(0, lot.height * 0.65, 0))),
          body: '<p>Part of the island town surrounding the cannon. Explore the building up close or return to the whole island.</p>',
          onClose: () => ctx.world.island.selectBuilding(null),
          actions: [
            { label: 'Focus building', primary: true, onClick: () => focusObject(lot.object, null, ctx.world.S * 0.08) },
            { label: 'View island', onClick: () => focusObject(ctx.world.island.group, new THREE.Vector3(0, core * 0.1, 0)) },
          ],
        };
        spec.onClick = () => {
          host.windows.context.pin(spec);
          ctx.world.island.selectBuilding(lot.id);
        };
        return spec;
      }
      const drone = [...ctx.world.drones.entries()].find(([, d]) => inside(hit, d.obj));
      if (drone) {
        const [id, d] = drone;
        return {
          key: 'drone:' + id,
          kind: 'Drone · subagent',
          title: d.text || 'Subagent',
          color: d.col,
          preview: [d.state === 'dock' ? `returning to dock · ${d.activity}` : 'working · fires in its own colour'],
          anchor: host.windows.worldAnchor(() => d.obj.position),
          body: `<ul>${
            recent
              .filter(r => r.agent === id)
              .map(r => `<li>${escH(r.text)} <small>${ago(r.t)}</small></li>`)
              .join('') || '<li class="note">No actions yet</li>'
          }</ul>`,
        };
      }
      if (inside(hit, ctx.world.station)) {
        const l = lastBy.station;
        return {
          key: 'station',
          kind: 'Satellite station · MCP and other tools',
          title: l?.label || 'No tool calls yet',
          color: '#c7b8ff',
          preview: [l ? ago(l.t) : 'Browser, MCP and other tools are fired here'],
          anchor: host.windows.worldAnchor(ctx.world.stationTarget),
          body: ctx.world.stationRig.state.error
            ? `<p>${escH(ctx.world.stationRig.state.error)}</p>`
            : '<p>The dish scans for tool traffic and turns toward the cannon when a tool call arrives.</p>',
          actions: [
            { label: 'Focus station', onClick: () => focusObject(ctx.world.station) },
            { label: 'Preview receiving', disabled: !ctx.world.stationRig.state.ready, onClick: () => ctx.world.stationRig.preview() },
            {
              label: 'Move solar panels',
              disabled: !ctx.world.stationRig.state.ready,
              onClick: () => ctx.world.stationRig.preview('Solar panels'),
            },
          ],
        };
      }
      if (inside(hit, ctx.world.moon)) {
        const l = lastBy.mortar;
        return {
          key: 'moon',
          kind: 'Terminal moon · commands',
          title: l?.label || 'No commands yet',
          color: '#b7ff6b',
          preview: [
            l ? `${ago(l.t)}${l.ok === false ? ' · failed' : ''}` : 'Shell commands without a file target land here',
          ],
          anchor: host.windows.worldAnchor(ctx.world.moonTarget),
          body: l
            ? `${l.command ? `<pre>${escH(l.command)}</pre>` : ''}${l.output ? `<h4>Output</h4><pre>${escH(l.output)}</pre>` : ''}`
            : '<p>The sensor watches for commands. The terminal opens while a command is running.</p>',
          actions: [
            { label: 'Focus moon', onClick: () => focusObject(ctx.world.moon) },
            { label: 'Preview command cycle', disabled: !ctx.world.moonRig.state.ready, onClick: () => ctx.world.moonRig.preview() },
            {
              label: 'Open service hatch',
              disabled: !ctx.world.moonRig.state.ready,
              onClick: () => ctx.world.moonRig.preview('Service hatch'),
            },
          ],
        };
      }
      if (inside(hit, ctx.world.base))
        return {
          key: 'cannon',
          kind: `${state.agentName} · cannon`,
          title: status.text || state.agentName,
          color: '#7cc4ff',
          preview: [
            status.context || 'Context unknown',
            `${stats.impacts} hits · ${stats.misfires} misfires · ${ctx.world.drones.size} drone${ctx.world.drones.size === 1 ? '' : 's'} out`,
          ],
          anchor: host.windows.worldAnchor(() => v2.set(0, ctx.world.S * 1.2, 0).clone()),
          actions: [
            { label: 'Focus cannon', onClick: () => focusObject(ctx.world.base) },
            {
              label: ctx.shots.randomFire.on ? 'Stop random fire' : 'Fire at random planets',
              title: 'Local preview · shoots at random planets; no files are touched and no provider is called',
              onClick: button => {
                button.textContent = ctx.shots.setRandomFire(!ctx.shots.randomFire.on) ? 'Stop random fire' : 'Fire at random planets';
              },
            },
          ],
          body: `<h4>Recent actions</h4><ul>${recent.map(r => `<li>${escH(r.text)} <small>${ago(r.t)}</small></li>`).join('') || '<li class="note">Waiting for agent activity…</li>'}</ul>
        <div class="note">Hit files warm quickly and cool over several minutes.</div>`,
        };
      return null;
    },
  });
  function step(t) {
    if (T.navigationRevision !== follow.rev) {
      follow.rev = T.navigationRevision;
      follow.userAt = t;
    }
    for (let q = hitLabels.length - 1; q >= 0; q--)
      if (t > hitLabels[q].until) {
        hitLabels[q].remove();
        hitLabels.splice(q, 1);
      }
  }

  function stepStatus(t) {
    if (t > status.until && status.mode !== 'idle') {
      status.mode = ctx.rounds.rounds.length || ctx.shots.pendingFire.length ? 'firing' : 'idle';
    }
    label.text =
      t < status.until
        ? `${state.agentName} · ${status.text}`
        : `${state.agentName}${status.context ? ' · ' + status.context : ''}`;
  }

  return { focusOn, remember, goHome, removePicker, follow, recent, frameWorkspace, focusObject, step, stepStatus };
}
