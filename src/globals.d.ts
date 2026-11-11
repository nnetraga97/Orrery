// The test hook the XR page exposes (see docs/plans/m1-m2-galaxy-and-code.md, "Test hook").
import type { World } from '@iwsdk/core';

declare global {
  interface Window {
    __orrery?: {
      world: World;
      ready: boolean;
      [member: string]: unknown;
    };
  }
}

export {};
