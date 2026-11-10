// Flat country layers share one depth contract. Heights are in units of extent / 90.
// Curbs and markings on a highway are fragment colours on its single surface.
export const COUNTRY_LAYERS = Object.freeze({
  shore: { y: -0.04, bias: 0 },
  ground: { y: 0, bias: 0 },
  district: { y: 0.01, bias: -1 },
  lot: { y: 0.04, bias: -2 },
  lotCurb: { y: 0.055, bias: -3 },
  detail: { y: 0.065, bias: -4 },
  junction: { y: 0.08, bias: -6 },
  access: { y: 0.088, bias: -8 },
  collector: { y: 0.088, bias: -10 },
  trunk: { y: 0.088, bias: -12 },
  avenue: { y: 0.09, bias: -14 },
  ramp: { y: 0.095, bias: -16 },
  selection: { y: 0.105, bias: -18 },
  outgoing: { y: 0.11, bias: -20 },
  incoming: { y: 0.115, bias: -22 },
});
export function countryLayer(material, name) {
  material.polygonOffset = true;
  material.polygonOffsetFactor = 0;
  material.polygonOffsetUnits = COUNTRY_LAYERS[name].bias;
  material.userData.countryLayer = name;
  return material;
}
export const layerHeight = (name, extent = 90) => (COUNTRY_LAYERS[name].y * extent) / 90;
