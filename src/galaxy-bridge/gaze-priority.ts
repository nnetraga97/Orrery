// Gaze targeting with windows in front of the model. On glasses the eyes pick the target (IWSDK's gaze pointer, a cone
// cast over the ray targets). The model is reached through one invisible hit volume that encloses the space where
// windows may also sit; when the eyes are on a window inside that volume both are "on axis", and the default tie-break
// (nearer surface) picks the volume's front face. This comparer keeps IWSDK's rule (closer by angle, then by distance)
// but lets a window win any tie against the hit volume, as pointerEventsOrder already does for hand rays.
import { GazeConecaster } from '@iwsdk/core';
import type { GazeHit, XRInputManager } from '@iwsdk/core';
import { HIT_VOLUME_NAME } from './pointer-bridge.ts';

const ANGLE_EPSILON = 0.5 * (Math.PI / 180);

const isVolume = (hit: GazeHit) => hit.object.name === HIT_VOLUME_NAME;

export function preferWindowsForGaze(input: XRInputManager) {
  const provider = new GazeConecaster({
    comparer: (a, b) => {
      const dAngle = a.angularDistance - b.angularDistance;
      if (Math.abs(dAngle) > ANGLE_EPSILON) return dAngle;
      const av = isVolume(a),
        bv = isVolume(b);
      if (av !== bv) return av ? 1 : -1;
      return a.intersection.distance - b.intersection.distance;
    },
  });
  // Installed as a GazeConecaster, so the gaze system still pushes its cone angle, dwell and length onto it.
  input.gazePointer.setCandidateProvider(provider);
}
