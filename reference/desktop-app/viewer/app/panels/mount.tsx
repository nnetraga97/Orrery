// React panels, each rendered into its placeholder in index.html. Mounting is synchronous so the scripts that
// still write into panel-owned containers (such as #legendExtra) find them at startup.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { AgentActivity } from '../activity.ts';
import { $ } from '../dom.ts';
import { ActivityHistory } from './ActivityHistory.tsx';
import { EmptyProject } from './EmptyProject.tsx';
import { initAtlas } from '../atlas.ts';
import { AtlasControls } from './AtlasControls.tsx';
import { FileSearch } from './FileSearch.tsx';
import { ViewInfo } from './ViewInfo.tsx';
import { SceneNavigation } from './SceneNavigation.tsx';

export function mountPanels() {
  initAtlas();
  flushSync(() => {
    createRoot($('atlasControls')).render(<AtlasControls />);
    createRoot($('search')).render(<FileSearch />);
    createRoot($('viewInfo')).render(<ViewInfo />);
    createRoot($('activityHistory')).render(<ActivityHistory />);
    createRoot($('emptyPrompt')).render(<EmptyProject />);
    createRoot($('sceneNavigation')).render(<SceneNavigation />);
  });
  $('agentActivity').onclick = () => AgentActivity.open();
}
