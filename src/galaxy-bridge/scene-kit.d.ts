// Types for scene-kit.js: the scene-kit contract plus the members the XR app adds.
import type { Group, Ray, Texture, Vector3, WebGLRenderer } from '@iwsdk/core';
import type { HostPort } from '../ports/host.ts';
import type { SceneKitPort, LabelDefinition, Overlay, Vector3Like } from '../ports/scene-kit.ts';
import type { TableAnchor, VirtualCamera } from '../core/table-frame.ts';

export interface LabelSink {
  setLabels(list: LabelDefinition[]): void;
  addLabels(list: LabelDefinition[], xf?: (v: Vector3Like) => void, gate?: () => boolean): () => void;
}
export interface OverlaySink {
  update(overlays: ReadonlySet<Overlay>): void;
}

export interface XrSceneKit extends SceneKitPort {
  scene: Group & SceneKitPort['scene'];
  sky: Texture;
  environment: Texture;
  anchor: TableAnchor | null;
  tick(nowMs: number): void;
  pointerMove(ray: Ray): void;
  pointerLeave(): void;
  pointerClick(ray: Ray): void;
  virtual(): VirtualCamera;
  orbit(dAzimuth: number, dPolar: number): void;
  dolly(factor: number): void;
  home(): void;
  readonly pointing: boolean;
  swallowClick(on: boolean): void;
  // Added to T by the constellation once it is built.
  bodyPos?(i: number): Vector3;
  bodySize?(i: number): number;
  fileIndex?(path: string): number | null;
  readonly landed?: boolean;
  [member: string]: unknown;
}

export function createSceneKit(options: {
  camPos: [number, number, number];
  host: HostPort;
  renderer: WebGLRenderer;
  anchor?: TableAnchor | null;
  labels?: LabelSink;
  overlays?: OverlaySink;
}): XrSceneKit;
