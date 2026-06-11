import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('index loads app module and local vendor import map', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\.\/src\/app\.js"><\/script>/);
  assert.match(html, /public\/vendor\/three\.module\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});
