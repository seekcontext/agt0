import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { parse as csvParse } from 'csv-parse/sync';
import {
  escapeLikePrefix,
  globToRegExp,
  isGlobPattern,
  normalizeGlobPattern,
  normalizeVirtualPath,
  parseFsTableOptions,
  pathMatchesAny,
  readFsLimits,
  sqlLikeLiteralPrefix,
  type FsTableOptions,
} from './fs-path.js';

/**
 * Register table-valued functions (fs_list, fs_text, fs_csv, fs_tsv, fs_jsonl).
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
  const stmtFilesByLike = helper.prepare(
    `SELECT path, size FROM _fs
     WHERE type = 'file' AND path LIKE ? ESCAPE '\\'
     ORDER BY path`,
  );
  const stmtAllFilesMeta = helper.prepare(
    `SELECT path, size FROM _fs WHERE type = 'file' ORDER BY path`,
  );
  const stmtFileMeta = helper.prepare(
    `SELECT path, size FROM _fs WHERE path = ? AND type = 'file'`,
  );

  const prevClose = db.close.bind(db);
  const origClose =
    (db as unknown as { _agt0_origClose?: () => DatabaseType })
      ._agt0_origClose ?? prevClose;
  (db as unknown as { _agt0_origClose: () => DatabaseType })._agt0_origClose =
    origClose;
  db.close = () => {
    try {
      helper.close();
    } catch {
      /* ignore */
    }
    return prevClose();
  };

  type DirEntry = {
    path: string;
    type: string;
    size: number;
    mode: number;
    mtime: string;
  };

  function readFileUtf8(path: string): string | null {
    const row = stmtReadFile.get(path, 'file') as
      | { content: Buffer | null }
      | undefined;
    if (!row || row.content === null) return null;
    return row.content.toString('utf-8');
  }

  function resolveFilesWithContent(
    pathPattern: string,
    opts: FsTableOptions,
  ): { path: string; text: string }[] {
    const limits = readFsLimits();
    const patternRaw = normalizeGlobPattern(pathPattern);
    const hasGlob = isGlobPattern(patternRaw);

    let metas: { path: string; size: number }[] = [];

    if (!hasGlob) {
      const literal = normalizeVirtualPath(patternRaw);
      const row = stmtFileMeta.get(literal) as
        | { path: string; size: number }
        | undefined;
      metas = row ? [row] : [];
    } else {
      const matcher = globToRegExp(patternRaw);
      const prefix = sqlLikeLiteralPrefix(patternRaw);
      const rows =
        prefix !== null
          ? (stmtFilesByLike.all(escapeLikePrefix(prefix) + '%') as {
              path: string;
              size: number;
            }[])
          : (stmtAllFilesMeta.all() as { path: string; size: number }[]);

      metas = rows.filter((r) =>
        matcher.test(normalizeVirtualPath(r.path)),
      );
    }

    metas = metas.filter((m) => !pathMatchesAny(m.path, opts.exclude));

    if (metas.length > limits.maxFiles) {
      throw new Error(
        `agt0 fs: matched ${metas.length} files, exceeds AGT0_FS_MAX_FILES (${limits.maxFiles})`,
      );
    }

    let total = 0;
    for (const m of metas) {
      if (m.size > limits.maxFileBytes) {
        throw new Error(
          `agt0 fs: file ${m.path} is ${m.size} bytes, exceeds AGT0_FS_MAX_FILE_BYTES (${limits.maxFileBytes})`,
        );
      }
      total += m.size;
      if (total > limits.maxTotalBytes) {
        throw new Error(
          `agt0 fs: total matched size exceeds AGT0_FS_MAX_TOTAL_BYTES (${limits.maxTotalBytes})`,
        );
      }
    }

    const out: { path: string; text: string }[] = [];
    for (const m of metas) {
      const text = readFileUtf8(m.path);
      if (text === null) continue;
      out.push({ path: m.path, text });
    }
    return out;
  }

  function parseDelimited(
    text: string,
    opts: FsTableOptions,
  ): Record<string, string>[] {
    try {
      if (!opts.header) {
        const rows = csvParse(text, {
          columns: false,
          skip_empty_lines: true,
          trim: true,
          delimiter: opts.delimiter,
        }) as string[][];
        return rows.map((row) => {
          const o: Record<string, string> = {};
          for (let j = 0; j < row.length; j++) {
            o[`column_${j + 1}`] = row[j] ?? '';
          }
          return o;
        });
      }
      return csvParse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: opts.delimiter,
      }) as Record<string, string>[];
    } catch (e) {
      if (opts.strict) {
        throw new Error(
          `agt0 fs: delimited parse error (${opts.delimiter === '\t' ? 'tsv' : 'csv'}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const lines = text.split('\n').filter((l) => l.trim());
      return lines.map((line) => ({ _raw: line }));
    }
  }

  function unionKeysFromRecords(
    byFile: { path: string; records: Record<string, string>[] }[],
  ): string[] {
    const keys = new Set<string>();
    for (const f of byFile) {
      for (const r of f.records) {
        for (const k of Object.keys(r)) {
          keys.add(k);
        }
      }
    }
    return [...keys].sort();
  }

  function* yieldDelimitedRows(
    files: { path: string; text: string }[],
    opts: FsTableOptions,
  ): Generator<{
    _line_number: number;
    _path: string;
    _data: string;
  }> {
    const parsed = files.map((f) => ({
      path: f.path,
      records: parseDelimited(f.text, opts),
    }));
    const keyOrder = unionKeysFromRecords(parsed);
    for (const { path, records } of parsed) {
      for (let i = 0; i < records.length; i++) {
        const row: Record<string, string | null> = {};
        for (const k of keyOrder) {
          row[k] = records[i][k] ?? null;
        }
        yield {
          _line_number: i + 1,
          _path: path,
          _data: JSON.stringify(row),
        };
      }
    }
  }

  // fs_list: directory listing
  db.table('fs_list', {
    columns: ['path', 'type', 'size', 'mode', 'mtime'],
    parameters: ['dir_path'],
    *rows(...params: unknown[]) {
      const dirPath = normalizeVirtualPath(String(params[0]));
      const normalized =
        dirPath.endsWith('/') && dirPath !== '/'
          ? dirPath.slice(0, -1) || '/'
          : dirPath;

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

  const tvfParams = ['path_pattern', 'options'] as const;

  db.table('fs_text', {
    columns: ['_line_number', 'line', '_path'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const opts = parseFsTableOptions(params[1]);
      const files = resolveFilesWithContent(pathPattern, opts);
      for (const file of files) {
        const lines = file.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === '' && i === lines.length - 1) continue;
          yield { _line_number: i + 1, line: lines[i], _path: file.path };
        }
      }
    },
  });

  db.table('fs_csv', {
    columns: ['_line_number', '_path', '_data'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const opts = parseFsTableOptions(params[1]);
      const merged = { ...opts, delimiter: opts.delimiter || ',' };
      const files = resolveFilesWithContent(pathPattern, merged);
      yield* yieldDelimitedRows(files, merged);
    },
  });

  db.table('fs_tsv', {
    columns: ['_line_number', '_path', '_data'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const base = parseFsTableOptions(params[1]);
      const opts = { ...base, delimiter: '\t' };
      const files = resolveFilesWithContent(pathPattern, opts);
      yield* yieldDelimitedRows(files, opts);
    },
  });

  db.table('fs_jsonl', {
    columns: ['_line_number', 'line', '_path'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const opts = parseFsTableOptions(params[1]);
      const files = resolveFilesWithContent(pathPattern, opts);
      for (const file of files) {
        const lines = file.text.split('\n').filter((l) => l.trim());
        for (let i = 0; i < lines.length; i++) {
          try {
            JSON.parse(lines[i]);
            yield {
              _line_number: i + 1,
              line: lines[i],
              _path: file.path,
            };
          } catch (e) {
            if (opts.strict) {
              throw new Error(
                `agt0 fs: invalid JSONL at ${file.path}:${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
            yield {
              _line_number: i + 1,
              line: JSON.stringify(lines[i]),
              _path: file.path,
            };
          }
        }
      }
    },
  });
}
