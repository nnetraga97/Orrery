// The composition root: creates the world, builds adapters, hands them to systems and registers systems.
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(world => {
  window.__orrery = { world, ready: true };
});
