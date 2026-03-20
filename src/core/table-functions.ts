import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
  readFsMaxRows,
  readFsParseChunkBytes,
  readFsPreviewBytes,
  sqlLikeLiteralPrefix,
  type FsTableOptions,
} from './fs-path.js';

type CsvTransformFn = (opts: Record<string, unknown>) => {
  parse: (
    nextBuf: Buffer | undefined,
    end: boolean,
    push: (record: unknown) => void,
    close: () => void,
  ) => Error | undefined;
};

let cachedCsvTransform: CsvTransformFn | null = null;

/** csv-parse does not export `transform` in package exports; load via package root (sync). */
function getCsvTransform(): CsvTransformFn {
  if (cachedCsvTransform) return cachedCsvTransform;
  const require = createRequire(import.meta.url);
  const resolved = require.resolve('csv-parse/sync');
  let dir = dirname(resolved);
  for (let i = 0; i < 10; i++) {
    try {
      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: string;
      };
      if (pkg.name === 'csv-parse') {
        const apiPath = join(dir, 'lib', 'api', 'index.js');
        cachedCsvTransform = require(apiPath).transform as CsvTransformFn;
        return cachedCsvTransform;
      }
    } catch {
      /* keep walking */
    }
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  throw new Error('agt0: failed to load csv-parse incremental parser');
}

type DelimitedOpts = FsTableOptions & { delimiter: string };

type FileMeta = { path: string; size: number };

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

  function readFileBuffer(path: string): Buffer | null {
    const row = stmtReadFile.get(path, 'file') as
      | { content: Buffer | null }
      | undefined;
    if (!row || row.content === null) return null;
    return row.content;
  }

  function resolveMatchedFileMetas(
    pathPattern: string,
    opts: FsTableOptions,
  ): FileMeta[] {
    const limits = readFsLimits();
    const patternRaw = normalizeGlobPattern(pathPattern);
    const hasGlob = isGlobPattern(patternRaw);

    let metas: FileMeta[] = [];

    if (!hasGlob) {
      const literal = normalizeVirtualPath(patternRaw);
      const row = stmtFileMeta.get(literal) as FileMeta | undefined;
      metas = row ? [row] : [];
    } else {
      const matcher = globToRegExp(patternRaw);
      const prefix = sqlLikeLiteralPrefix(patternRaw);
      const rows =
        prefix !== null
          ? (stmtFilesByLike.all(escapeLikePrefix(prefix) + '%') as FileMeta[])
          : (stmtAllFilesMeta.all() as FileMeta[]);

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

    return metas;
  }

  function assertUnderRowLimit(emitted: { n: number }, max: number | null) {
    if (max === null) return;
    if (emitted.n > max) {
      throw new Error(
        `agt0 fs: row limit exceeded AGT0_FS_MAX_ROWS (${max}); narrow the query or raise the limit`,
      );
    }
  }

  /** UTF-8 lines; supports \n and \r\n (no trailing segment after final \n). */
  function* iterateUtf8Lines(buf: Buffer): Generator<string> {
    let lineStart = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        let end = i;
        if (end > lineStart && buf[end - 1] === 0x0d) {
          end -= 1;
        }
        yield buf.subarray(lineStart, end).toString('utf8');
        lineStart = i + 1;
      }
    }
    if (lineStart < buf.length) {
      yield buf.subarray(lineStart).toString('utf8');
    }
  }

  /**
   * Same segments as `buf.toString('utf8').split('\n')` for valid UTF-8 (incl. trailing empty when the file ends with \n).
   */
  function* iterateUtf8LinesLikeSplit(buf: Buffer): Generator<string> {
    if (buf.length === 0) return;
    let lineStart = 0;
    for (let i = 0; i <= buf.length; i++) {
      if (i < buf.length && buf[i] !== 0x0a) continue;
      let end = i;
      if (end > lineStart && buf[end - 1] === 0x0d) {
        end -= 1;
      }
      yield buf.subarray(lineStart, end).toString('utf8');
      lineStart = i + 1;
    }
  }

  /** fs_text: match prior split('\\n') + skip final empty line. */
  function* yieldFsTextRows(path: string, buf: Buffer): Generator<{
    _line_number: number;
    line: string;
    _path: string;
  }> {
    if (buf.length === 0) return;
    let lineNo = 0;
    let prev: string | undefined;
    for (const line of iterateUtf8LinesLikeSplit(buf)) {
      if (prev !== undefined) {
        lineNo += 1;
        yield { _line_number: lineNo, line: prev, _path: path };
      }
      prev = line;
    }
    if (prev !== undefined) {
      const trailingEmpty = prev === '' && buf[buf.length - 1] === 0x0a;
      if (!trailingEmpty) {
        lineNo += 1;
        yield { _line_number: lineNo, line: prev, _path: path };
      }
    }
  }

  function addKeysFromDelimitedRecord(
    record: Record<string, string> | string[],
    opts: DelimitedOpts,
    keySet: Set<string>,
  ) {
    if (!opts.header) {
      const row = record as string[];
      for (let j = 0; j < row.length; j++) {
        keySet.add(`column_${j + 1}`);
      }
    } else {
      for (const k of Object.keys(record as Record<string, string>)) {
        keySet.add(k);
      }
    }
  }

  function jsonFromDelimitedRecord(
    record: Record<string, string> | string[],
    opts: DelimitedOpts,
    keyOrder: string[],
  ): string {
    const row: Record<string, string | null> = {};
    if (!opts.header) {
      const arr = record as string[];
      for (const k of keyOrder) {
        const idx = Number(k.slice(8)) - 1;
        row[k] = arr[idx] ?? null;
      }
    } else {
      const obj = record as Record<string, string>;
      for (const k of keyOrder) {
        row[k] = obj[k] ?? null;
      }
    }
    return JSON.stringify(row);
  }

  function keysFromDelimitedPreview(
    preview: Buffer,
    opts: DelimitedOpts,
  ): string[] {
    const common = {
      skip_empty_lines: true,
      trim: true,
      delimiter: opts.delimiter,
      relax_column_count: true,
    };
    try {
      if (!opts.header) {
        const rows = csvParse(preview, {
          ...common,
          columns: false,
          to: 1,
        }) as string[][];
        if (!rows[0]) return [];
        return rows[0].map((_, j) => `column_${j + 1}`);
      }
      const rows = csvParse(preview, {
        ...common,
        columns: true,
        to: 1,
      }) as Record<string, string>[];
      if (!rows[0]) return [];
      return Object.keys(rows[0]).sort();
    } catch {
      return [];
    }
  }

  function unionKeysFromFilePreviews(
    metas: FileMeta[],
    opts: DelimitedOpts,
    previewBytes: number,
  ): string[] {
    const keys = new Set<string>();
    for (const m of metas) {
      const buf = readFileBuffer(m.path);
      if (!buf) continue;
      const slice = buf.subarray(0, Math.min(buf.length, previewBytes));
      const ks = keysFromDelimitedPreview(slice, opts);
      for (const k of ks) keys.add(k);
    }
    return [...keys].sort();
  }

  function parseDelimitedBufferChunked(
    buffer: Buffer,
    opts: DelimitedOpts,
    chunkSize: number,
    onRecord: (record: Record<string, string> | string[]) => void,
  ): void {
    const parser = getCsvTransform()({
      columns: opts.header,
      skip_empty_lines: true,
      trim: true,
      delimiter: opts.delimiter,
    });
    const push = (record: unknown) => {
      onRecord(record as Record<string, string> | string[]);
    };
    const close = () => {};
    for (let off = 0; off < buffer.length; off += chunkSize) {
      const end = Math.min(off + chunkSize, buffer.length);
      const err = parser.parse(buffer.subarray(off, end), false, push, close);
      if (err !== undefined) {
        throw err;
      }
    }
    const err = parser.parse(undefined, true, push, close);
    if (err !== undefined) {
      throw err;
    }
  }

  /**
   * Parse one file's delimited content. Does not retain all rows in memory at once during
   * CSV parsing (chunked incremental parse); output array is built row-by-row (still O(rows)
   * for the returned objects, which SQLite consumes incrementally from the generator).
   */
  function collectDelimitedRowsForFile(
    path: string,
    buffer: Buffer,
    opts: DelimitedOpts,
    initialKeys: string[] | null,
    chunkSize: number,
    emitted: { n: number },
    maxRows: number | null,
  ): { _line_number: number; _path: string; _data: string }[] {
    const startEmitted = emitted.n;
    const out: { _line_number: number; _path: string; _data: string }[] = [];
    const keySet = new Set<string>(initialKeys ?? []);
    let keyOrder: string[] = initialKeys ? [...initialKeys].sort() : [];

    try {
      parseDelimitedBufferChunked(buffer, opts, chunkSize, (record) => {
        if (initialKeys === null) {
          addKeysFromDelimitedRecord(record, opts, keySet);
          keyOrder = [...keySet].sort();
        }
        emitted.n += 1;
        assertUnderRowLimit(emitted, maxRows);
        out.push({
          _line_number: out.length + 1,
          _path: path,
          _data: jsonFromDelimitedRecord(record, opts, keyOrder),
        });
      });
      return out;
    } catch (e) {
      if (opts.strict) {
        throw e instanceof Error
          ? e
          : new Error(`agt0 fs: delimited parse error: ${String(e)}`);
      }
      emitted.n = startEmitted;
      let i = 0;
      for (const line of iterateUtf8Lines(buffer)) {
        if (!line.trim()) continue;
        i += 1;
        emitted.n += 1;
        assertUnderRowLimit(emitted, maxRows);
        out.push({
          _line_number: i,
          _path: path,
          _data: JSON.stringify({ _raw: line }),
        });
      }
      return out;
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
      const metas = resolveMatchedFileMetas(pathPattern, opts);
      const maxRows = readFsMaxRows();
      const emitted = { n: 0 };
      for (const m of metas) {
        const buf = readFileBuffer(m.path);
        if (!buf) continue;
        for (const row of yieldFsTextRows(m.path, buf)) {
          emitted.n += 1;
          assertUnderRowLimit(emitted, maxRows);
          yield row;
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
      const metas = resolveMatchedFileMetas(pathPattern, merged);
      const chunkSize = readFsParseChunkBytes();
      const previewBytes = readFsPreviewBytes();
      const maxRows = readFsMaxRows();
      const emitted = { n: 0 };
      let initialKeys: string[] | null =
        metas.length > 1
          ? unionKeysFromFilePreviews(metas, merged, previewBytes)
          : null;
      if (initialKeys !== null && initialKeys.length === 0) {
        initialKeys = null;
      }

      for (const m of metas) {
        const buf = readFileBuffer(m.path);
        if (!buf) continue;
        const rows = collectDelimitedRowsForFile(
          m.path,
          buf,
          merged,
          initialKeys,
          chunkSize,
          emitted,
          maxRows,
        );
        for (const r of rows) {
          yield r;
        }
      }
    },
  });

  db.table('fs_tsv', {
    columns: ['_line_number', '_path', '_data'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const base = parseFsTableOptions(params[1]);
      const opts = { ...base, delimiter: '\t' };
      const metas = resolveMatchedFileMetas(pathPattern, opts);
      const chunkSize = readFsParseChunkBytes();
      const previewBytes = readFsPreviewBytes();
      const maxRows = readFsMaxRows();
      const emitted = { n: 0 };
      let initialKeys: string[] | null =
        metas.length > 1
          ? unionKeysFromFilePreviews(metas, opts, previewBytes)
          : null;
      if (initialKeys !== null && initialKeys.length === 0) {
        initialKeys = null;
      }

      for (const m of metas) {
        const buf = readFileBuffer(m.path);
        if (!buf) continue;
        const rows = collectDelimitedRowsForFile(
          m.path,
          buf,
          opts,
          initialKeys,
          chunkSize,
          emitted,
          maxRows,
        );
        for (const r of rows) {
          yield r;
        }
      }
    },
  });

  db.table('fs_jsonl', {
    columns: ['_line_number', 'line', '_path'],
    parameters: [...tvfParams],
    *rows(...params: unknown[]) {
      const pathPattern = String(params[0]);
      const opts = parseFsTableOptions(params[1]);
      const metas = resolveMatchedFileMetas(pathPattern, opts);
      const maxRows = readFsMaxRows();
      const emitted = { n: 0 };
      for (const m of metas) {
        const buf = readFileBuffer(m.path);
        if (!buf) continue;
        let i = 0;
        for (const line of iterateUtf8Lines(buf)) {
          if (!line.trim()) continue;
          i += 1;
          emitted.n += 1;
          assertUnderRowLimit(emitted, maxRows);
          try {
            JSON.parse(line);
            yield {
              _line_number: i,
              line,
              _path: m.path,
            };
          } catch (e) {
            if (opts.strict) {
              throw new Error(
                `agt0 fs: invalid JSONL at ${m.path}:${i}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
            yield {
              _line_number: i,
              line: JSON.stringify(line),
              _path: m.path,
            };
          }
        }
      }
    },
  });
}
