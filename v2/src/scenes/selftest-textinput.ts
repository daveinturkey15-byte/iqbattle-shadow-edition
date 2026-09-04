/* ============================================================================
 * GATE: text-input key policy (src/scenes/textinput-keys.ts).
 *
 * Run: node --experimental-strip-types src/scenes/selftest-textinput.ts
 *
 * Guards the defect that made multiplayer look dead: Ctrl+V classified as
 * text. Falsified before being trusted - flipping the bare-ctrl guard in
 * classifyKey makes case "ctrl+v is not text" exit 1.
 * ==========================================================================*/

import { applyPaste, classifyKey, cleanPasted, type KeyAction } from './textinput-keys.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) return;
  failures++;
  console.error('FAIL: ' + name + (detail ? ' -- ' + detail : ''));
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, 'got ' + g + ', want ' + w);
}

/* ---- shortcuts are never text ------------------------------------------ */
const paste: KeyAction = classifyKey({ key: 'v', ctrlKey: true });
eq('ctrl+v is not text', paste, { t: 'ignore' });
eq('meta+v is not text', classifyKey({ key: 'v', metaKey: true }), { t: 'ignore' });
eq('ctrl+c is not text', classifyKey({ key: 'c', ctrlKey: true }), { t: 'ignore' });
eq('ctrl+a is not text', classifyKey({ key: 'a', ctrlKey: true }), { t: 'ignore' });

/* ---- ordinary typing still lands --------------------------------------- */
eq('plain letter inserts', classifyKey({ key: 'a' }), { t: 'insert', ch: 'a' });
eq('digit inserts', classifyKey({ key: '7' }), { t: 'insert', ch: '7' });
eq('space inserts', classifyKey({ key: ' ' }), { t: 'insert', ch: ' ' });
eq('backspace', classifyKey({ key: 'Backspace' }), { t: 'backspace' });
eq('escape blurs', classifyKey({ key: 'Escape' }), { t: 'blur' });
eq('enter is ignored', classifyKey({ key: 'Enter' }), { t: 'ignore' });
eq('arrow is ignored', classifyKey({ key: 'ArrowLeft' }), { t: 'ignore' });

/* AltGr reaches the page as ctrl+alt and DOES produce a character; treating
 * it as a shortcut would break EU layouts. */
eq('altgr still types', classifyKey({ key: '2', ctrlKey: true, altKey: true }), { t: 'insert', ch: '2' });

/* ---- paste cleaning ----------------------------------------------------- */
eq('trims padding', cleanPasted('  6UP6Y  '), '6UP6Y');
eq('drops newline', cleanPasted('6UP6Y\n'), '6UP6Y');
eq('drops tab + CR', cleanPasted('\t6UP6Y\r\n'), '6UP6Y');
eq('whitespace-only is empty', cleanPasted('   \n '), '');

eq('paste fills an empty field', applyPaste('', '6UP6Y', 5), '6UP6Y');
eq('paste honours the cap', applyPaste('', 'ABCDEFGH', 5), 'ABCDE');
eq('paste appends', applyPaste('6U', 'P6Y', 5), '6UP6Y');
eq('empty paste is a no-op', applyPaste('6U', '  ', 5), '6U');

/* The end-to-end shape of the original bug: a pasted 5-char code must NOT
 * collapse to the single letter 'v', which landing.ts rejects at length < 3. */
const typed = classifyKey({ key: 'v', ctrlKey: true });
const field = typed.t === 'insert' ? typed.ch : applyPaste('', '6UP6Y', 5);
check('pasted code survives to JOIN (>= 3 chars)', field.length >= 3, 'field=' + JSON.stringify(field));

if (failures > 0) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('selftest-textinput: OK');
