// Tags an entity that is a flat canvas panel (src/panels/canvas-panel.ts). Gestures over a hovered panel are its own.
import { createComponent, Types } from '@iwsdk/core';

export const Panel = createComponent('Panel', {
  name: { type: Types.String, default: '' },
});
