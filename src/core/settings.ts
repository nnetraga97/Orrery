// The settings, with their defaults and allowed values, kept on this device. Every setting is a row of pinchable
// choices in the Settings tab of the chat window (docs/plans/changes-after-review.md, Task 16); there is no palm menu.
import type { Mode, Permission } from './chat/composer.ts';

export type Settings = {
  textScale: number;
  /** Metres to raise (or lower) the room's content for the user's seat. */
  seatHeight: number;
  handedness: 'left' | 'right';
  highContrast: boolean;
  reduceMotion: boolean;
  volume: number;
  mute: boolean;
  provider: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  permission: Permission;
  mode: Mode;
  followAgent: boolean;
};

export const TEXT_SCALES = [0.85, 1, 1.2, 1.4];
export const SEAT_HEIGHTS = [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15];
export const VOLUMES = [0, 0.25, 0.5, 0.75, 1];
export const EFFORTS: Settings['effort'][] = ['low', 'medium', 'high'];

export const DEFAULT_SETTINGS: Settings = {
  textScale: 1,
  seatHeight: 0,
  handedness: 'right',
  highContrast: false,
  reduceMotion: false,
  volume: 0.5,
  mute: false,
  provider: 'recorded',
  model: '',
  effort: 'medium',
  permission: 'workspace',
  mode: 'work',
  followAgent: true,
};

const nearest = (list: number[], v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : fallback;
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Settings from anything (a stored copy, a pinch): unknown keys dropped, every value made one of its allowed ones. */
export function validSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    textScale: nearest(TEXT_SCALES, r.textScale, d.textScale),
    seatHeight: nearest(SEAT_HEIGHTS, r.seatHeight, d.seatHeight),
    handedness: oneOf(['left', 'right'] as const, r.handedness, d.handedness),
    highContrast: bool(r.highContrast, d.highContrast),
    reduceMotion: bool(r.reduceMotion, d.reduceMotion),
    volume: nearest(VOLUMES, r.volume, d.volume),
    mute: bool(r.mute, d.mute),
    provider: typeof r.provider === 'string' && r.provider ? r.provider : d.provider,
    model: typeof r.model === 'string' ? r.model : d.model,
    effort: oneOf(EFFORTS, r.effort, d.effort),
    permission: oneOf(['readOnly', 'workspace', 'full'] as const, r.permission, d.permission),
    mode: oneOf(['work', 'plan'] as const, r.mode, d.mode),
    followAgent: bool(r.followAgent, d.followAgent),
  };
}

/** One setting changed by a pinched choice (`set:<key>:<value>`); the value is parsed by the setting's type. */
export function applyChoice(s: Settings, key: string, value: string): Settings {
  if (!(key in DEFAULT_SETTINGS)) return s;
  const current = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
  const parsed = typeof current === 'number' ? Number(value) : typeof current === 'boolean' ? value === 'true' : value;
  // A model belongs to its provider: changing provider clears it (the provider's default is used).
  if (key === 'provider' && parsed !== s.provider) return validSettings({ ...s, provider: parsed, model: '' });
  return validSettings({ ...s, [key]: parsed });
}

export const loadSettings = (json: string | null) => {
  try {
    return validSettings(json ? JSON.parse(json) : null);
  } catch {
    return validSettings(null);
  }
};
