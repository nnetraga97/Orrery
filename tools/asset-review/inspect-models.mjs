#!/usr/bin/env node
// Lists what each model holds: triangles, draw primitives, materials, textures, distant meshes (extras.lod),
// moving parts (extras.motion), named backing/cap pieces, skins and animation clips with what each channel moves.
// Usage: node tools/asset-review/inspect-models.mjs <path to .glb> ...   (e.g. public/assets/buildings/*/*.glb)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of process.argv.slice(2)) {
  const root = (await io.read(file)).getRoot();
  let tris = 0, prims = 0;
  for (const node of root.listNodes()) {
    for (const p of node.getMesh()?.listPrimitives() ?? []) {
      tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
      prims++;
    }
  }
  const textures = root.listTextures().map(t => (t.getSize() ?? ['?', '?']).join('x'));
  const lod = root.listNodes().filter(n => n.getExtras()?.lod).map(n => n.getName());
  const motion = root.listNodes().filter(n => n.getExtras()?.motion && n.getExtras().motion !== 'static').map(n => `${n.getName()}=${n.getExtras().motion}`);
  const backing = root.listNodes().map(n => n.getName()).filter(n => /backing|cap/i.test(n));
  const clips = root.listAnimations().map(a => {
    const channels = a.listChannels().map(c => {
      const values = c.getSampler().getOutput().getArray();
      let lo = Infinity, hi = -Infinity;
      for (const v of values) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
      return `${c.getTargetNode()?.getName()}.${c.getTargetPath()} range ${(hi - lo).toFixed(2)}`;
    });
    return `${a.getName()} [${channels.join(', ')}]`;
  });
  console.log(
    [
      file,
      `${Math.round(tris)} tris, ${prims} prims, ${root.listMaterials().length} materials, textures ${[...new Set(textures)].join(' ') || '-'}`,
      `lod: ${lod.join(' ') || '-'}`,
      `motion: ${motion.join(' ') || '-'}`,
      `backing/cap: ${backing.join(' ') || '-'}`,
      `skins: ${root.listSkins().length}`,
      `clips: ${clips.join(' ; ') || '-'}`,
    ].join('\n  '),
  );
}
