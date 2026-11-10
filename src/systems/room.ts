// The fixed room around the seat: a dark table under the model with a faint rim, and a large dark floor with a subtle
// radial grid, so the room has a horizon and the user is not floating. Nothing here moves.
import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  TorusGeometry,
} from '@iwsdk/core';
import type { World } from '@iwsdk/core';

export const TABLE = { center: [0, 0.83, -0.55] as const, radius: 0.45, thickness: 0.03 };
const FLOOR_RADIUS = 8;

function floorTexture() {
  const size = 2048,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, '#0d1424');
  glow.addColorStop(1, '#03050a');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120, 150, 210, 0.07)';
  ctx.lineWidth = 2;
  // A ring every metre and a spoke every 15 degrees.
  for (let r = 1; r < FLOOR_RADIUS; r++) {
    ctx.beginPath();
    ctx.arc(c, c, (r / FLOOR_RADIUS) * c, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * c * 0.06, c + Math.sin(a) * c * 0.06);
    ctx.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createRoom(world: World) {
  const room = new Group();
  room.name = 'room';
  const floor = new Mesh(new CircleGeometry(FLOOR_RADIUS, 96), new MeshBasicMaterial({ map: floorTexture() }));
  floor.name = 'room-floor';
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const table = new Mesh(
    new CylinderGeometry(TABLE.radius, TABLE.radius * 0.96, TABLE.thickness, 96),
    new MeshStandardMaterial({ color: '#06080e', roughness: 0.9, metalness: 0, envMapIntensity: 0.25 }),
  );
  table.name = 'room-table';
  table.position.set(TABLE.center[0], TABLE.center[1] - TABLE.thickness / 2, TABLE.center[2]);
  room.add(table);
  const rim = new Mesh(
    new TorusGeometry(TABLE.radius, 0.004, 8, 128),
    new MeshBasicMaterial({ color: '#6f8fd0', transparent: true, opacity: 0.35 }),
  );
  rim.name = 'room-table-rim';
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(TABLE.center[0], TABLE.center[1], TABLE.center[2]);
  room.add(rim);
  return world.createTransformEntity(room);
}
