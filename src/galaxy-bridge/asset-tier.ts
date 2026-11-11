// Which asset folder the scene's models and images come from: public/assets/ (the full tier) or public/assets-quest/
// (the headset tier: smaller town textures; tools/assets/build-assets.mjs --tier=quest). Chosen by ?tier=quest|full,
// and by default the headset tier in a headset's browser. The copied code builds its URLs as `assets/...`; three's
// loading manager rewrites model and image URLs, so nothing in galaxy/ changes. JSON files always come from assets/.
import { DefaultLoadingManager } from '@iwsdk/core';

export type AssetTier = 'full' | 'quest';

export function chooseTier(search: string, userAgent: string): AssetTier {
  const asked = new URLSearchParams(search).get('tier');
  if (asked === 'quest' || asked === 'full') return asked;
  return /OculusBrowser|Quest/i.test(userAgent) ? 'quest' : 'full';
}

export function installAssetTier(tier: AssetTier) {
  if (tier !== 'quest') return;
  DefaultLoadingManager.setURLModifier(url =>
    /(^|\/)assets\/.+\.(glb|png|jpe?g|webp)(\?|$)/.test(url) ? url.replace(/(^|\/)assets\//, '$1assets-quest/') : url,
  );
}
