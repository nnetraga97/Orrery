import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTS, THEME, codeColor } from './theme.ts';

test('every colour token is a six-digit hex colour', () => {
  for (const [name, value] of Object.entries(THEME)) {
    if (name === 'inkAlpha') continue;
    assert.match(String(value), /^#[0-9a-f]{6}$/, name);
  }
  assert.equal(THEME.inkAlpha, 0.88);
});

test('the three fonts are the style page’s families', () => {
  assert.equal(FONTS.label.family, 'Barlow Condensed');
  assert.equal(FONTS.label.weight, 600);
  assert.equal(FONTS.body.family, 'Barlow');
  assert.equal(FONTS.body.weight, 400);
  assert.equal(FONTS.mono.weight, 400);
});

test('code colours: keywords line, identifiers white, literals ok, comments lineDim', () => {
  assert.equal(codeColor('tok-keyword'), THEME.line);
  assert.equal(codeColor('tok-string'), THEME.ok);
  assert.equal(codeColor('tok-number'), THEME.ok);
  assert.equal(codeColor('tok-comment'), THEME.lineDim);
  assert.equal(codeColor(undefined), THEME.white);
  assert.equal(codeColor('tok-function'), THEME.white);
  assert.equal(codeColor('tok-type'), THEME.white);
});
