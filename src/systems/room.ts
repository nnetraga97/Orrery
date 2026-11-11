// The fixed room around the seat: a large dark floor with a faint grid in the `grid` token that fades with distance,
// so the room has a horizon and the user is not floating. There is no table: the model floats in the air. Nothing here
// moves.
import { CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, SRGBColorSpace } from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import { THEME } from '../core/theme.ts';

const FLOOR_RADIUS = 9;
/** Grid spacing in metres. */
const CELL = 0.5;

function floorTexture() {
  const size = 2048,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2,
    pxPerM = c / FLOOR_RADIUS;
  ctx.fillStyle = THEME.night;
  ctx.fillRect(0, 0, size, size);
  // Grid lines, one pass; the fade is applied afterwards with a radial mask.
  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  for (let m = -FLOOR_RADIUS; m <= FLOOR_RADIUS + 1e-6; m += CELL) {
    const p = c + m * pxPerM;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const fade = ctx.createRadialGradient(c, c, pxPerM * 0.8, c, c, c);
  const night = (alpha: number) => THEME.night + Math.round(alpha * 255).toString(16).padStart(2, '0');
  fade.addColorStop(0, night(0.25));
  fade.addColorStop(0.45, night(0.6));
  fade.addColorStop(0.8, night(0.95));
  fade.addColorStop(1, night(1));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createRoom(world: World) {
  const room = new Group();
  room.name = 'room';
  const floor = new Mesh(
    new CircleGeometry(FLOOR_RADIUS, 96),
    new MeshBasicMaterial({ map: floorTexture(), toneMapped: false }),
  );
  floor.name = 'room-floor';
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  return world.createTransformEntity(room);
}
