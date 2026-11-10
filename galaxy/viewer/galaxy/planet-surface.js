// CPU-only surface construction for orbital library bodies.
import * as THREE from 'three';

// The relief field of a height map (128×64 for orbit, finer for landing): radius (before normalization) at a texture
// coordinate. All orbital geometry tiers share the same normalized radius.
export function reliefField(entry, heights, [width, height] = [128, 64]) {
  const data = new DataView(heights);
  if (heights.byteLength !== width * height * 2) throw new Error('Invalid planet height field: ' + entry.id);
  const sample = (x, y) =>
    data.getUint16((Math.max(0, Math.min(height - 1, y)) * width + (((x % width) + width) % width)) * 2, true) / 65535;
  const pole = y => Array.from({ length: width }, (_, x) => sample(x, y)).reduce((a, b) => a + b) / width;
  const north = pole(0),
    south = pole(height - 1);
  let peak = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) peak = Math.max(peak, sample(x, y));
  const radius = (u, v) => {
    const x = u * width - 0.5,
      y = (1 - v) * height - 0.5;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    let h = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(sample(ix, iy), sample(ix + 1, iy), fx),
      THREE.MathUtils.lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), fx),
      fy,
    );
    if (v > 0.99999) h = north;
    if (v < 0.00001) h = south;
    return 1 + (h - 0.5) * entry.relief * 2;
  };
  return { radius, peak: 1 + (peak - 0.5) * entry.relief * 2 };
}
// SphereGeometry's texture coordinate for a unit direction (x = -cos φ sin θ, y = cos θ, z = sin φ sin θ).
export const sphereUV = d => [
  (Math.atan2(d.z, -d.x) / (2 * Math.PI) + 1) % 1,
  1 - Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI,
];

export function planetSurfaceGeometry(entry, heights, widthSegments = 64, heightSegments = 40, { size, peak } = {}) {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  let field = null;
  if (heights) {
    field = reliefField(entry, heights, size);
    if (peak) field.peak = peak;
    const p = geo.attributes.position,
      uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const r = field.radius(uv.getX(i), uv.getY(i));
      p.setXYZ(i, p.getX(i) * r, p.getY(i) * r, p.getZ(i) * r);
    }
    geo.computeVertexNormals();
    // UV seams duplicate vertices. Share their normals without destroying UVs.
    const seams = new Map(),
      normals = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
      if (!seams.has(key)) seams.set(key, []);
      seams.get(key).push(i);
    }
    for (const indices of seams.values()) {
      if (indices.length < 2) continue;
      const n = new THREE.Vector3();
      for (const i of indices) n.add(new THREE.Vector3().fromBufferAttribute(normals, i));
      n.normalize();
      for (const i of indices) normals.setXYZ(i, n.x, n.y, n.z);
    }
  }
  // Some source mosaics have no data near a pole. `polarFill` gives the image-row fractions
  // [north, south] where valid data begins and ends; texture beyond them is mirrored back
  // across that latitude. Relief above was sampled at the true latitude.
  if (entry.polarFill) {
    const [north, south] = entry.polarFill,
      uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      let row = 1 - uv.getY(i);
      if (row < north) row = 2 * north - row;
      else if (row > south) row = 2 * south - row;
      uv.setY(i, 1 - THREE.MathUtils.clamp(row, 0, 1));
    }
  }
  // Radius is the constellation's transport, camera, selection and landing contract. Relief is normalized by the
  // field's peak, not the tessellation's, so every level of detail draws the same surface.
  const radius = field ? field.peak : 1;
  geo.scale(1 / radius, 1 / radius, 1 / radius);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return geo;
}
