#!/usr/bin/env node
/* Verify the frozen retained release against its manifest.
 *
 * Parent produces the inputs: release/current/ holds the exact previously live
 * index.html plus its complete reachable same-origin JS assets, and
 * release/current-manifest.json describes them (schemaVersion 1, sourceSha,
 * deploymentId, capturedAt, origin, files [{path,sha256,size}],
 * runtimeTreeSha256, digestPolicy).
 *
 * CLI: node tools/verify-current-release.mjs [root] [manifest]
 *   root defaults to release/current/ (repo-relative); manifest defaults to the
 *   sibling "<root>-manifest.json" when present, else release/current-manifest.json,
 *   so the copied site/current/ subtree re-verifies via the same CLI.
 * Assembler use: import { verifyCurrentRelease } from './verify-current-release.mjs'.
 * No building, no network. Exits 0 on success, 1 with a message on failure.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = 'verify-current-release';
const HEX40 = /^[0-9a-fA-F]{40}$/;
const HEX64 = /^[0-9a-fA-F]{64}$/;

const repoRoot = () => dirname(dirname(fileURLToPath(import.meta.url)));
const fail = (msg) => { throw new Error(`${TOOL}: ${msg}`); };
const errMsg = (e) => (e instanceof Error ? e.message : String(e));

/* Manifest paths are posix-style, relative, and must stay inside the root. */
function checkRelPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || p.includes('\\')) {
    fail(`bad manifest path ${JSON.stringify(p)}`);
  }
  if (p.startsWith('/')) fail(`absolute manifest path ${JSON.stringify(p)}`);
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    fail(`traversal manifest path ${JSON.stringify(p)}`);
  }
}

function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('manifest is not an object');
  if (m.schemaVersion !== 1) fail(`unsupported schemaVersion ${JSON.stringify(m.schemaVersion)}`);
  if (typeof m.sourceSha !== 'string' || !HEX40.test(m.sourceSha)) fail('bad sourceSha (want 40 hex)');
  if (typeof m.deploymentId !== 'number' || !Number.isInteger(m.deploymentId)) {
    fail('bad deploymentId (want integer)');
  }
  if (typeof m.capturedAt !== 'string' || !m.capturedAt) fail('bad capturedAt (want non-empty string)');
  if (typeof m.origin !== 'string') fail('bad origin (want URL string)');
  try {
    const u = new URL(m.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') fail('bad origin (want http(s) URL)');
  } catch { fail('bad origin (want absolute URL)'); }
  if (!Array.isArray(m.files) || m.files.length === 0) fail('bad files (want non-empty array)');
  if (typeof m.runtimeTreeSha256 !== 'string' || !HEX64.test(m.runtimeTreeSha256)) {
    fail('bad runtimeTreeSha256 (want 64 hex)');
  }
  if (m.digestPolicy === undefined || m.digestPolicy === null) fail('missing digestPolicy');
  if (typeof m.digestPolicy === 'string' && !m.digestPolicy) fail('bad digestPolicy (want non-empty)');
  const seen = new Set();
  for (const f of m.files) {
    if (!f || typeof f !== 'object') fail('bad files entry (want object)');
    checkRelPath(f.path);
    if (seen.has(f.path)) fail(`duplicate manifest path ${JSON.stringify(f.path)}`);
    seen.add(f.path);
    if (typeof f.sha256 !== 'string' || !HEX64.test(f.sha256)) {
      fail(`bad sha256 for ${JSON.stringify(f.path)} (want 64 hex)`);
    }
    if (typeof f.size !== 'number' || !Number.isInteger(f.size) || f.size < 0) {
      fail(`bad size for ${JSON.stringify(f.path)} (want non-negative integer)`);
    }
  }
  if (!seen.has('index.html')) fail('manifest must include index.html');
}

/* Collect every regular file under root; symlinks and special files are rejected
 * (a symlink could point outside the frozen tree, so it can never verify). */
function collectRegularFiles(root) {
  const st = lstatSync(root);
  if (st.isSymbolicLink()) fail(`symlink rejected: ${root}`);
  if (!st.isDirectory()) fail(`not a directory: ${root}`);
  const out = [];
  const walk = (rel) => {
    const abs = rel ? join(root, rel) : root;
    const s = lstatSync(abs);
    if (s.isSymbolicLink()) fail(`symlink rejected: ${rel || '.'}`);
    if (s.isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(rel ? `${rel}/${name}` : name);
      return;
    }
    if (!s.isFile()) fail(`not a regular file: ${rel}`);
    out.push({ rel, abs, size: s.size });
  };
  walk('');
  return out;
}

function findManifest(root) {
  const sibling = root.replace(/\/+$/, '') + '-manifest.json';
  if (existsSync(sibling)) return sibling;
  const fallback = join(repoRoot(), 'release', 'current-manifest.json');
  if (existsSync(fallback)) return fallback;
  fail(`manifest not found (tried ${sibling} and ${fallback})`);
}

const sha256File = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

/* SHA256 over sorted UTF8 entries `${path}\\0${sha256}\\n`, index.html included. */
function treeDigest(entries) {
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const h = createHash('sha256');
  for (const e of sorted) h.update(`${e.path}\0${e.sha256.toLowerCase()}\n`, 'utf8');
  return h.digest('hex');
}

export function verifyCurrentRelease(rootDir, manifestPath) {
  const root = resolve(rootDir);
  const manifestFile = manifestPath ? resolve(manifestPath) : findManifest(root);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (e) {
    fail(`cannot read manifest ${manifestFile}: ${errMsg(e)}`);
  }
  validateManifest(manifest);

  let onDisk;
  try {
    onDisk = collectRegularFiles(root);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${TOOL}:`)) throw e;
    fail(`cannot scan ${root}: ${errMsg(e)}`);
  }
  const diskByPath = new Map(onDisk.map((f) => [f.rel, f]));
  const manifestByPath = new Map(manifest.files.map((f) => [f.path, f]));
  const missing = [...manifestByPath.keys()].filter((p) => !diskByPath.has(p)).sort();
  const extra = [...diskByPath.keys()].filter((p) => !manifestByPath.has(p)).sort();
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected: ${extra.join(', ')}`);
    fail(`file set mismatch in ${root} (${parts.join('; ')})`);
  }
  for (const f of manifest.files) {
    const found = diskByPath.get(f.path);
    if (found.size !== f.size) {
      fail(`size mismatch ${f.path}: manifest ${f.size}, disk ${found.size}`);
    }
    const actual = sha256File(found.abs);
    if (actual !== f.sha256.toLowerCase()) {
      fail(`hash mismatch ${f.path}: manifest ${f.sha256.toLowerCase()}, disk ${actual}`);
    }
  }
  const actualTree = treeDigest(manifest.files);
  if (actualTree !== manifest.runtimeTreeSha256.toLowerCase()) {
    fail(`tree digest mismatch: manifest ${manifest.runtimeTreeSha256.toLowerCase()}, computed ${actualTree}`);
  }
  return { rootDir: root, manifestPath: manifestFile, manifest, fileCount: manifest.files.length };
}

const invokedAsCli =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  try {
    const r = verifyCurrentRelease(
      process.argv[2] ?? join(repoRoot(), 'release', 'current'),
      process.argv[3],
    );
    console.log(`${TOOL}: ok (${r.fileCount} files, tree ${r.manifest.runtimeTreeSha256.toLowerCase()})`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
