import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchShortcut, isTypingTarget, shortcutHintHtml } from '../shortcuts.js';

const ev = (key, mods = {}) => ({ key, code: key === ' ' ? 'Space' : '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test('one key table for every annotator', () => {
  assert.equal(matchShortcut(ev('z', { metaKey: true })), 'undo');
  assert.equal(matchShortcut(ev('Z', { ctrlKey: true })), 'undo');
  assert.equal(matchShortcut(ev('z', { ctrlKey: true, shiftKey: true })), null, 'Shift+Ctrl+Z 不是撤销');
  assert.equal(matchShortcut(ev(' ')), 'play');
  assert.equal(matchShortcut(ev('ArrowRight')), 'nextFrame');
  assert.equal(matchShortcut(ev(']')), 'nextMarked');
  assert.equal(matchShortcut(ev('F')), 'focus');
  assert.equal(matchShortcut(ev('r')), 'reset');
  assert.equal(matchShortcut(ev('f', { metaKey: true })), null, '⌘F 留给浏览器');
});

test('typing targets keep their keys; sliders and buttons do not', () => {
  const t = (sel) => ({ matches: (q) => q.split(',').some((x) => x.trim() === sel) });
  assert.equal(isTypingTarget(t('input[type=number]')), true);
  assert.equal(isTypingTarget(t('input[type=range]')), false);
  assert.equal(isTypingTarget(null), false);
});

test('hints list only the actions a page provides', () => {
  const h = shortcutHintHtml({ undo() {}, focus() {}, prevMarked() {}, nextMarked() {} });
  assert.match(h, /Ctrl\/⌘\+Z/);
  assert.match(h, /\[ \/ \]/);
  assert.doesNotMatch(h, /空格/);
});
