// The component manifest the editor and the runtime share (iwsdk.config.json points here).
import { defineComponents } from '@iwsdk/core';
import { GalaxyRoot } from './components/galaxy-root.ts';
import { Panel } from './components/panel.ts';

export default defineComponents([GalaxyRoot, Panel]);
