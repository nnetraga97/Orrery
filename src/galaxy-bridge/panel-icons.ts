// Hands the copied toolbar icons to the canvas panels (src/panels/icons.ts), which may not import copied code. The
// copied module answers an unknown name with its "info" shape; that is reported as missing instead.
import { setIconShapes } from '../panels/icons.ts';
import { UIIcons } from './icon-shapes.js';

export function installPanelIcons() {
  const fallback = UIIcons.shape('info');
  setIconShapes(name => {
    const svg = UIIcons.shape(name);
    return svg === fallback && name !== 'info' ? null : svg;
  });
}

installPanelIcons();
