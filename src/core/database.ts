import { unlinkSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { dbPath, ensureHome, dbExists } from './config.js';
import { registerScalarFunctions } from './virtual-fs.js';
import { registerTableFunctions } from './table-functions.js';

const FS_SCHEMA = `
CREATE TABLE IF NOT EXISTS _fs (
  path     TEXT PRIMARY KEY,
  type     TEXT NOT NULL CHECK(type IN ('file', 'dir')),
  content  BLOB,
  size     INTEGER NOT NULL DEFAULT 0,
  mode     INTEGER NOT NULL DEFAULT 420,
  mtime    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ctime    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS _fs_type_idx ON _fs(type);
CREATE INDEX IF NOT EXISTS _fs_mtime_idx ON _fs(mtime);
`;

const MIGRATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS _migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  checksum   TEXT,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export function createDatabase(name: string): Database.Database {
  ensureHome();
  if (dbExists(name)) {
    throw new Error(`Database '${name}' already exists`);
  }
  const db = new Database(dbPath(name));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(FS_SCHEMA);
  db.exec(MIGRATIONS_SCHEMA);

  // Seed root directory
  db.prepare(
    `INSERT OR IGNORE INTO _fs (path, type, size) VALUES ('/', 'dir', 0)`,
  ).run();

  registerScalarFunctions(db);
  registerTableFunctions(db);
  return db;
}

export function openDatabase(name: string): Database.Database {
  if (!dbExists(name)) {
    throw new Error(
      `Database '${name}' not found. Run: agt0 init ${name}`,
    );
  }
  const db = new Database(dbPath(name));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Ensure system tables exist (forward-compatible upgrades)
  db.exec(FS_SCHEMA);
  db.exec(MIGRATIONS_SCHEMA);

  registerScalarFunctions(db);
  registerTableFunctions(db);
  return db;
}

export function deleteDatabase(name: string): void {
  if (!dbExists(name)) {
    throw new Error(`Database '${name}' not found`);
  }
  const p = dbPath(name);
  unlinkSync(p);
  if (existsSync(p + '-wal')) unlinkSync(p + '-wal');
  if (existsSync(p + '-shm')) unlinkSync(p + '-shm');
}
