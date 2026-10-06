/**
 * Minimal type declarations for Bun-only APIs used by server code
 * (bun:sqlite, import.meta.dir). The project has no @types/bun, so these
 * keep `tsc --noEmit` meaningful for the code we write. vite build does its
 * own transpile and never consults these.
 */

declare module "bun:sqlite" {
  export interface SQLiteQuery {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  }
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    query(sql: string): SQLiteQuery;
    close(): void;
  }
}

interface ImportMeta {
  dir: string;
}