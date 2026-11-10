// CSS-pixel road widths shared by ribbons, directed highlights, and vehicle lanes.
import * as THREE from 'three';
export const roadPixels = kind => (kind === 'trunk' ? 3 : kind === 'collector' ? 1.5 : kind === 'access' ? 1 : 0);
const projectedA = new THREE.Vector3(),
  projectedB = new THREE.Vector3();
export function roadScreenScale(camera, height, x, z, nx, nz, width, pixels) {
  if (!pixels || !width) return 1;
  const a = projectedA.set(x, 0.09, z).project(camera);
  const b = projectedB.set(x + nx * width, 0.09, z + nz * width).project(camera);
  const projected = (Math.hypot((b.x - a.x) * camera.aspect, b.y - a.y) * height) / 2;
  return Math.max(1, pixels / Math.max(0.000001, projected));
}
export function screenRoadMaterial(material, height, detailDistance = 0) {
  const compile = material.onBeforeCompile;
  const viewport = { value: height };
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.roadDetailDistance = { value: detailDistance };
    shader.uniforms.roadViewport = viewport;
    shader.vertexShader =
      'attribute vec3 roadCenter;\nattribute vec2 roadOffset;\nattribute vec3 roadParams;\nuniform float roadViewport;\nvarying float roadMarkVisible;\nvarying float roadProjectedPixels;\nvarying float roadDistance;\nuniform float roadDetailDistance;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec4 centerView=modelViewMatrix*vec4(roadCenter,1.0);
      vec2 normal=normalize(roadOffset+vec2(0.0000001));
      vec4 sideView=modelViewMatrix*vec4(roadCenter+vec3(normal.x,0.0,normal.y)*roadParams.x,1.0);
      vec4 cp=projectionMatrix*centerView, sp=projectionMatrix*sideView;
      vec2 projected=sp.xy/sp.w-cp.xy/cp.w;
      projected.x*=projectionMatrix[1][1]/projectionMatrix[0][0];
      float pixels=length(projected)*roadViewport*0.5;
      roadProjectedPixels=pixels;
      roadDistance=length(centerView.xyz);
      float factor=max(1.0,roadParams.y/max(0.000001,pixels));
      vec3 transformed=position;
      transformed.xz=roadCenter.xz+roadOffset*factor;
      roadMarkVisible=abs(roadParams.z-2.0)<0.1 ? step(factor,1.05)*step(8.0,pixels) : 1.0;
    `,
    );
    // Separate coplanar ribbon layers by depth-buffer units, independent of distance.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\ngl_Position.z -= roadParams.z * 0.0000005 * gl_Position.w;',
    );
    shader.fragmentShader =
      'varying float roadMarkVisible;\nvarying float roadProjectedPixels;\nvarying float roadDistance;\nuniform float roadDetailDistance;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif(roadMarkVisible<0.5 || (roadDetailDistance>0.0 && roadDistance>roadDetailDistance)) discard;',
    );
  };
  material.customProgramCacheKey = () => 'country-screen-road-v2';
  return viewport;
}
