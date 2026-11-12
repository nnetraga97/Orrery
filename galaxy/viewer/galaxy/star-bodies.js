// Files with planets drawn as stars: one instanced batch of star surfaces and one of their glow, two draw calls for
// every star in the galaxy. Each star is tinted from its folder's colour toward hot white; picking uses the surface
// batch, whose userData.fileIds maps an instance to its file (as the asteroid and planet batches do).
import * as THREE from 'three';

const SURFACE_VERT = `
  varying vec3 vN, vV, vP, vC;
  void main(){
    vP = position;
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
const SURFACE_FRAG = `
  uniform float uTime; varying vec3 vN, vV, vP, vC;
  float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
  void main(){
    vec3 p = normalize(vP) * 3.0;
    float g = 0.6 * n(p + uTime * 0.12) + 0.4 * n(p * 2.7 - uTime * 0.2);
    float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    vec3 hot = vec3(1.0, 0.96, 0.88);
    vec3 col = mix(vC, hot, 0.4 * pow(mu, 3.0)) * (0.8 + 0.4 * g) * (0.6 + 0.4 * mu);
    gl_FragColor = vec4(col * 1.25, 1.0);
    #include <colorspace_fragment>
  }`;
const GLOW_FRAG = `
  varying vec3 vN, vV, vP, vC;
  void main(){
    float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    // Distance from the star's centre across the glow shell, as a share of its radius: the star's limb sits at
    // GLOW_INNER, and the glow fades to nothing at the shell's edge.
    float x = sqrt(1.0 - mu * mu);
    float g = pow(clamp((1.0 - x) / (1.0 - ${(1 / 2.2).toFixed(3)}), 0.0, 1.0), 2.2);
    gl_FragColor = vec4(mix(vC, vec3(1.0, 0.95, 0.85), 0.2) * g * 0.6, 1.0);
    #include <colorspace_fragment>
  }`;
/** The glow shell's radius, as a multiple of the star's. */
const GLOW = 2.2;

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
      toneMapped: false,
    });
    this.glowMaterial = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.geometry = new THREE.IcosahedronGeometry(1, 3);
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
      this.mesh = new THREE.InstancedMesh(this.geometry, this.surfaceMaterial, this.capacity);
      this.glow = new THREE.InstancedMesh(this.geometry, this.glowMaterial, this.capacity);
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
    }
    this.slotOf = new Map(fileIds.map((i, slot) => [i, slot]));
    this.mesh.userData.fileIds = fileIds.slice();
    this.mesh.userData.pickablePlanet = true;
    this.mesh.count = this.glow.count = fileIds.length;
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
    this.geometry.dispose();
    this.surfaceMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
