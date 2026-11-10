// Simple materials for code-shaped land and town ground. Orbital bodies live in planet-library.js.
import * as THREE from 'three';

export function planetSeed(path) {
  let h = 2166136261;
  const key = path + '#s';
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h / 4294967296;
}

export const planetNoise = `
float planetHash(vec3 p) {
  p = fract(p * .1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float planetNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(planetHash(i), planetHash(i+vec3(1,0,0)),f.x),
                 mix(planetHash(i+vec3(0,1,0)),planetHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(planetHash(i+vec3(0,0,1)),planetHash(i+vec3(1,0,1)),f.x),
                 mix(planetHash(i+vec3(0,1,1)),planetHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float planetFbm(vec3 p) {
  float f = .5333*planetNoise3(p); p = p*2.03+vec3(7.1,3.4,1.7);
  f += .2667*planetNoise3(p); p = p*2.03+vec3(7.1,3.4,1.7);
  f += .1333*planetNoise3(p); p = p*2.03+vec3(7.1,3.4,1.7);
  return f + .0667*planetNoise3(p);
}
`;

function surfaceShader(material, seed, fragment) {
  material.onBeforeCompile = shader => {
    shader.uniforms.planetSeed = { value: seed * 37 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 planetPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nplanetPosition=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 planetPosition; uniform float planetSeed;\n' + planetNoise,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + fragment);
  };
}

export function planetLandMaterial(seed) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  surfaceShader(
    material,
    seed,
    `
    vec3 dir=normalize(planetPosition);
    float stone=planetFbm(dir*100.+planetSeed);
    float mottling=planetFbm(dir*27.+planetSeed);
    diffuseColor.rgb*=.77+.30*mottling+.20*stone;
    float limb=pow(1.-abs(dot(normalize(vNormal),normalize(vViewPosition))),4.);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.36,.40),limb*.18);
  `,
  );
  material.customProgramCacheKey = () => 'natural-planet-land-v1';
  return material;
}

// The library supplies a palette; the code supplies the coastline and relief.
export function planetOceanMaterial(seed, appearance) {
  return new THREE.MeshStandardMaterial({ color: appearance.ocean, roughness: 0.55 });
}
