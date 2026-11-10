// Raycaster itself does not exclude invisible objects or children of hidden groups.
export function intersectVisible(ray, objects) {
  const targets = [];
  for (const root of objects) {
    if (!root) continue;
    let visible = true;
    for (let p = root.parent; p; p = p.parent) if (!p.visible) visible = false;
    if (visible)
      root.traverseVisible(o => {
        if (o.raycast) targets.push(o);
      });
  }
  return ray.intersectObjects(targets, false);
}

export function pickScene(ray, files, mapFile, pickers) {
  const hits = intersectVisible(ray, files || []).map(hit => ({ hit, picker: null }));
  for (const picker of pickers) {
    for (const hit of intersectVisible(ray, picker.objects())) hits.push({ hit, picker });
  }
  hits.sort((a, b) => a.hit.distance - b.hit.distance);
  for (const { hit, picker } of hits) {
    if (picker) {
      const item = picker.describe(hit, ray);
      if (item) return { id: -1, item };
    } else {
      const id = mapFile?.(hit) ?? -1;
      if (id >= 0) return { id, item: null };
    }
  }
  return { id: -1, item: null };
}
