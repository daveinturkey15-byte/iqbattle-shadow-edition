/**
 * Ambient declarations for the handful of platform APIs the gauntlet runners
 * use. Kept local (`types: []` in tsconfig.json) so the gauntlet never touches
 * v2/package.json and stays independent of @types/node availability.
 *
 * Execution model: plain `node <runner>.ts` (Node ≥23.6 strips TS types
 * natively; runners are ESM like the rest of v2).
 */

declare const process: {
  /** Terminate with an exit code (gauntlet gates). */
  exit(code?: number): never;
  /** Set instead of calling exit() so stdout flushes naturally. */
  exitCode: number;
};

/** Provided natively by Node ≥21.2 (here: the runner module's directory). */
interface ImportMeta {
  url: string;
  dirname: string;
}

declare module 'path' {
  export function join(...segments: string[]): string;
}

declare module 'fs' {
  /** Names of the entries directly inside `path`. Throws if unreachable. */
  export function readdirSync(path: string): string[];
}
