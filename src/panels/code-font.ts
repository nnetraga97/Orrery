// The monospace font for code: an open-licence (OFL-1.1) font from @fontsource, inlined into the bundle and
// registered under a neutral family name before the first draw.
import bold from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?inline';
import regular from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline';

export const CODE_FONT = 'Orrery Mono';

let loading: Promise<void> | null = null;

export function loadCodeFont(): Promise<void> {
  loading ??= Promise.all([
    new FontFace(CODE_FONT, `url(${regular})`, { weight: '400' }).load(),
    new FontFace(CODE_FONT, `url(${bold})`, { weight: '700' }).load(),
  ]).then(faces => {
    for (const face of faces) document.fonts.add(face);
  });
  return loading;
}
