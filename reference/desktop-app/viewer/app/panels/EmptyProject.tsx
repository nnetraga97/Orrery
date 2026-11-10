// The overlay on an empty workspace's constellation: what to do next, from whichever host owns the workspace.
import { useStore } from './use-store.ts';

export function EmptyProject() {
  const prompt = useStore('emptyPrompt');
  const current = useStore('current');
  return (
    <div id="emptyProject" hidden={!prompt || current !== 'constellation'}>
      <h2 id="emptyProjectName">{prompt?.name}</h2>
      <p id="emptyProjectHint">{prompt?.hint}</p>
      <button id="emptyConnectAgent" hidden={!prompt?.action} onClick={prompt?.action?.run}>
        {prompt?.action?.label}
      </button>
    </div>
  );
}
