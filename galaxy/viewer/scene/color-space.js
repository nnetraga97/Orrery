// Import before creating any colours: hex/CSS inputs are sRGB, lighting works in Linear-sRGB.
import * as THREE from 'three';

THREE.ColorManagement.enabled = true;

// Initial migration calibration; visual review must tune these together in Electron.
export const COLOR = {
  exposure: 1, // AgX display exposure; keep neutral until before/after review.
  environmentIntensity: 1, // Strength of the linear sky's PMREM on physical materials.
  lightScale: Math.PI, // Preserve the r147-to-physical light-unit conversion.
  hemisphereIntensity: 0.65, // Down from 0.85: environment light now supplies some diffuse fill.
  directionalIntensity: 0.85, // Retain the existing sun level before the shared lightScale.
  planHemisphereIntensity: 2.4 / Math.PI, // Preserve the inset's existing physical light level.
  planDirectionalIntensity: 2 / Math.PI, // Same unit conversion for the town-plan sun.
};

export const legacyIntensity = intensity => intensity * COLOR.lightScale;

export function configureRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = COLOR.exposure;
  return renderer;
}
