// A creation is a one-shot construction sequence, scoped to the codebase and backed by disk evidence.
// Source bodies grow into their analyzed shape; other files retain typed markers until deleted.
import * as THREE from 'three';
import { glowTex } from '../scene/textures.js';
import { trace } from '../scene/diagnostics.js';
import { isSource } from '../../source-model/languages.js';

let creationCarry = {};
function creationProfile(path, entity = 'file') {
  if (entity === 'directory') return { kind: 'directory', title: 'Directory', color: '#ffd36b', shape: 'portal' };
  const name = path.split('/').pop().toLowerCase(),
    ext = name.split('.').pop();
  if (/(^|[./_-])(test|tests|spec|specs)([./_-]|$)/i.test(path))
    return { kind: 'test', title: 'Test', color: '#a2ffb3', shape: 'shield' };
  if (
    /^(package(-lock)?|tsconfig.*|jsconfig.*|.*config|.*rc)\.(json|js|ts|cjs|mjs)$/.test(name) ||
    /^(dockerfile|makefile|\.gitignore)$/.test(name) ||
    /^(ya?ml|toml|ini|conf|properties)$/.test(ext)
  )
    return { kind: 'config', title: 'Configuration', color: '#ffb95a', shape: 'gear' };
  if (/^(json|csv|tsv|sql|db|sqlite|parquet|xml)$/.test(ext))
    return { kind: 'data', title: 'Data', color: '#79f7ec', shape: 'crystal' };
  if (/^(png|jpe?g|webp|gif|svg|glb|gltf|obj|fbx|blend|mp[34]|wav|ogg|ttf|woff2?)$/.test(ext))
    return { kind: 'asset', title: 'Asset', color: '#d3a8ff', shape: 'tile' };
  if (/^(js|jsx|ts|tsx|mjs|cjs|java|py|go|rs|swift|c|cpp|h|cs|rb|php|html|css|scss|vue|svelte)$/.test(ext))
    return { kind: 'code', title: 'Code', color: '#8cdcff', shape: 'world' };
  if (/^(md|mdx|txt|rst|pdf)$/.test(ext))
    return { kind: 'document', title: 'Document', color: '#f5dec0', shape: 'pages' };
  return { kind: 'file', title: 'File', color: '#d1e3f7', shape: 'world' };
}

export function createCreationEffects(T, codebase, { waitingPaths = new Set(), getNodes }) {
  const records = new Map(),
    total = {},
    u = T.unit,
    scene = T.scene,
    time = () => performance.now() / 1000;
  let stopped = false;
  const hash = text => {
    let n = 2166136261;
    for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    return (n >>> 0) / 4294967296;
  };
  const smooth = k => {
    k = Math.max(0, Math.min(1, k));
    return k * k * (3 - 2 * k);
  };
  const dispose = obj => {
    obj.parent?.remove(obj);
    obj.traverse(o => {
      o.geometry?.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose());
    });
  };
  const mapped = r => (r.entity === 'file' ? T.fileIndex(r.path) : null);
  // A mapped creation shares the drawn body's position exactly, including while its orbit is moving.
  function position(r) {
    const target = placeOf(r),
      now = mapped(r) != null;
    if (r.wasMapped == null) r.wasMapped = now;
    else if (r.wasMapped !== now) {
      r.wasMapped = now;
      trace('creation-handoff', {
        projectId: codebase,
        eventId: r.eventId,
        reason: now ? 'analyzed-body-ready' : 'body-unmapped',
      });
    }
    (r.lastAt ||= new THREE.Vector3()).copy(target);
    return target;
  }
  function placeOf(r) {
    const i = mapped(r);
    if (i != null) return T.bodyPos(i).clone();
    if (r.entity === 'directory') {
      const children = getNodes().filter(n => n.path.startsWith(r.path + '/')).map(n => n.i);
      if (children.length)
        return children.reduce((p, j) => p.add(T.bodyPos(j)), new THREE.Vector3()).multiplyScalar(1 / children.length);
    }
    return new THREE.Vector3().fromArray(r.at);
  }
  function fallback(path, entity) {
    const dir = entity === 'directory' ? path : path.split('/').slice(0, -1).join('/');
    const parent = records.get(dir),
      sibling = getNodes().find(n => dir && n.path.startsWith(dir + '/'));
    const a = hash(dir || path) * Math.PI * 2,
      radius = T.coreRadius * (1.5 + hash((dir || path) + ':radius') * 0.45);
    const p = parent
      ? position(parent)
      : sibling
        ? T.bodyPos(sibling.i).clone()
        : new THREE.Vector3(Math.cos(a) * radius, u * 1.1, Math.sin(a) * radius);
    if (entity === 'file') {
      const t = hash(path) * Math.PI * 2;
      p.add(new THREE.Vector3(Math.cos(t) * u * 2.8, u * 0.8, Math.sin(t) * u * 2.8));
    }
    return p.toArray();
  }
  function visual(r) {
    if (r.root) return;
    const profile = r.profile,
      root = new THREE.Group();
    root.name = 'creation:' + r.path;
    root.userData = { path: r.path, entity: r.entity, profile: profile.kind };
    scene.add(root);
    r.root = root;
    const mat = (opacity = 1, wireframe = false) =>
      new THREE.MeshBasicMaterial({
        color: profile.color,
        transparent: true,
        opacity,
        wireframe,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const seed = new THREE.Mesh(new THREE.OctahedronGeometry(u * 0.38, 0), mat(0.95, true));
    seed.name = 'Creation_Seed';
    scene.add(seed);
    r.seed = seed;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: profile.color,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    root.add(glow);
    r.glow = glow;
    const shape = profile.shape;
    const shield = new THREE.Shape();
    shield.moveTo(-0.8, 0.8);
    shield.lineTo(0.8, 0.8);
    shield.lineTo(0.7, -0.2);
    shield.lineTo(0, -1);
    shield.lineTo(-0.7, -0.2);
    shield.closePath();
    const geometry =
      shape === 'crystal'
        ? new THREE.OctahedronGeometry(1, 0)
        : shape === 'gear'
          ? new THREE.TorusGeometry(0.75, 0.2, 8, 24)
          : ['tile', 'pages'].includes(shape)
            ? new THREE.BoxGeometry(1.4, 1, 0.15)
            : shape === 'shield'
              ? new THREE.ExtrudeGeometry(shield, { depth: 0.2, bevelEnabled: false })
              : new THREE.IcosahedronGeometry(1, 2);
    const body = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: profile.color,
        emissive: profile.color,
        emissiveIntensity: 0.35,
        roughness: 0.6,
        metalness: 0.2,
        transparent: true,
      }),
    );
    body.name = 'Creation_' + shape;
    root.add(body);
    r.body = body;
    r.pages =
      shape === 'pages'
        ? Array.from({ length: 3 }, (_, j) => {
            const page = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.95, 0.06), body.material.clone());
            page.position.z = -0.15 - j * 0.12;
            body.add(page);
            return page;
          })
        : [];
    if (shape === 'portal') body.visible = false;
    r.rings = Array.from({ length: shape === 'portal' ? 3 : 2 }, (_, j) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1 + j * 0.2, 0.025, 5, 64), mat(0.85));
      ring.rotation.set((shape === 'portal' ? 0 : Math.PI / 2) + (j === 1 ? 0.9 : 0), j * 0.8, j * 0.55);
      root.add(ring);
      return ring;
    });
    r.shards = Array.from({ length: 12 }, (_, j) => {
      const shard = new THREE.Mesh(
        shape === 'crystal' ? new THREE.OctahedronGeometry(0.16, 0) : new THREE.BoxGeometry(0.24, 0.1, 0.18),
        mat(0.9),
      );
      shard.userData.angle = (j * Math.PI * 2) / 12;
      root.add(shard);
      return shard;
    });
    const points = new Float32Array(36 * 3),
      geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const sparks = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: profile.color,
        size: u * 0.12,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    root.add(sparks);
    r.sparks = sparks;
    r.label = {
      text: `${r.preview ? 'Preview' : 'Created'} ${profile.title.toLowerCase()} · ${r.path.replace('__creation_preview__/', '')}`,
      col: profile.color,
      cls: 'hot',
      pos: () => position(r).add(new THREE.Vector3(0, r.radius * 2.2, 0)),
    };
    r.removeLabel = T.addLabels([r.label]);
    root.visible = false;
  }
  function reserve(ev) {
    const path = ev.path || ev.files?.[0];
    if (!path || records.has(path)) return records.get(path) || null;
    const entity = ev.entity || 'file',
      profile = creationProfile(path, entity);
    const r = {
      path,
      eventId: ev.id,
      entity,
      profile,
      at: fallback(path, entity),
      createdAt: time(),
      phase: 'queued',
      radius: u * (entity === 'directory' ? 2 : 0.75),
      bytes: ev.bytes ?? null,
      preview: !!ev.preview,
      waitForBody: entity === 'file' && !ev.preview && isSource(path),
      // A source file becomes a body once the analysis catches up; until then its placeholder stays formed.
      hold: entity === 'file' && !ev.preview,
    };
    records.set(path, r);
    trace('creation-reserved', {
      projectId: codebase,
      eventId: r.eventId,
      kind: profile.kind,
      reason: mapped(r) == null ? 'awaiting-body' : 'body-ready',
    });
    total[profile.kind] = (total[profile.kind] || 0) + 1;
    return r;
  }
  function launch(r, round) {
    if (!r || records.get(r.path) !== r || r.phase !== 'queued') return;
    r.from = round.from.toArray();
    r.flightAt = round.t0;
    r.duration = round.dur;
    r.arc = round.st.arc;
    r.phase = 'seed';
    visual(r);
  }
  function form(r) {
    if (!r || records.get(r.path) !== r || r.phase === 'forming' || r.phase === 'settled') return;
    r.phase = 'forming';
    r.formedAt = time();
    visual(r);
    r.seed.visible = false;
  }
  function drop(r, reason = 'formation-complete') {
    const i = mapped(r);
    if (i != null) T.setBodyBirth?.(i, 1);
    r.removeLabel?.();
    if (r.root) dispose(r.root);
    if (r.seed) dispose(r.seed);
    records.delete(r.path);
    trace('creation-released', { projectId: codebase, eventId: r.eventId, kind: r.profile.kind, reason });
  }
  function forget(path) {
    for (const r of [...records.values()]) if (r.path === path || r.path.startsWith(path + '/')) drop(r, 'deleted');
  }
  function snapshot(r) {
    const {
      path,
      entity,
      profile,
      at,
      createdAt,
      radius,
      bytes,
      from,
      flightAt,
      duration,
      arc,
      phase,
      formedAt,
      claimed,
      eventId,
      hold,
      preview,
      waitForBody,
    } = r;
    return {
      path,
      entity,
      profile,
      at,
      createdAt,
      radius,
      bytes,
      from,
      flightAt,
      duration,
      arc,
      phase,
      formedAt,
      claimed,
      eventId,
      hold,
      preview,
      waitForBody,
    };
  }
  // A fast file-map rebuild must not swallow an in-flight creation or replay a finished one.
  for (const saved of creationCarry[codebase] || []) {
    if (!saved.hold && !waitingPaths.has(saved.path) && time() - (saved.formedAt || saved.createdAt) > 7) continue;
    const r = { ...saved };
    records.set(r.path, r);
    total[r.profile.kind] = (total[r.profile.kind] || 0) + 1;
    if (r.phase === 'queued' && waitingPaths.has(r.path)) continue;
    if (r.phase === 'queued') {
      r.phase = 'seed';
      r.from ||= [0, u * 2, 0];
      r.flightAt = time();
      r.duration = 0.7;
      r.arc = 0.4;
    }
    visual(r);
    const i = mapped(r);
    if (i != null) T.setBodyBirth?.(i, 0.001);
  }
  T.onFrame.push(() => {
    if (stopped) return;
    const t = time();
    for (const r of [...records.values()]) {
      if (r.phase === 'queued') {
        const i = mapped(r);
        if (i != null) T.setBodyBirth?.(i, 0.001);
        continue;
      }
      const at = position(r),
        i = mapped(r);
      r.radius = i != null ? T.bodySize(i) : r.radius;
      if (r.phase === 'seed') {
        const k = Math.min(1, (t - r.flightAt) / r.duration),
          from = new THREE.Vector3().fromArray(r.from),
          mid = from.clone().add(at).multiplyScalar(0.5);
        mid.y += from.distanceTo(at) * r.arc + (r.arc > 0.3 ? 2 * u : 0);
        r.seed.position
          .copy(from)
          .multiplyScalar((1 - k) ** 2)
          .addScaledVector(mid, 2 * (1 - k) * k)
          .addScaledVector(at, k * k);
        r.seed.rotation.set(t * 3, t * 4, 0);
        if (i != null) T.setBodyBirth?.(i, 0.001);
        if (k < 1) continue;
        form(r);
      }
      if (r.hold && i == null && t - r.formedAt > 1.7) {
        r.formedAt = t - 1.7; // fully formed, not fading, until its body exists
      }
      const age = t - r.formedAt,
        grow = smooth(age / 1.7),
        fade = 1 - smooth((age - 3.8) / 1.5);
      if (age >= 5.3) {
        drop(r);
        continue;
      }
      r.phase = grow >= 1 ? 'settled' : 'forming';
      r.root.visible = true;
      r.root.position.copy(at);
      if (i != null) T.setBodyBirth?.(i, Math.max(0.001, grow));
      const overlay = i != null && !['code', 'file'].includes(r.profile.kind);
      r.body.visible = (i == null || overlay) && r.profile.shape !== 'portal';
      r.body.scale.setScalar(Math.max(0.001, grow) * r.radius * (overlay ? 1.6 : 1));
      r.body.material.wireframe = overlay;
      if (r.profile.shape === 'crystal') r.body.scale.y *= 1.5;
      r.body.rotation.y = r.profile.shape === 'tile' ? -0.3 : t * 0.18;
      r.body.material.opacity = fade * (overlay ? 0.5 : 1);
      if (r.profile.shape === 'gear') r.body.rotation.z = age * 0.7;
      r.pages.forEach((page, j) => {
        page.rotation.y = (1 - grow) * (j + 1) * 0.5;
        page.material.opacity = fade;
      });
      r.glow.scale.setScalar(r.radius * (3.5 + 4 * (1 - grow)));
      r.glow.material.opacity = 0.45 * (1 - grow * 0.8) * fade;
      r.rings.forEach((ring, j) => {
        ring.scale.setScalar(r.radius * (1.2 + (1 - grow) * (2 + j)));
        ring.rotation.z = j * 0.55 + age * 0.25 * (j % 2 ? -1 : 1);
        ring.material.opacity = 0.5 * fade * (r.entity === 'directory' ? 1 : 1 - smooth((age - 2) / 1.5));
      });
      r.shards.forEach((shard, j) => {
        const a = shard.userData.angle + age * (1 - grow) * 1.6,
          distance = r.radius * (1.1 + (1 - grow) * 3.6);
        shard.position.set(Math.cos(a) * distance, Math.sin(a * 2 + j) * r.radius * (1 - grow), Math.sin(a) * distance);
        shard.rotation.set(age, a, age * 0.7);
        shard.material.opacity = (r.entity === 'directory' || r.profile.kind === 'config' ? 0.9 : 1 - grow) * fade;
        if (r.profile.kind === 'asset') {
          shard.position.lerp(
            new THREE.Vector3(
              ((j % 4) - 1.5) * 0.35 * r.radius,
              (Math.floor(j / 4) - 1) * 0.35 * r.radius,
              0.18 * r.radius,
            ),
            grow,
          );
          shard.rotation.set(0, 0, 0);
          shard.material.opacity = fade;
        } else if (r.profile.kind === 'config') {
          shard.position.set(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 0);
          shard.rotation.set(0, 0, a);
        }
      });
      const attr = r.sparks.geometry.attributes.position;
      for (let j = 0; j < attr.count; j++) {
        const a = j * 2.39996,
          z = 1 - (2 * (j + 0.5)) / attr.count,
          rad = r.radius * (1.2 + Math.min(1, age) * 3.5),
          xy = Math.sqrt(1 - z * z);
        attr.setXYZ(j, Math.cos(a) * xy * rad, z * rad, Math.sin(a) * xy * rad);
      }
      attr.needsUpdate = true;
      r.sparks.geometry.computeBoundingSphere();
      r.sparks.material.opacity = Math.max(0, 1 - age / 1.7) * fade;
    }
  });
  return {
    reserve,
    readiness: r => (records.get(r.path) !== r ? 'deleted' : r.waitForBody && mapped(r) == null ? 'waiting' : 'ready'),
    launch,
    form,
    forget,
    target: r => () => position(r),
    stats: () => ({
      total: { ...total },
      active: [...records.values()].map(r => ({
        path: r.path,
        eventId: r.eventId,
        entity: r.entity,
        profile: r.profile.kind,
        phase: r.phase,
        position: position(r).toArray(),
        mapped: mapped(r) != null,
        waitingForBody: !!r.waitForBody && mapped(r) == null,
        preview: !!r.preview,
      })),
    }),
    stop: () => {
      stopped = true;
      creationCarry[codebase] = [...records.values()].filter(r => !r.preview).map(snapshot);
      for (const r of [...records.values()]) drop(r, 'view-rebuild');
    },
  };
}
