// The host the copied scene code talks to (`host` in galaxy/). Every member listed in the plan's "What the scene code
// expects", with shapes taken from reference/desktop-app/viewer/app/host.ts. Implemented by src/flat/flat-host.js
// (plain DOM) and src/galaxy-bridge/xr-host.ts (the XR app). Shapes the copied code does not rely on are `unknown`.

/** A file in the loaded import graph (galaxy/viewer/app/types.ts FileNode, the members a host needs). */
export interface HostFileNode {
  i: number;
  path: string;
  rloc: number;
  name: string;
  folder: string;
  [member: string]: unknown;
}
export interface HostImportLink {
  s: number;
  t: number;
  use?: [number, number, number];
}
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** A context window: hover or pinned card describing something in the scene. */
export interface ContextItem {
  key?: string;
  kind?: string;
  title?: string;
  sub?: string;
  color?: string;
  text?: string;
  body?: string | ((element: HTMLElement) => void);
  actions?: { label: string; onClick: () => void }[];
  anchor?: WorldAnchor;
  onClick?: () => void;
  [member: string]: unknown;
}
export interface WorldAnchor {
  world: () => Vector3Like;
}
export interface ContextWindows {
  esc(text: unknown): string;
  hover(item: ContextItem | null | undefined): void;
  pin(item: ContextItem | null | undefined): void;
  close(): void;
  place(): void;
  refresh(): void;
  readonly pinned: ContextItem | null;
}

export interface Viewport {
  width: number;
  height: number;
  left: number;
  top: number;
  visible: boolean;
}
export interface StageViewport {
  get(): Viewport;
  refresh(): void;
  subscribe(listener: (viewport: Viewport) => void): () => void;
}

export interface LoadingHandle {
  update(message: string): void;
  finish(): void;
}

/** The planet inspector a landed planet creates (`host.inspector.create(options)`). */
export interface InspectorPort {
  setTab(...args: unknown[]): void;
  stackChanged(...args: unknown[]): void;
  hover(...args: unknown[]): void;
  windowFor(...args: unknown[]): unknown;
  transportStatus(...args: unknown[]): void;
  showStatement(element: unknown, ...rest: unknown[]): void;
  setRegion(k: number | null, ...rest: unknown[]): void;
  openMethod(k: number | null, ...rest: unknown[]): void;
  evidenceChanged(...args: unknown[]): void;
  dispose(): void;
}
/** The options planet-detail.js passes to the inspector (galaxy/viewer/planet/planet-detail.js lines 42-100). */
export interface InspectorOptions {
  file: HostFileNode;
  source: string;
  colored?: unknown;
  regions: unknown[];
  towns?: unknown;
  onStatement?: (element: unknown, pan: boolean) => void;
  onMethod?: (k: number) => void;
  onFit?: () => void;
  [member: string]: unknown;
}

export interface HostPort {
  data: {
    dataset(): string | null;
    revision(): number | null;
    nodes(): HostFileNode[];
    links(): HostImportLink[];
    groups(): string[];
    grouping(): string;
    groupIndex(): unknown;
    out(): number[][];
    inc(): number[][];
  };
  actions: {
    render(): void;
    selectFile(i: number | null, options?: { fly?: boolean }): void;
    enterPlanet(i: number, options?: { line?: number | null; arrival?: unknown; townId?: string | null }): void;
    exitPlanet(): void;
    showHover(node?: HostFileNode | null): void;
  };
  overview(): unknown;
  debug: { selectFrame(index: number): void };
  projects: { has(dataset: string): boolean };
  dom(id: string): HTMLElement | null;
  windows: { context: ContextWindows; worldAnchor(getPos: () => Vector3Like): WorldAnchor };
  memory: {
    fileAppearance(path: string, callables?: number | null): unknown;
    townKeys(path: string, regions: { id: string }[], source: string | null): unknown;
    layoutNotice(): unknown;
    layout(grouping: string): unknown;
    save(): void;
  };
  graph: {
    groupOf(node: HostFileNode): string;
    color(group: string): string;
    groupArms(): { name: string; members: number[] }[];
    importUse(s: number, t: number): unknown;
    importsIndexed(): boolean;
    membersOf(): HostFileNode[][];
    fetchSymbols(...args: unknown[]): Promise<unknown>;
    nodeOf(path: string): HostFileNode | undefined;
  };
  preferences: { remember(key: string, value: string | number): void; recall(key: string): string | null };
  stage: {
    element: HTMLElement | null;
    viewport: StageViewport;
    createObstacles(): { appendTo(boxes: unknown[]): void; dispose(): void };
  };
  layout: { country<T>(build: () => T): T };
  loading: { begin(title: string, detail: string): LoadingHandle; paint(): Promise<void> };
  source: { open(point: { file: string; line?: number | null; [member: string]: unknown }, revision?: unknown): void };
  inspector: {
    create(options: InspectorOptions): InspectorPort;
    highlightSource(node: unknown, source: string, ...rest: unknown[]): Promise<unknown>;
  };
}
