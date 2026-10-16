import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyCurrentRelease } from './verify-current-release.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = join(root, 'release/current-manifest.json');

function fixture(t) {
  const parent = join(root, 'runtime/omarchy/tmp');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'release-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const current = join(dir, 'current');
  cpSync(join(root, 'release/current'), current, { recursive: true });
  return { dir, current };
}

test('absolute CLI through a symlink rejects same-size corruption instead of silently succeeding', (t) => {
  const { dir, current } = fixture(t);
  const index = join(current, 'index.html');
  const bytes = readFileSync(index);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(index, bytes);
  const alias = join(dir, 'checkout-alias');
  symlinkSync(root, alias, 'dir');
  const result = spawnSync(process.execPath, [join(alias, 'tools/verify-current-release.mjs'), current, manifest], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /hash mismatch index\.html/);
});

test('retained release rejects unmanifested files', (t) => {
  const { current } = fixture(t);
  writeFileSync(join(current, 'injected.js'), 'globalThis.unapproved = true;');
  assert.throws(() => verifyCurrentRelease(current, manifest), /unexpected: injected\.js/);
});

test('retained release rejects a symlink even when its target has the correct bytes', (t) => {
  const { dir, current } = fixture(t);
  const index = join(current, 'index.html');
  const target = join(dir, 'original-index.html');
  writeFileSync(target, readFileSync(index));
  rmSync(index);
  symlinkSync(target, index);
  assert.throws(() => verifyCurrentRelease(current, manifest), /symlink rejected: index\.html/);
});
