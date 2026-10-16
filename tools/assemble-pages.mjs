#!/usr/bin/env node
/* Assemble the dual-version Pages site. No building, no network fetching.
 *
 * Inputs (parent-produced): release/current/ + release/current-manifest.json
 * (frozen previously-live artifact, verified byte-exact), release/chooser.html
 * (root version picker), and the newer Vite output at runtime/omarchy/build/new
 * (built with --base /iqbattle-shadow-edition/new/).
 *
 * Output (gitignored runtime dir): runtime/omarchy/build/site/
 *   index.html        <- chooser (replaces the old root index)
 *   <retained files>  <- every release/current/ file except the top-level
 *                        index.html, kept at the original site root so the old
 *                        artifact's absolute /iqbattle-shadow-edition/assets
 *                        URLs keep working
 *   current/          <- whole retained dir, byte-exact (re-verified below)
 *   new/              <- newer build, byte-exact
 *   release.json      <- { revision, current: { sourceSha, runtimeTreeSha256,
 *                        deploymentId }, new: { base, status } }
 *
 * CLI: node tools/assemble-pages.mjs (no arguments; fixed lane paths).
 * Reruns delete only site/ itself. Fails on source/output overlap, symlink
 * ancestors, missing HTML, or a new build whose index.html lacks the expected
 * base. Exits 0 on success, 1 with a message on failure.
 *
 * CI staging only when GITHUB_ACTIONS === 'true' (postbuild in the existing
 * workflow): after all checks pass, cpSync site/ -> v2/dist, refusing when
 * v2/dist already exists. Local runs never touch v2/dist.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCurrentRelease } from './verify-current-release.mjs';

const TOOL = 'assemble-pages';
const EXPECTED_NEW_BASE = '/iqbattle-shadow-edition/new/';
const fail = (msg) => { throw new Error(`${TOOL}: ${msg}`); };

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CURRENT_DIR = join(ROOT, 'release', 'current');
const CHOOSER_FILE = join(ROOT, 'release', 'chooser.html');
const NEW_DIR = join(ROOT, 'runtime', 'omarchy', 'build', 'new');
const SITE_DIR = join(ROOT, 'runtime', 'omarchy', 'build', 'site');
const V2_DIST = join(ROOT, 'v2', 'dist');

/* True when a === b or b lives inside a. */
const contains = (a, b) => {
  const r = relative(a, b);
  return r === '' || (r !== '..' && !r.startsWith('../') && !isAbsolute(r));
};

function assertNoSymlinkAncestors(dir) {
  // A symlinked ancestor would redirect destructive writes below, so refuse first.
  let cur = resolve(dir);
  const stop = resolve(ROOT);
  while (true) {
    let st = null;
    try { st = lstatSync(cur); } catch { st = null; }
    if (st && st.isSymbolicLink()) fail(`symlink ancestor rejected: ${cur}`);
    if (cur === stop) break;
    const parent = dirname(cur);
    if (parent === cur) fail(`output escapes lane: ${dir}`);
    cur = parent;
  }
}

function assertSafeLayout() {
  if (!contains(ROOT, SITE_DIR) || SITE_DIR === ROOT) fail(`output escapes lane: ${SITE_DIR}`);
  for (const src of [CURRENT_DIR, NEW_DIR, CHOOSER_FILE]) {
    if (contains(src, SITE_DIR) || contains(SITE_DIR, src)) {
      fail(`source/output overlap: ${src} vs ${SITE_DIR}`);
    }
  }
  assertNoSymlinkAncestors(SITE_DIR);
  for (const src of [CURRENT_DIR, NEW_DIR]) {
    const st = lstatSync(src, { throwIfNoEntry: false });
    if (!st) fail(`missing input: ${src}`);
    if (st.isSymbolicLink()) fail(`symlink input rejected: ${src}`);
    if (!st.isDirectory()) fail(`not a directory: ${src}`);
  }
}

/* CI only (GITHUB_ACTIONS === 'true'): stage the verified site into v2/dist for
 * the existing Pages workflow (name guard + npm run build -> upload v2/dist).
 * Refuses when v2/dist already exists, so protected output is never overwritten. */
function stageDistForCi() {
  if (!contains(ROOT, V2_DIST) || V2_DIST === ROOT) fail(`staging escapes lane: ${V2_DIST}`);
  for (const src of [CURRENT_DIR, NEW_DIR, CHOOSER_FILE, SITE_DIR]) {
    if (contains(src, V2_DIST) || contains(V2_DIST, src)) {
      fail(`staging overlap: ${src} vs ${V2_DIST}`);
    }
  }
  assertNoSymlinkAncestors(V2_DIST);
  if (lstatSync(V2_DIST, { throwIfNoEntry: false })) {
    fail(`refusing to overwrite existing ${V2_DIST} (fresh CI checkout has no dist)`);
  }
  cpSync(SITE_DIR, V2_DIST, { recursive: true });
}

/* Byte-exact recursive copy; symlinks and special files are rejected. */
function copyTree(srcRoot, destRoot, skip) {
  let count = 0;
  const walk = (rel) => {
    const abs = rel ? join(srcRoot, rel) : srcRoot;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) fail(`symlink rejected in ${srcRoot}: ${rel || '.'}`);
    if (st.isDirectory()) {
      mkdirSync(rel ? join(destRoot, rel) : destRoot, { recursive: true });
      for (const name of readdirSync(abs).sort()) walk(rel ? `${rel}/${name}` : name);
      return;
    }
    if (!st.isFile()) fail(`not a regular file: ${abs}`);
    if (skip && skip(rel)) return;
    mkdirSync(dirname(join(destRoot, rel)), { recursive: true });
    copyFileSync(abs, join(destRoot, rel));
    count += 1;
  };
  walk('');
  return count;
}

function sourceRevision() {
  const fromEnv = (process.env.GITHUB_SHA ?? '').trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{40}$/.test(fromEnv)) fail(`bad GITHUB_SHA ${JSON.stringify(fromEnv)}`);
    return fromEnv.toLowerCase();
  }
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString('utf8').trim();
    if (!/^[0-9a-fA-F]{40}$/.test(out)) fail(`bad git revision ${JSON.stringify(out)}`);
    return out.toLowerCase();
  } catch {
    fail('cannot determine source revision (set GITHUB_SHA or run inside the git checkout)');
  }
  return '';
}

function main() {
  assertSafeLayout();

  // 1. The retained artifact must verify before anything is assembled.
  const { manifest, manifestPath } = verifyCurrentRelease(CURRENT_DIR);

  // 2. Newer build: must exist, must be HTML, must carry the expected base.
  let newIndex;
  try {
    newIndex = readFileSync(join(NEW_DIR, 'index.html'), 'utf8');
  } catch {
    fail(`new build is missing HTML: ${join(NEW_DIR, 'index.html')}`);
  }
  if (!newIndex) fail(`new build index.html is empty: ${NEW_DIR}`);
  if (!newIndex.includes(EXPECTED_NEW_BASE)) {
    fail(`new build index.html lacks expected base ${EXPECTED_NEW_BASE}: ${NEW_DIR}`);
  }

  // 3. Chooser becomes the site root index.
  let chooser;
  try {
    chooser = readFileSync(CHOOSER_FILE);
  } catch {
    fail(`missing chooser: ${CHOOSER_FILE}`);
  }
  if (chooser.length === 0) fail(`chooser is empty: ${CHOOSER_FILE}`);

  // 4. Rerun-safe: remove only our exact site output, then rebuild it.
  rmSync(SITE_DIR, { recursive: true, force: true });
  mkdirSync(join(SITE_DIR, 'current'), { recursive: true });
  mkdirSync(join(SITE_DIR, 'new'), { recursive: true });

  const rootKept = copyTree(CURRENT_DIR, SITE_DIR, (rel) => rel === 'index.html');
  const currentCopied = copyTree(CURRENT_DIR, join(SITE_DIR, 'current'));
  const newCopied = copyTree(NEW_DIR, join(SITE_DIR, 'new'));
  writeFileSync(join(SITE_DIR, 'index.html'), chooser);

  const release = {
    revision: sourceRevision(),
    current: {
      sourceSha: manifest.sourceSha,
      runtimeTreeSha256: manifest.runtimeTreeSha256,
      deploymentId: manifest.deploymentId,
    },
    new: { base: EXPECTED_NEW_BASE, status: 'experimental' },
  };
  writeFileSync(join(SITE_DIR, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);

  // 5. The old current/ subtree must still verify after the copy.
  verifyCurrentRelease(join(SITE_DIR, 'current'), manifestPath);

  // 6. CI only: after every check passes, stage the site for the existing
  // workflow. Local runs stop at site/ and never touch v2/dist.
  const ci = process.env.GITHUB_ACTIONS === 'true';
  if (ci) stageDistForCi();

  console.log(
    `${TOOL}: ok (root-kept ${rootKept}, current ${currentCopied}, new ${newCopied}, revision ${release.revision.slice(0, 12)}${ci ? ', staged v2/dist' : ''})`,
  );
}

const invokedAsCli =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
