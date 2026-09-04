/* ============================================================================
 * TEXT-INPUT KEY POLICY - the pure half of shell.ts's makeTextInput.
 *
 * Kept DOM-free and pixi-free ON PURPOSE so a gate can drive it headlessly
 * (src/scenes/selftest-textinput.ts). The bug this module exists to make
 * un-repeatable: the window keydown hook classified Ctrl+V as ordinary text,
 * so pasting an invite code typed a literal 'v' and preventDefault() ate the
 * browser's paste event. A 1-char code then failed landing's `length >= 3`
 * guard in silence - JOIN looked dead, and multiplayer looked broken while
 * both transports were healthy.
 * ==========================================================================*/

export type KeyAction =
  | { t: 'insert'; ch: string }
  | { t: 'backspace' }
  | { t: 'blur' }
  | { t: 'ignore' };

/** The slice of KeyboardEvent the policy reads. */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * What a keypress means to a focused field. `ignore` means "leave it to the
 * browser" - which is what lets Ctrl+V / Ctrl+C / Ctrl+A reach their native
 * handlers instead of being typed in as letters.
 */
export function classifyKey(e: KeyLike): KeyAction {
  /* A shortcut is not text. AltGr arrives as ctrl+alt and DOES produce
   * characters on many EU layouts, so only BARE ctrl/meta is a shortcut. */
  if ((e.ctrlKey === true || e.metaKey === true) && e.altKey !== true) return { t: 'ignore' };
  if (e.key === 'Backspace') return { t: 'backspace' };
  if (e.key === 'Escape') return { t: 'blur' };
  if (e.key.length === 1 && e.key >= ' ') return { t: 'insert', ch: e.key };
  return { t: 'ignore' };
}

/**
 * Clipboard text is arbitrary. An invite code copied out of a chat line
 * routinely carries a newline and padding, so strip control characters and
 * trim rather than rejecting the paste.
 */
export function cleanPasted(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/** Append `raw` to `value`, honouring the field's cap. */
export function applyPaste(value: string, raw: string, maxLength: number): string {
  const clean = cleanPasted(raw);
  if (!clean) return value;
  return (value + clean).slice(0, maxLength);
}
