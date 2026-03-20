/**
 * CLI-side SQL rewrite: expand fs_csv / fs_tsv / fs_jsonl TVF calls with a literal
 * single-file path into a subquery that projects JSON fields as real columns
 * (so `SELECT *` sees header names). Globs and non-literal paths are left unchanged.
 *
 * Disable with AGT0_SQL_FS_EXPAND=0.
 */

import { parse as csvParse } from 'csv-parse/sync';
import type { Database as DatabaseType } from 'better-sqlite3';
import { fsRead } from './virtual-fs.js';
import {
  isGlobPattern,
  normalizeGlobPattern,
  normalizeVirtualPath,
  parseFsTableOptions,
  readFsExpandJsonlScanLines,
  readFsPreviewBytes,
  type FsTableOptions,
} from './fs-path.js';

export type FsTableExpandName = 'fs_csv' | 'fs_tsv' | 'fs_jsonl';

const TVF_NAMES: readonly FsTableExpandName[] = [
  'fs_csv',
  'fs_tsv',
  'fs_jsonl',
] as const;

export function isSqlFsExpandEnabled(): boolean {
  const v = process.env.AGT0_SQL_FS_EXPAND;
  if (v === undefined || v === '') return true;
  const s = v.trim().toLowerCase();
  return s !== '0' && s !== 'false' && s !== 'no' && s !== 'off';
}

function sqlSingleQuotedLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * SQLite json_extract path literal. Uses `$.ident` for simple keys (matches fs_csv JSON keys).
 * For other keys uses SQLite's double-quoted label form `$."label"` (see sqlite.org/json1.html).
 */
export function sqliteJsonPathLiteralForKey(key: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    return sqlSingleQuotedLiteral(`$.${key}`);
  }
  const esc = key.replace(/"/g, '""');
  return sqlSingleQuotedLiteral(`$."${esc}"`);
}

export function sqliteDoubleQuotedIdentifier(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}

type DelimitedPreviewOpts = FsTableOptions & { delimiter: string };

function keysFromDelimitedPreview(
  preview: Buffer,
  opts: DelimitedPreviewOpts,
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

function unionKeysFromJsonlBuffer(buf: Buffer, maxLines: number): string[] {
  const keys = new Set<string>();
  let seen = 0;
  let lineStart = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i < buf.length && buf[i] !== 0x0a) continue;
    let end = i;
    if (end > lineStart && buf[end - 1] === 0x0d) end -= 1;
    const line = buf.subarray(lineStart, end).toString('utf8').trim();
    lineStart = i + 1;
    if (!line) continue;
    seen += 1;
    if (seen > maxLines) break;
    try {
      const o = JSON.parse(line) as unknown;
      if (o !== null && typeof o === 'object' && !Array.isArray(o)) {
        for (const k of Object.keys(o as Record<string, unknown>)) {
          keys.add(k);
        }
      }
    } catch {
      /* skip */
    }
  }
  return [...keys].sort();
}

const RESERVED_EXPAND_COLS = new Set([
  '_line_number',
  '_path',
  '_data',
  'line',
]);

function sanitizeOutputColumnNames(rawKeys: string[]): string[] {
  const used = new Set<string>(['_line_number', '_path']);
  const out: string[] = [];
  for (let i = 0; i < rawKeys.length; i++) {
    let base = rawKeys[i].trim();
    if (!base) base = `column_${i + 1}`;
    if (RESERVED_EXPAND_COLS.has(base)) {
      base = `field_${base}`;
    }
    let name = base;
    let n = 0;
    while (used.has(name)) {
      n += 1;
      name = `${base}_${n}`;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

/** Parse SQL single-quoted literal starting at opening quote index; returns value and index after closing quote. */
export function parseSqlSingleQuotedString(
  sql: string,
  openQuoteIdx: number,
): { value: string; end: number } | null {
  if (sql[openQuoteIdx] !== "'") return null;
  let i = openQuoteIdx + 1;
  let out = '';
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      if (sql[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    out += c;
    i += 1;
  }
  return null;
}

/** Find index of `)` matching `(` at openIdx; respects strings and SQL comments. Returns -1 if unbalanced. */
export function findMatchingClosingParen(sql: string, openIdx: number): number {
  if (sql[openIdx] !== '(') return -1;
  let depth = 1;
  let i = openIdx + 1;
  let state: 'code' | 'sq' | 'dq' | 'line' | 'block' = 'code';
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (state === 'line') {
      if (c === '\n' || c === '\r') state = 'code';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'sq') {
      if (c === "'") {
        if (next === "'") {
          i += 2;
          continue;
        }
        state = 'code';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'dq') {
      if (c === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        state = 'code';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (c === '-' && next === '-') {
      state = 'line';
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      state = 'block';
      i += 2;
      continue;
    }
    if (c === "'") {
      state = 'sq';
      i += 1;
      continue;
    }
    if (c === '"') {
      state = 'dq';
      i += 1;
      continue;
    }
    if (c === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

function isIdentChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}

/** Find fs_csv/fs_tsv/fs_jsonl( calls (name + open paren index). May include false positives filtered later. */
export function findExpandableTvfCalls(sql: string): Array<{
  name: FsTableExpandName;
  nameStart: number;
  openParen: number;
}> {
  const out: Array<{
    name: FsTableExpandName;
    nameStart: number;
    openParen: number;
  }> = [];

  let state: 'code' | 'sq' | 'dq' | 'line' | 'block' = 'code';
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (state === 'line') {
      if (c === '\n' || c === '\r') state = 'code';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'sq') {
      if (c === "'") {
        if (next === "'") {
          i += 2;
          continue;
        }
        state = 'code';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'dq') {
      if (c === '"') {
        if (next === '"') {
          i += 2;
          continue;
        }
        state = 'code';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (c === '-' && next === '-') {
      state = 'line';
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      state = 'block';
      i += 2;
      continue;
    }
    if (c === "'") {
      state = 'sq';
      i += 1;
      continue;
    }
    if (c === '"') {
      state = 'dq';
      i += 1;
      continue;
    }

    let matched: FsTableExpandName | null = null;
    let nameStart = i;
    for (const name of TVF_NAMES) {
      if (sql.startsWith(name, i)) {
        const prev = i > 0 ? sql[i - 1] : ' ';
        if (isIdentChar(prev)) break;
        const after = sql[i + name.length];
        if (after !== undefined && isIdentChar(after)) break;
        matched = name;
        nameStart = i;
        i += name.length;
        break;
      }
    }

    if (matched) {
      while (i < sql.length && /\s/.test(sql[i])) i += 1;
      if (i < sql.length && sql[i] === '(') {
        out.push({ name: matched, nameStart, openParen: i });
      }
      continue;
    }

    i += 1;
  }

  return out;
}

function buildDelimitedExpandSubquery(
  fullCallSlice: string,
  rawKeys: string[],
  sanitized: string[],
): string {
  const parts: string[] = ['SELECT _line_number, _path'];
  for (let k = 0; k < rawKeys.length; k++) {
    const pathLit = sqliteJsonPathLiteralForKey(rawKeys[k]);
    const alias = sqliteDoubleQuotedIdentifier(sanitized[k]);
    parts.push(`, json_extract(_data, ${pathLit}) AS ${alias}`);
  }
  parts.push(` FROM ${fullCallSlice}`);
  return '(' + parts.join('') + ')';
}

function buildJsonlExpandSubquery(
  fullCallSlice: string,
  rawKeys: string[],
  sanitized: string[],
): string {
  const parts: string[] = ['SELECT _line_number, _path'];
  for (let k = 0; k < rawKeys.length; k++) {
    const pathLit = sqliteJsonPathLiteralForKey(rawKeys[k]);
    const alias = sqliteDoubleQuotedIdentifier(sanitized[k]);
    parts.push(`, json_extract(line, ${pathLit}) AS ${alias}`);
  }
  parts.push(` FROM ${fullCallSlice}`);
  return '(' + parts.join('') + ')';
}

function tryExpandOneCall(
  db: DatabaseType,
  sql: string,
  name: FsTableExpandName,
  nameStart: number,
  openParen: number,
): { start: number; end: number; replacement: string } | null {
  const closeIdx = findMatchingClosingParen(sql, openParen);
  if (closeIdx < 0) return null;

  let i = openParen + 1;
  while (i < closeIdx && /\s/.test(sql[i])) i += 1;
  if (i >= closeIdx || sql[i] !== "'") return null;
  const pathParsed = parseSqlSingleQuotedString(sql, i);
  if (!pathParsed) return null;

  const vfsPath = normalizeVirtualPath(pathParsed.value);
  if (isGlobPattern(normalizeGlobPattern(vfsPath))) return null;

  const buf = fsRead(db, vfsPath);
  if (!buf || buf.length === 0) return null;

  let j = pathParsed.end;
  while (j < closeIdx && /\s/.test(sql[j])) j += 1;
  let parsedOpts = parseFsTableOptions(undefined);
  if (j < closeIdx) {
    if (sql[j] !== ',') return null;
    j += 1;
    while (j < closeIdx && /\s/.test(sql[j])) j += 1;
    if (j >= closeIdx || sql[j] !== "'") return null;
    const optParsed = parseSqlSingleQuotedString(sql, j);
    if (!optParsed) return null;
    parsedOpts = parseFsTableOptions(optParsed.value);
    j = optParsed.end;
    while (j < closeIdx && /\s/.test(sql[j])) j += 1;
  }
  if (j !== closeIdx) return null;

  const fullCallEnd = closeIdx + 1;
  const fullCallSlice = sql.slice(nameStart, fullCallEnd);

  if (name === 'fs_jsonl') {
    const scanLines = readFsExpandJsonlScanLines();
    const rawKeys = unionKeysFromJsonlBuffer(buf, scanLines);
    if (rawKeys.length === 0) return null;
    const sanitized = sanitizeOutputColumnNames(rawKeys);
    return {
      start: nameStart,
      end: fullCallEnd,
      replacement: buildJsonlExpandSubquery(
        fullCallSlice,
        rawKeys,
        sanitized,
      ),
    };
  }

  const delimiter = name === 'fs_tsv' ? '\t' : parsedOpts.delimiter || ',';
  const merged: DelimitedPreviewOpts = { ...parsedOpts, delimiter };
  const previewBytes = readFsPreviewBytes();
  const slice = buf.subarray(0, Math.min(buf.length, previewBytes));
  const rawKeys = keysFromDelimitedPreview(slice, merged);
  if (rawKeys.length === 0) return null;
  const sanitized = sanitizeOutputColumnNames(rawKeys);
  return {
    start: nameStart,
    end: fullCallEnd,
    replacement: buildDelimitedExpandSubquery(
      fullCallSlice,
      rawKeys,
      sanitized,
    ),
  };
}

/**
 * Rewrite fs_csv / fs_tsv / fs_jsonl TVF invocations that use a single literal
 * non-glob path into expanded subqueries. Other SQL is unchanged.
 */
export function expandFsTableSql(sql: string, db: DatabaseType): string {
  if (!isSqlFsExpandEnabled()) return sql;

  const calls = findExpandableTvfCalls(sql);
  if (calls.length === 0) return sql;

  const replacements: Array<{ start: number; end: number; replacement: string }> =
    [];
  for (const c of calls) {
    const r = tryExpandOneCall(db, sql, c.name, c.nameStart, c.openParen);
    if (r) replacements.push(r);
  }

  if (replacements.length === 0) return sql;

  replacements.sort((a, b) => b.start - a.start);
  let out = sql;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  return out;
}
