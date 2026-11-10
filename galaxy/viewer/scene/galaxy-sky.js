// A distant, static sky shared by the space views. Bake the nebula and stars
// once; ordinary cubemap sampling is the only sky work in the animation loop.
import * as THREE from 'three';

export const GalaxySky = (() => {
  let cachedFaces = null;
  let cachedSize = 0;
  const plane = new THREE.Vector3(0.44, 0.69, -0.575).normalize();

  function bake(renderer, size) {
    const scene = new THREE.Scene();
    const target = new THREE.WebGLCubeRenderTarget(size, {
      depthBuffer: false,
      generateMipmaps: false,
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const nebula = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false, // Bake radiance, never the display tone curve.
      uniforms: { galacticPlane: { value: plane } },
      vertexShader: `
        varying vec3 direction;
        void main() {
          direction = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 direction;
        uniform vec3 galacticPlane;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.13, 0.27, 0.41));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float clouds(vec3 p) {
          float value = 0.0, weight = 0.54;
          for (int i = 0; i < 4; i++) {
            value += noise(p) * weight;
            p = p * 2.13 + vec3(7.1, 3.7, 9.2);
            weight *= 0.48;
          }
          return value;
        }
        void main() {
          vec3 d = normalize(direction);
          float broad = clouds(d * 3.6 + 12.0);
          float detail = clouds(d * 22.0 + broad * 2.7);
          float latitude = dot(d, galacticPlane) + (broad - 0.5) * 0.17;
          float halo = exp(-latitude * latitude * 12.0);
          float band = exp(-latitude * latitude * 58.0);
          float dust = smoothstep(0.28, 0.72, detail);
          float rift = exp(-pow((latitude + (detail - 0.5) * 0.15) * 24.0, 2.0));
          vec3 tint = mix(vec3(0.065, 0.12, 0.19), vec3(0.16, 0.085, 0.20), broad);
          vec3 color = vec3(0.018, 0.026, 0.049);
          color += tint * halo * (0.12 + broad * 0.2);
          color += mix(tint, vec3(0.17, 0.18, 0.23), dust * 0.6) * band * dust * 0.64;
          color *= 1.0 - rift * (1.0 - dust) * 0.62;
          // The procedural palette was authored as display RGB; decode it before lighting/baking.
          gl_FragColor = sRGBTransferEOTF(vec4(color, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), nebula);
    scene.add(box);

    // Seeded stars are baked into the same six faces: no extra live draw call,
    // no parallax, and no flicker when a project update rebuilds its scene.
    let seed = 731927;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const positions = [],
      colors = [],
      sizes = [];
    for (let n = 0; n < 5600;) {
      const y = random() * 2 - 1,
        angle = random() * Math.PI * 2,
        radius = Math.sqrt(1 - y * y);
      const x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      const latitude = x * plane.x + y * plane.y + z * plane.z;
      if (random() > 0.26 + 0.74 * Math.exp(-latitude * latitude * 32)) continue;
      n++;
      positions.push(x * 5, y * 5, z * 5);
      const bright = random(),
        warmth = random();
      const intensity = 0.13 + Math.pow(bright, 3) * 0.7;
      colors.push(intensity * (warmth > 0.86 ? 1 : 0.72), intensity * 0.86, intensity * (warmth > 0.86 ? 0.7 : 1));
      sizes.push(((bright > 0.985 ? 3.8 : 1.1 + bright * 1.3) * size) / 1024);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    starGeometry.setAttribute('diameter', new THREE.Float32BufferAttribute(sizes, 1));
    const starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      toneMapped: false, // Bake radiance, never the display tone curve.
      vertexShader: `
        attribute vec3 color;
        attribute float diameter;
        varying vec3 tint;
        void main() {
          tint = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = diameter;
        }`,
      fragmentShader: `
        varying vec3 tint;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float light = exp(-r * r * 5.5) * (1.0 - smoothstep(0.65, 1.0, r));
          gl_FragColor = vec4(sRGBTransferEOTF(vec4(tint, 1.0)).rgb, light);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    scene.add(new THREE.Points(starGeometry, starMaterial));
    try {
      new THREE.CubeCamera(0.1, 25, target).update(renderer, scene);
      return Array.from({ length: 6 }, (_, face) => {
        const pixels = new Uint16Array(size * size * 4);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels, face);
        return pixels;
      });
    } finally {
      target.dispose();
      box.geometry.dispose();
      nebula.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
    }
  }

  function create(renderer) {
    const size = Math.min(1024, renderer.capabilities.maxCubemapSize);
    if (!cachedFaces || cachedSize !== size) {
      cachedFaces = bake(renderer, size);
      cachedSize = size;
    }
    // CPU pixels survive renderer disposal, but each view owns its GPU texture.
    // Half-float Linear-sRGB radiance, not colour-encoded image bytes or material data.
    // Render-target output makes the shader colour-space chunk an identity transform;
    // AgX/sRGB are applied only when displaying the sky, never in the PMREM input.
    const faces = cachedFaces.map(pixels => {
      const face = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
      face.colorSpace = THREE.LinearSRGBColorSpace;
      return face;
    });
    const texture = new THREE.CubeTexture(faces);
    texture.type = THREE.HalfFloatType;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return {
      texture,
      dispose() {
        texture.dispose();
        faces.forEach(face => face.dispose());
      },
    };
  }

  return { create };
})();
