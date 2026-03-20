import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { posix } from 'path';

function now(): string {
  return new Date().toISOString().replace('Z', '').slice(0, -3) + 'Z';
}

/**
 * Register fs_* scalar functions.
 *
 * better-sqlite3 forbids executing ANY SQL on the same connection inside a
 * custom scalar function ("This database connection is busy executing a query").
 * We work around this with a dedicated helper connection to the same file.
 * SQLite WAL mode supports concurrent reads + one writer across connections.
 */
export function registerScalarFunctions(db: DatabaseType): void {
  const dbPath: string = (db as unknown as { name: string }).name;
  const helper = new Database(dbPath);
  helper.pragma('journal_mode = WAL');

  // All statements used inside scalar functions go through `helper`
  const stmtReadFile = helper.prepare(
    'SELECT content FROM _fs WHERE path = ? AND type = ?',
  );
  const stmtUpsertFile = helper.prepare(
    `INSERT INTO _fs (path, type, content, size, mtime, ctime)
     VALUES (?, 'file', ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       content = excluded.content,
       size = excluded.size,
       mtime = excluded.mtime`,
  );
  const stmtUpsertDir = helper.prepare(
    `INSERT OR IGNORE INTO _fs (path, type, size, mtime, ctime)
     VALUES (?, 'dir', 0, ?, ?)`,
  );
  const stmtExists = helper.prepare('SELECT 1 FROM _fs WHERE path = ?');
  const stmtSize = helper.prepare('SELECT size FROM _fs WHERE path = ?');
  const stmtMtime = helper.prepare('SELECT mtime FROM _fs WHERE path = ?');
  const stmtDeleteOne = helper.prepare('DELETE FROM _fs WHERE path = ?');
  const stmtDeleteRecursive = helper.prepare(
    "DELETE FROM _fs WHERE path = ? OR path LIKE ? || '/%'",
  );

  const originalClose = db.close.bind(db);
  db.close = () => {
    try { helper.close(); } catch { /* ignore */ }
    return originalClose();
  };

  function ensureParentDirs(filePath: string): void {
    const parts = filePath.split('/').filter(Boolean);
    let current = '/';
    const ts = now();
    for (let i = 0; i < parts.length - 1; i++) {
      current = posix.join(current, parts[i]);
      stmtUpsertDir.run(current, ts, ts);
    }
  }

  db.function('fs_read', (path: unknown) => {
    if (typeof path !== 'string') return null;
    const row = stmtReadFile.get(path, 'file') as
      | { content: Buffer | null }
      | undefined;
    if (!row || row.content === null) return null;
    return row.content.toString('utf-8');
  });

  db.function('fs_write', (path: unknown, content: unknown) => {
    if (typeof path !== 'string' || content === null || content === undefined)
      return null;
    const data = Buffer.from(String(content), 'utf-8');
    const ts = now();
    ensureParentDirs(path);
    stmtUpsertFile.run(path, data, data.length, ts, ts);
    return data.length;
  });

  db.function('fs_append', (path: unknown, content: unknown) => {
    if (typeof path !== 'string' || content === null || content === undefined)
      return null;
    const existing = stmtReadFile.get(path, 'file') as
      | { content: Buffer | null }
      | undefined;
    const oldData = existing?.content ?? Buffer.alloc(0);
    const newData = Buffer.concat([
      oldData,
      Buffer.from(String(content), 'utf-8'),
    ]);
    const ts = now();
    ensureParentDirs(path);
    stmtUpsertFile.run(path, newData, newData.length, ts, ts);
    return newData.length;
  });

  db.function('fs_exists', (path: unknown) => {
    if (typeof path !== 'string') return 0;
    return stmtExists.get(path) ? 1 : 0;
  });

  db.function('fs_size', (path: unknown) => {
    if (typeof path !== 'string') return null;
    const row = stmtSize.get(path) as { size: number } | undefined;
    return row?.size ?? null;
  });

  db.function('fs_mtime', (path: unknown) => {
    if (typeof path !== 'string') return null;
    const row = stmtMtime.get(path) as { mtime: string } | undefined;
    return row?.mtime ?? null;
  });

  db.function('fs_remove', (path: unknown, recursive: unknown) => {
    if (typeof path !== 'string') return 0;
    if (recursive === 1 || recursive === true) {
      return stmtDeleteRecursive.run(path, path).changes;
    }
    return stmtDeleteOne.run(path).changes;
  });

  db.function('fs_mkdir', (path: unknown, recursive: unknown) => {
    if (typeof path !== 'string') return 0;
    const ts = now();
    if (recursive === 1 || recursive === true) {
      const parts = path.split('/').filter(Boolean);
      let current = '/';
      for (const part of parts) {
        current = posix.join(current, part);
        stmtUpsertDir.run(current, ts, ts);
      }
    } else {
      stmtUpsertDir.run(path, ts, ts);
    }
    return 1;
  });
}

// ── Programmatic API (used by CLI commands, not inside SQL functions) ──

export function fsWrite(
  db: DatabaseType,
  path: string,
  content: Buffer,
): void {
  const ts = now();
  ensureParentDirsProgrammatic(db, path);
  db.prepare(
    `INSERT INTO _fs (path, type, content, size, mtime, ctime)
     VALUES (?, 'file', ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       content = excluded.content,
       size = excluded.size,
       mtime = excluded.mtime`,
  ).run(path, content, content.length, ts, ts);
}

export function fsRead(
  db: DatabaseType,
  path: string,
): Buffer | null {
  const row = db
    .prepare('SELECT content FROM _fs WHERE path = ? AND type = ?')
    .get(path, 'file') as { content: Buffer | null } | undefined;
  return row?.content ?? null;
}

export interface FsEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  mode: number;
  mtime: string;
}

export function fsList(
  db: DatabaseType,
  dirPath: string,
): FsEntry[] {
  const normalized =
    dirPath.endsWith('/') ? dirPath.slice(0, -1) || '/' : dirPath;

  if (normalized === '/') {
    return db
      .prepare(
        `SELECT path, type, size, mode, mtime FROM _fs
         WHERE path != '/' AND path NOT LIKE '%/%/%'
         ORDER BY type DESC, path`,
      )
      .all() as FsEntry[];
  }

  const prefix = normalized + '/';
  return db
    .prepare(
      `SELECT path, type, size, mode, mtime FROM _fs
       WHERE path LIKE ? AND path NOT LIKE ?
       ORDER BY type DESC, path`,
    )
    .all(prefix + '%', prefix + '%/%') as FsEntry[];
}

function ensureParentDirsProgrammatic(
  db: DatabaseType,
  filePath: string,
): void {
  const parts = filePath.split('/').filter(Boolean);
  let current = '/';
  const ts = now();
  for (let i = 0; i < parts.length - 1; i++) {
    current = posix.join(current, parts[i]);
    db.prepare(
      `INSERT OR IGNORE INTO _fs (path, type, size, mtime, ctime)
       VALUES (?, 'dir', 0, ?, ?)`,
    ).run(current, ts, ts);
  }
}
