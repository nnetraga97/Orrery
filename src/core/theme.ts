// The tokens of docs/visual-style.md: every colour and font the app draws with. Nothing else names a colour or a font.

export const THEME = {
  /** The backing of every window, drawn at inkAlpha. */
  ink: '#06101f',
  inkAlpha: 0.88,
  /** Faint rules, the floor's grid, dividers. */
  grid: '#1b3b5c',
  /** Resting outlines, line numbers, placeholder text, comments in code. */
  lineDim: '#2f6f9f',
  /** Active outlines, labels, keywords in code, secondary text. */
  line: '#7fd4ff',
  /** The fill of a hovered or pressed control, selection bands. */
  glow: '#2aa7ff',
  /** Body text, identifiers in code. */
  white: '#eaf6ff',
  /** A label that needs attention. */
  amber: '#ffb21a',
  /** The bug and failures. */
  alert: '#ff4760',
  /** Success, approving, literals in code. */
  ok: '#3fe0c5',
  /** The rotating working glyph only. */
  work: '#d97757',
  /** The room's darkness: the floor under its grid, and the test page. */
  night: '#02060d',
} as const;

export type ThemeColor = Exclude<keyof typeof THEME, 'inkAlpha'>;

/** Font families and weights; sizes are chosen per panel. The monospace face is registered under a neutral name. */
export const FONTS = {
  label: { family: 'Barlow Condensed', weight: 600, letterSpacingEm: 0.14 },
  body: { family: 'Barlow', weight: 400 },
  mono: { family: 'Orrery Mono', weight: 400 },
} as const;

/** A CSS font string for one of the three fonts at a pixel size. */
export function font(kind: keyof typeof FONTS, px: number): string {
  const f = FONTS[kind];
  const fallback = kind === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif';
  return `${f.weight} ${Math.round(px)}px "${f.family}", ${fallback}`;
}

/** The colour of a source token class: keywords line, literals ok, comments lineDim, everything else white. */
export function codeColor(cls: string | undefined): string {
  switch (cls) {
    case 'tok-keyword':
      return THEME.line;
    case 'tok-string':
    case 'tok-number':
      return THEME.ok;
    case 'tok-comment':
      return THEME.lineDim;
    default:
      return THEME.white;
  }
}

const NORMAL = { ...THEME };
/** High contrast: pure black backing and white lines; red, green and amber keep their meaning. */
const HIGH_CONTRAST = { ink: '#000000', inkAlpha: 1, grid: '#8a8a8a', lineDim: '#d0d0d0', line: '#ffffff', glow: '#ffffff', white: '#ffffff' };
let contrast = false;
/** Switches every token to high contrast (or back); the panels then redraw. */
export function applyContrast(on: boolean) {
  contrast = on;
  Object.assign(THEME as Record<string, unknown>, on ? HIGH_CONTRAST : NORMAL);
}
export const highContrast = () => contrast;
