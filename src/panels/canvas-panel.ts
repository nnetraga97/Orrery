// A flat rectangle in the room whose picture is drawn on a 2D canvas, and which takes pinches. A pinch or a mouse
// click arrives as a pointer event with the hit's texture coordinate (event.uv); the panel maps it to the region under
// it (src/core/panel-hit.ts) and calls onPress, onHover or onDrag.
import {
  CanvasTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RayInteractable,
  SRGBColorSpace,
} from '@iwsdk/core';
import type { Entity, WebGLRenderer, World } from '@iwsdk/core';
import { Panel } from '../components/panel.ts';
import { regionAt, uvToPixel } from '../core/panel-hit.ts';
import type { HitRegion } from '../core/panel-hit.ts';

export type DrawPanel = (ctx: CanvasRenderingContext2D, width: number, height: number) => HitRegion[];

interface UvEvent {
  uv?: { x: number; y: number };
  pointerId?: number;
}

export interface CanvasPanelOptions {
  name: string;
  widthPx: number;
  heightPx: number;
  widthM: number;
  heightM: number;
  renderer: WebGLRenderer;
}

export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  entity: Entity | null = null;
  regions: HitRegion[] = [];
  hovered: string | null = null;
  onPress: (id: string) => void = () => {};
  onHover: (id: string | null) => void = () => {};
  onDrag: (dxPx: number, dyPx: number) => void = () => {};
  private down: { x: number; y: number } | null = null;

  constructor(options: CanvasPanelOptions) {
    const { name, widthPx, heightPx, widthM, heightM, renderer } = options;
    this.canvas = document.createElement('canvas');
    this.canvas.width = widthPx;
    this.canvas.height = heightPx;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.texture.generateMipmaps = true;
    this.texture.minFilter = LinearMipmapLinearFilter;
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), material);
    this.mesh.name = `panel-${name}`;
    this.mesh.renderOrder = 30;
    const at = (event: unknown): [number, number] | null => {
      const uv = (event as UvEvent).uv;
      return uv ? uvToPixel(uv.x, uv.y, widthPx, heightPx) : null;
    };
    const target = this.mesh as unknown as { addEventListener(type: string, listener: (e: unknown) => void): void };
    target.addEventListener('pointermove', e => {
      const p = at(e);
      if (!p) return;
      if (this.down) {
        this.onDrag(p[0] - this.down.x, p[1] - this.down.y);
        this.down.x = p[0];
        this.down.y = p[1];
      }
      const id = regionAt(this.regions, p[0], p[1])?.id ?? null;
      if (id !== this.hovered) {
        this.hovered = id;
        this.onHover(id);
      }
    });
    target.addEventListener('pointerdown', e => {
      const p = at(e);
      this.down = p ? { x: p[0], y: p[1] } : null;
    });
    target.addEventListener('pointerup', () => {
      this.down = null;
    });
    target.addEventListener('pointerleave', () => {
      this.down = null;
      if (this.hovered !== null) {
        this.hovered = null;
        this.onHover(null);
      }
    });
    target.addEventListener('click', e => {
      const p = at(e);
      const id = p ? (regionAt(this.regions, p[0], p[1])?.id ?? null) : null;
      if (id) this.onPress(id);
    });
  }

  /** Puts the panel in the world as an entity that takes rays. */
  attach(world: World) {
    if (this.entity) return this;
    this.entity = world.createTransformEntity(this.mesh);
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(Panel, { name: this.mesh.name });
    return this;
  }

  redraw(draw: DrawPanel) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.regions = draw(this.ctx, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  set visible(on: boolean) {
    this.mesh.visible = on;
  }
  get visible() {
    return this.mesh.visible;
  }

  dispose() {
    this.entity?.dispose();
    this.entity = null;
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
