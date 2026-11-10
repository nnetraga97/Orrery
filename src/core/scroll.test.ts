import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragScroll, pageScroll } from './scroll.ts';

test('dragging the page down shows earlier lines', () => {
  assert.equal(dragScroll(10, 100, 50, 80), 8);
  assert.equal(dragScroll(10, -100, 50, 80), 12);
});

test('dragScroll stays within 0 and maxTop', () => {
  assert.equal(dragScroll(1, 500, 50, 80), 0);
  assert.equal(dragScroll(79, -500, 50, 80), 80);
});

test('pageScroll moves by rows minus 3, clamped', () => {
  assert.equal(pageScroll(0, 1, 35, 100), 32);
  assert.equal(pageScroll(40, -1, 35, 100), 8);
  assert.equal(pageScroll(10, -1, 35, 100), 0);
  assert.equal(pageScroll(90, 1, 35, 100), 100);
});
