// The chat's data shapes, ported from the desktop chat (reference/desktop-app/viewer/app/codex-chat.ts) with neutral
// names. Field names and status values are kept, so a recorded desktop session reads unchanged. An item's status is
// one of 'inProgress', 'running', 'completed', 'failed', 'declined'.

export type ChatStatus = 'inProgress' | 'running' | 'completed' | 'failed' | 'declined';

export type ChatItem = {
  id?: string;
  /** App-owned content revision, unique across restarts. */
  revision?: string;
  type?: string;
  role?: string;
  attachmentNames?: string[];
  imagePaths?: string[];
  path?: string;
  status?: ChatStatus | string;
  title?: string;
  text?: string;
  content?: { type?: string; text?: string; path?: string; url?: string; name?: string }[];
  summary?: (string | { text?: string })[];
  command?: string | string[];
  cwd?: string;
  /** How a command was classified: reads, searches and listings are shown as what they are. */
  commandActions?: { type?: string; name?: string; path?: string; query?: string; command?: string }[];
  output?: string;
  aggregatedOutput?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  arguments?: unknown;
  turnId?: string | null;
  changes?: ChatChange[];
  plan?: { step?: string; text?: string; status?: string }[];
  diff?: string;
  server?: string;
  tool?: string;
  result?: unknown;
  contentItems?: { type: string; text?: string }[];
  query?: string;
};

export type ChatChange = {
  path?: string;
  file?: string;
  diff?: string;
  patch?: string;
  kind?: string | { type?: string; move_path?: string | null };
};

export type ChatQuestion = {
  id?: string;
  question?: string;
  header?: string;
  isSecret?: boolean;
  options?: { label?: string; value?: string; description?: string }[];
};

export type ChatRequest = {
  id: string;
  type: string;
  reason?: string;
  command?: string;
  cwd?: string;
  changes?: ChatChange[];
  questions?: ChatQuestion[];
};

export type PermissionLevel = 'read-only' | 'workspace-write' | 'full-access';

export type QueuedMessage = {
  id: string;
  text: string;
  model?: string;
  effort?: string;
  permission: PermissionLevel;
  collaborationMode?: 'default' | 'plan';
  state: 'ready' | 'sending' | 'failed';
  error?: string;
  attachments?: string[];
};

export type ChatThread = {
  id: string;
  streamEpoch?: string;
  streamRevision?: number;
  title?: string;
  status?: string;
  turnId?: string | null;
  model?: string;
  effort?: string;
  permission?: PermissionLevel;
  collaborationMode?: 'default' | 'plan';
  queued?: QueuedMessage[];
  queuePaused?: boolean;
  items?: ChatItem[];
  requests?: ChatRequest[];
  error?: string | { message?: string } | null;
  reconnecting?: string | null;
  updatedAt?: unknown;
  lastActivity?: unknown;
};
