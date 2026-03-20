import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { parse as csvParse } from 'csv-parse/sync';

/**
 * Register table-valued functions (fs_list, fs_text, fs_csv, fs_jsonl).
 *
 * Same as scalar functions: all SQL inside generators must go through a
 * dedicated helper connection to avoid "busy" errors.
 */
export function registerTableFunctions(db: DatabaseType): void {
  const dbPath: string = (db as unknown as { name: string }).name;
  const helper = new Database(dbPath);
  helper.pragma('journal_mode = WAL');

  const stmtReadFile = helper.prepare(
    'SELECT content FROM _fs WHERE path = ? AND type = ?',
  );
  const stmtListRoot = helper.prepare(
    `SELECT path, type, size, mode, mtime FROM _fs
     WHERE path != '/'
     ORDER BY type DESC, path`,
  );
  const stmtListDir = helper.prepare(
    `SELECT path, type, size, mode, mtime FROM _fs
     WHERE path LIKE ? AND path != ?
     ORDER BY type DESC, path`,
  );
  const stmtGlobFiles = helper.prepare(
    `SELECT path, content FROM _fs
     WHERE path LIKE ? AND type = 'file'
     ORDER BY path`,
  );

  // Patch close to also close helper
  const prevClose = db.close.bind(db);
  const origClose = (db as unknown as { _agt0_origClose?: () => DatabaseType })._agt0_origClose ?? prevClose;
  (db as unknown as { _agt0_origClose: () => DatabaseType })._agt0_origClose = origClose;
  db.close = () => {
    try { helper.close(); } catch { /* ignore */ }
    return prevClose();
  };

  type FsRow = { path: string; content: Buffer | null };
  type DirEntry = {
    path: string; type: string; size: number; mode: number; mtime: string;
  };

  function readFileContent(path: string): string | null {
    const row = stmtReadFile.get(path, 'file') as
      | { content: Buffer | null }
      | undefined;
    if (!row || row.content === null) return null;
    return row.content.toString('utf-8');
  }

  function getMatchingFiles(pattern: string): FsRow[] {
    const sqlPattern = pattern.replace(/\*/g, '%').replace(/\?/g, '_');
    return stmtGlobFiles.all(sqlPattern) as FsRow[];
  }

  function resolveFiles(
    pathPattern: string,
  ): { path: string; text: string }[] {
    if (pathPattern.includes('*') || pathPattern.includes('?')) {
      return getMatchingFiles(pathPattern)
        .filter((f) => f.content !== null)
        .map((f) => ({
          path: f.path,
          text: Buffer.isBuffer(f.content)
            ? f.content!.toString('utf-8')
            : String(f.content),
        }));
    }
    const content = readFileContent(pathPattern);
    if (content === null) return [];
    return [{ path: pathPattern, text: content }];
  }

  // fs_list: directory listing
  db.table('fs_list', {
    columns: ['path', 'type', 'size', 'mode', 'mtime'],
    parameters: ['dir_path'],
    *rows(...params: unknown[]) {
      const dirPath = String(params[0]);
      const normalized =
        dirPath.endsWith('/') ? dirPath.slice(0, -1) || '/' : dirPath;

      const entries: DirEntry[] =
        normalized === '/'
          ? (stmtListRoot.all() as DirEntry[])
          : (stmtListDir.all(normalized + '/%', normalized) as DirEntry[]);

      for (const entry of entries) {
        yield {
          path: entry.path,
          type: entry.type,
          size: entry.size,
          mode: entry.mode,
          mtime: entry.mtime,
        };
      }
    },
  });

  // fs_text: read file(s) as text lines
  db.table('fs_text', {
    columns: ['_line_number', 'line', '_path'],
    parameters: ['path_pattern'],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const files = resolveFiles(pathPattern);
      for (const file of files) {
        const lines = file.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === '' && i === lines.length - 1) continue;
          yield { _line_number: i + 1, line: lines[i], _path: file.path };
        }
      }
    },
  });

  // fs_csv: read CSV file(s), each row returned with _data as JSON
  db.table('fs_csv', {
    columns: ['_line_number', '_path', '_data'],
    parameters: ['path_pattern'],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const files = resolveFiles(pathPattern);
      for (const file of files) {
        try {
          const records = csvParse(file.text, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }) as Record<string, string>[];
          for (let i = 0; i < records.length; i++) {
            yield {
              _line_number: i + 1,
              _path: file.path,
              _data: JSON.stringify(records[i]),
            };
          }
        } catch {
          const lines = file.text.split('\n').filter((l) => l.trim());
          for (let i = 0; i < lines.length; i++) {
            yield {
              _line_number: i + 1,
              _path: file.path,
              _data: lines[i],
            };
          }
        }
      }
    },
  });

  // fs_jsonl: read JSONL file(s)
  db.table('fs_jsonl', {
    columns: ['_line_number', 'line', '_path'],
    parameters: ['path_pattern'],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const files = resolveFiles(pathPattern);
      for (const file of files) {
        const lines = file.text.split('\n').filter((l) => l.trim());
        for (let i = 0; i < lines.length; i++) {
          let parsed: string;
          try {
            JSON.parse(lines[i]);
            parsed = lines[i];
          } catch {
            parsed = JSON.stringify(lines[i]);
          }
          yield { _line_number: i + 1, line: parsed, _path: file.path };
        }
      }
    },
  });
}
