// Files with planets drawn as stars: one instanced batch of star surfaces and one of their glow, two draw calls for
// every star in the galaxy. Each star is tinted from its folder's colour; picking uses the surface batch, whose
// userData.fileIds maps an instance to its file (as the asteroid and planet batches do).
//
// A star's surface is a camera-facing square that ray-traces its sphere, so its edge stays round at any distance for
// two triangles. The surface is a photosphere: granulation cells, a slow mottling, a few dark spots and limb darkening,
// coloured from a deep shade of the folder's colour up to a warm white that stays below full brightness. The glow is a
// back-facing shell, so the star's own surface hides it across the disc and it shows only around the edge.
import * as THREE from 'three';

/** The glow shell's radius, as a multiple of the star's. */
const GLOW = 1.8;

// Vertex: places the square at the star's centre, facing the camera, just large enough to hold its silhouette, and
// hands the fragment the star's centre and radius in view space and its axes (to keep the pattern fixed to the star).
const SURFACE_VERT = `
  varying vec3 vC, vPos, vCenter, vAx, vAy, vAz;
  varying float vR, vSeed;
  void main(){
    vC = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vC = instanceColor;
    #endif
    mat4 m = modelViewMatrix * instanceMatrix;
    vec4 c = m * vec4(0.0, 0.0, 0.0, 1.0);
    mat3 r = mat3(m);
    float rad = length(r[0]);
    vAx = r[0] / rad; vAy = r[1] / rad; vAz = r[2] / rad;
    float d = length(c.xyz);
    // A sphere seen from distance d covers a disc a little wider than its radius in the plane through its centre.
    float span = rad * min(d / sqrt(max(d * d - rad * rad, 1e-6)), 4.0) * 1.12;
    vec3 p = c.xyz + vec3(position.xy * span, 0.0);
    vCenter = c.xyz; vR = rad; vPos = p;
    vSeed = float(gl_InstanceID);
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }`;

const SURFACE_FRAG = `
  uniform float uTime;
  varying vec3 vC, vPos, vCenter, vAx, vAy, vAz;
  varying float vR, vSeed;
  vec3 h3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453); }
  float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
  // Granulation: the gap between the nearest two cell centres, bright in a cell's middle and dark in the lanes
  // between cells. The centres drift slowly so the surface boils.
  float cells(vec3 p, float t){
    vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
      vec3 o = vec3(float(x), float(y), float(z)); vec3 r = h3(i + o);
      vec3 q = o + 0.5 + 0.38 * sin(t + 6.2831 * r) - f; float d = dot(q, q);
      if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return sqrt(d2) - sqrt(d1);
  }
  void main(){
    // Ray from the eye (the view-space origin) through this pixel, against the star's sphere.
    vec3 dir = normalize(vPos);
    float b = dot(dir, vCenter);
    float disc = b * b - dot(vCenter, vCenter) + vR * vR;
    float cover = clamp(disc / max(fwidth(disc), 1e-9), 0.0, 1.0);
    if (cover <= 0.0) discard;
    vec3 hit = dir * (b - sqrt(max(disc, 0.0)));
    vec3 nv = (hit - vCenter) / vR;
    float mu = clamp(dot(nv, -dir), 0.0, 1.0);
    // The point on the star's own sphere, turning slowly about its axis; each star starts at its own longitude.
    vec3 n = vec3(dot(nv, vAx), dot(nv, vAy), dot(nv, vAz));
    float a = uTime * 0.015 + vSeed * 2.399;
    n.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * n.xz;
    vec3 o = vec3(vSeed * 3.1, vSeed * 1.7, 0.0);

    // How many granules fit across a pixel decides how much of the fine pattern survives (none, from far away).
    float fw = length(fwidth(n));
    vec3 w = n * 22.0 + o;
    w += 0.6 * vec3(vnoise(w * 0.35), vnoise(w * 0.35 + 9.1), vnoise(w * 0.35 + 4.7));
    float g = cells(w, uTime * 0.3);
    float fine = clamp(2.0 - fw * 88.0, 0.0, 1.0);
    float gran = mix(0.7, smoothstep(0.0, 0.32, g) * (0.75 + 0.25 * vnoise(w * 2.3)), fine);
    float mott = fbm(n * 3.0 + o + vec3(0.0, uTime * 0.01, 0.0));
    float spotField = fbm(n * 1.6 + o.yxz * 0.7);
    float umbra = smoothstep(0.76, 0.79, spotField), penumbra = smoothstep(0.71, 0.77, spotField);
    float L = (0.78 + 0.22 * gran) * (0.5 + 0.8 * mott);
    L *= 1.0 - 0.4 * penumbra - 0.5 * umbra;
    // Limb darkening: the edge of the disc shows cooler, higher gas.
    float limb = 0.3 + 0.7 * pow(mu, 0.5);
    L *= limb;

    // A hot ramp in the folder's hue: deep and reddened in spots and at the limb, the hue itself in the middle,
    // warm white (never pure white) at the hottest.
    // Pale folder colours are saturated first, so every star glows in a clear hue rather than a washed-out grey.
    vec3 base = mix(vC, vec3(1.0, 0.58, 0.22), 0.45);
    base = pow(base / max(max(base.r, base.g), max(base.b, 1e-3)), vec3(2.5));
    vec3 deep = mix(base, vec3(0.6, 0.12, 0.03), 0.5) * 0.07, mid = base * 0.36;
    vec3 hot = mix(base, vec3(1.0, 0.94, 0.8), 0.5) * 0.92;
    vec3 col = mix(deep, mid, smoothstep(0.12, 0.55, L));
    col = mix(col, hot, smoothstep(0.55, 1.0, L));
    gl_FragColor = vec4(col, cover);
    #include <colorspace_fragment>
  }`;

const GLOW_VERT = `
  varying vec3 vN, vV, vC;
  void main(){
    vC = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vC = instanceColor;
    #endif
    mat4 m = modelViewMatrix * instanceMatrix;
    vec4 mv = m * vec4(position, 1.0);
    vN = normalize(mat3(m) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FRAG = `
  varying vec3 vN, vV, vC;
  void main(){
    // Distance from the star's centre across the shell, as a share of the shell's radius: the star's edge sits at
    // 1/GLOW, and the glow fades from there to nothing at the shell's rim.
    float mu = abs(dot(normalize(vN), normalize(vV)));
    float x = sqrt(1.0 - mu * mu), edge = ${(1 / GLOW).toFixed(4)};
    float g = pow(1.0 - clamp((x - edge) / (1.0 - edge), 0.0, 1.0), 3.0);
    gl_FragColor = vec4(mix(vC, vec3(1.0, 0.92, 0.8), 0.25) * g * 0.32, 1.0);
    #include <colorspace_fragment>
  }`;

const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _hit = new THREE.Vector3();

export class StarBodies {
  constructor(scene) {
    this.scene = scene;
    this.capacity = 0;
    this.slotOf = new Map();
    this.time = { value: 0 };
    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      alphaToCoverage: true,
      toneMapped: false,
    });
    this.glowMaterial = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.quad = new THREE.PlaneGeometry(2, 2);
    this.shell = new THREE.IcosahedronGeometry(1, 3);
    this.mesh = null;
    this.glow = null;
    this.matrix = new THREE.Matrix4();
    this.scale = new THREE.Matrix4();
    this.scale.makeScale(GLOW, GLOW, GLOW);
  }

  /** Assigns a slot to each star file (indices into host.data.nodes()). */
  rebuild(fileIds) {
    if (fileIds.length > this.capacity) {
      this.disposeMeshes();
      this.capacity = Math.max(16, Math.ceil(fileIds.length * 1.5));
      this.mesh = new THREE.InstancedMesh(this.quad, this.surfaceMaterial, this.capacity);
      this.glow = new THREE.InstancedMesh(this.shell, this.glowMaterial, this.capacity);
      this.mesh.name = 'stars';
      this.glow.name = 'star-glow';
      this.glow.renderOrder = 1;
      for (const m of [this.mesh, this.glow]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        m.frustumCulled = false;
        this.scene.add(m);
      }
      this.glow.raycast = () => {};
      this.mesh.raycast = (raycaster, hits) => this.raycast(raycaster, hits);
    }
    this.slotOf = new Map(fileIds.map((i, slot) => [i, slot]));
    this.mesh.userData.fileIds = fileIds.slice();
    this.mesh.userData.pickablePlanet = true;
    this.mesh.count = this.glow.count = fileIds.length;
  }

  /** Picking against each star's sphere (the drawn square is only a canvas for it). */
  raycast(raycaster, hits) {
    const mesh = this.mesh;
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, _m);
      _m.premultiply(mesh.matrixWorld);
      _sphere.center.setFromMatrixPosition(_m);
      _sphere.radius = _m.getMaxScaleOnAxis();
      if (!raycaster.ray.intersectSphere(_sphere, _hit)) continue;
      const distance = raycaster.ray.origin.distanceTo(_hit);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      hits.push({ distance, point: _hit.clone(), object: mesh, instanceId: k });
    }
  }

  place(fileId, matrix) {
    const slot = this.slotOf.get(fileId);
    if (slot == null) return;
    this.mesh.setMatrixAt(slot, matrix);
    this.glow.setMatrixAt(slot, this.matrix.multiplyMatrices(matrix, this.scale));
  }

  color(fileId, color) {
    const slot = this.slotOf.get(fileId);
    if (slot == null) return;
    this.mesh.setColorAt(slot, color);
    this.glow.setColorAt(slot, color);
  }

  end(time) {
    if (!this.mesh) return;
    this.time.value = time;
    for (const m of [this.mesh, this.glow]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  disposeMeshes() {
    for (const m of [this.mesh, this.glow]) {
      if (!m) continue;
      this.scene.remove(m);
      m.dispose();
    }
    this.mesh = this.glow = null;
  }

  dispose() {
    this.disposeMeshes();
    this.quad.dispose();
    this.shell.dispose();
    this.surfaceMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
