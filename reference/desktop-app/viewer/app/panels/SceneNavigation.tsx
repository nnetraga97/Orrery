import { actions, projects, state } from '../state.ts';
import { Icon } from './Icon.tsx';
import { useStore } from './use-store.ts';

function returnHome() {
  actions.selectFile(null, { fly: false });
  document.getElementById('cameraHome')?.click();
}
function returnToCannon() {
  state.view?.cannon?.focusCannon?.();
}
const PRESETS = [
  { kind: 'top', icon: 'viewTop', title: 'Top view · look straight down at the target' },
  { kind: 'angle', icon: 'viewAngle', title: 'Angled view · 45 degrees above the target' },
  { kind: 'horizon', icon: 'viewHorizon', title: 'Horizon view · low, along the surface or galactic plane' },
];
function preset(kind: string) {
  state.view?.cameraPreset?.(kind);
}
export function SceneNavigation() {
  const current = useStore('current'),
    dataset = useStore('dataset'),
    view = useStore('view'),
    selected = useStore('selected');
  return (
    <>
      {/* The circuit board draws on demand and has its own zoom controls and overview (board.js). */}
      <output
        id="sceneFps"
        aria-label="Scene frames per second"
        aria-live="off"
        title="Rendered frames per second · one-second average"
        hidden={current === 'board'}
      >
        — FPS
      </output>
      <nav className="scene-navigation" aria-label="Scene navigation" hidden={current === 'board'}>
        {PRESETS.map(p => (
          <button
            key={p.kind}
            id={`camera-${p.kind}`}
            type="button"
            title={p.title}
            aria-label={p.title.split(' · ')[0]}
            hidden={current !== 'constellation'}
            disabled={!view}
            onClick={() => preset(p.kind)}
          >
            <Icon name={p.icon} />
          </button>
        ))}
        <button
          id="camera-focus"
          type="button"
          title="Focus selection · fly to the selected file"
          aria-label="Focus selection"
          hidden={current !== 'constellation'}
          disabled={!view || selected == null}
          onClick={() => preset('focus')}
        >
          <Icon name="focus" />
        </button>
        <button
          id="sceneHome"
          type="button"
          title="Return to home · Fit the whole scene"
          aria-label="Return to home"
          disabled={!view}
          onClick={returnHome}
        >
          <Icon name="home" />
        </button>
        <button
          id="sceneCannon"
          type="button"
          title="Return to cannon"
          aria-label="Return to cannon"
          hidden={current !== 'constellation' || !projects.has(dataset)}
          disabled={!view}
          onClick={returnToCannon}
        >
          <Icon name="cannon" />
        </button>
      </nav>
    </>
  );
}
