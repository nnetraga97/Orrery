/** Ship hulls drawn at once in the XR app. */
export const VISIBLE_HULLS: number;
/** Asks the copied scene for its light rig models, a few ship hulls at a time and light road cars, and holds the island
 * still while idle. Also trims traffic: one car per planned path, overview ships only on the selected file's lanes, and
 * port ships only when a route is picked. */
export function applyHeadsetBudget(): void;
/** Where the viewer's head is, in the room (the galaxy system keeps it current). */
export const viewerEye: import('@iwsdk/core').Vector3;
/** Keeps a star from filling the room: one wider than a few degrees from the head shrinks away. */
export function limitStars(): void;
