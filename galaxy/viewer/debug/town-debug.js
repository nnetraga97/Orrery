import * as THREE from 'three';
import { planetBuildBudget } from '../shared/build-budget.js';

// Debug materials belong to this detail. Never retune the shared orbital library materials.
export function createTownDebug({ T, body, towns }) {
  const group = new THREE.Group();
  group.name = 'town-debug-footprints';
  group.visible = false;
  T.scene.add(group);
  const resources = [],
    materials = [],
    lights = [];
  let enabled = false,
    disposed = false,
    built = 0,
    building = null;
  // Build lot footprints only when requested; ordinary edits need no invisible overlay.
  async function build() {
    const checkpoint = planetBuildBudget();
    while (built < towns.regionCount && enabled && !disposed) {
      await checkpoint();
      if (!enabled || disposed) return;
      const k = built++,
        frame = towns.frameOf(k),
        positions = [];
      for (const lot of towns.elementsOf(k)) {
        const half = (lot.bounds?.width ?? towns.scaleOf(k)) * 0.55;
        const corners = [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ];
        for (let i = 0; i < 4; i++)
          for (const [x, y] of [corners[i], corners[(i + 1) % 4]]) {
            const base = towns.worldOfLot(lot),
              normal = frame.normalAt(base);
            positions.push(
              ...base.addScaledVector(frame.e, x).addScaledVector(frame.nn, y).addScaledVector(normal, 0.02).toArray(),
            );
          }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: '#e8d99b',
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.LineSegments(geometry, material);
      line.renderOrder = 25;
      group.add(line);
      resources.push(geometry, material);
    }
  }
  function set(value) {
    if (disposed || enabled === value) return;
    enabled = value;
    group.visible = value;
    towns.setDebug?.(value);
    if (value) {
      building ??= build().finally(() => {
        building = null;
      });
      body.group.traverse(mesh => {
        if (!mesh.material) return;
        const original = mesh.material,
          clone = original.clone();
        clone.onBeforeCompile = shader => {
          original.onBeforeCompile?.(shader);
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <tonemapping_fragment>',
            'gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, 0.3);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.35), 0.25);\n#include <tonemapping_fragment>',
          );
        };
        clone.customProgramCacheKey = () => original.customProgramCacheKey() + ':town-debug';
        materials.push({ mesh, original, clone });
        mesh.material = clone;
      });
      T.scene.children
        .filter(o => o.isLight)
        .forEach(light => {
          lights.push({
            light,
            color: light.color.clone(),
            intensity: light.intensity,
            ground: light.groundColor?.clone(),
          });
          light.color.set('#ffffff');
          light.intensity = light.isHemisphereLight ? 2.2 : 1.5;
          light.groundColor?.set('#b8b8b8');
        });
    } else {
      materials.splice(0).forEach(({ mesh, original, clone }) => {
        mesh.material = original;
        clone.dispose();
      });
      lights.splice(0).forEach(({ light, color, intensity, ground }) => {
        light.color.copy(color);
        light.intensity = intensity;
        if (ground) light.groundColor.copy(ground);
      });
    }
  }
  return {
    set,
    refresh() {
      if (!enabled) return;
      set(false);
      set(true);
    },
    dispose() {
      set(false);
      disposed = true;
      group.removeFromParent();
      resources.forEach(r => r.dispose());
    },
  };
}
