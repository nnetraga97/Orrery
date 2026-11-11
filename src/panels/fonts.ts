// The three open-licence fonts of docs/visual-style.md (OFL-1.1, from @fontsource), inlined into the bundle and
// registered before the first window is drawn. The monospace face goes under a neutral family name.
import labelFace from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2?inline';
import bodyFace from '@fontsource/barlow/files/barlow-latin-400-normal.woff2?inline';
import monoBold from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?inline';
import monoRegular from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline';
import { FONTS } from '../core/theme.ts';

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  loading ??= Promise.all([
    new FontFace(FONTS.label.family, `url(${labelFace})`, { weight: String(FONTS.label.weight) }).load(),
    new FontFace(FONTS.body.family, `url(${bodyFace})`, { weight: String(FONTS.body.weight) }).load(),
    new FontFace(FONTS.mono.family, `url(${monoRegular})`, { weight: '400' }).load(),
    new FontFace(FONTS.mono.family, `url(${monoBold})`, { weight: '700' }).load(),
  ]).then(faces => {
    for (const face of faces) document.fonts.add(face);
  });
  return loading;
}
