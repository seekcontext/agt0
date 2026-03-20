/**
 * Virtual path normalization and glob to RegExp for POSIX-style VFS paths.
 *
 * Glob: star matches one segment; double-star matches across segments;
 * question mark matches one non-slash character.
 */

export function normalizeVirtualPath(input: string): string {
  if (!input || input === '/') return '/';
  let s = input.replace(/\/+/g, '/');
  if (s !== '/' && s.endsWith('/')) {
    s = s.slice(0, -1) || '/';
  }
  const stack: string[] = [];
  const parts = s.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..') {
      stack.pop();
    } else {
      stack.push(p);
    }
  }
  return '/' + stack.join('/');
}

/** Normalize a glob pattern path (collapse slashes; keep wildcard segments). */
export function normalizeGlobPattern(input: string): string {
  if (!input) return '/';
  return input.replace(/\/+/g, '/');
}

/**
 * Convert glob to anchored RegExp. Test against paths from normalizeVirtualPath().
 */
export function globToRegExp(pattern: string): RegExp {
  const n = normalizeGlobPattern(pattern);
  let out = '^';
  let i = 0;
  while (i < n.length) {
    const c = n[i];
    if (c === '*') {
      if (n[i + 1] === '*') {
        i += 2;
        if (i < n.length && n[i] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        i += 1;
        out += '[^/]*';
      }
    } else if (c === '?') {
      i += 1;
      out += '[^/]';
    } else if ('\\.^$+{}()|[]'.includes(c)) {
      out += '\\' + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return new RegExp(out + '$');
}

/**
 * Longest all-literal directory prefix for SQL LIKE prefilter (before JS glob).
 * Stops at the first glob token (** or * or ?).
 */
export function sqlLikeLiteralPrefix(pattern: string): string | null {
  const norm = normalizeGlobPattern(pattern);
  const m = /\*\*|[*?]/.exec(norm);
  if (!m) {
    return norm;
  }
  let prefix = norm.slice(0, m.index);
  const lastSlash = prefix.lastIndexOf('/');
  if (lastSlash >= 0) {
    prefix = prefix.slice(0, lastSlash + 1);
  } else {
    prefix = '';
  }
  return prefix.length > 0 ? prefix : null;
}

/** Make exclude globs match absolute VFS paths (relative patterns apply under any directory). */
export function toAbsoluteExcludeGlob(g: string): string {
  const t = g.trim();
  if (!t) return t;
  if (t.startsWith('/')) return t;
  return `**/${t}`;
}

/** Escape percent and underscore for SQL LIKE literal prefix. */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export type FsTableOptions = {
  exclude: RegExp[];
  strict: boolean;
  delimiter: string;
  header: boolean;
};

const DEFAULT_OPTS: FsTableOptions = {
  exclude: [],
  strict: false,
  delimiter: ',',
  header: true,
};

export function parseFsTableOptions(raw: unknown): FsTableOptions {
  if (raw === null || raw === undefined || raw === '') {
    return { ...DEFAULT_OPTS, exclude: [] };
  }
  const s = String(raw).trim();
  if (!s) {
    return { ...DEFAULT_OPTS, exclude: [] };
  }
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    const out: FsTableOptions = {
      exclude: [],
      strict:
        typeof o.strict === 'boolean' ? o.strict : DEFAULT_OPTS.strict,
      delimiter:
        typeof o.delimiter === 'string' && o.delimiter.length >= 1
          ? o.delimiter
          : DEFAULT_OPTS.delimiter,
      header:
        typeof o.header === 'boolean' ? o.header : DEFAULT_OPTS.header,
    };
    if (typeof o.exclude === 'string') {
      out.exclude = o.exclude
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((g) =>
          globToRegExp(normalizeGlobPattern(toAbsoluteExcludeGlob(g))),
        );
    } else if (Array.isArray(o.exclude)) {
      out.exclude = o.exclude
        .map((x) => String(x).trim())
        .filter(Boolean)
        .map((g) =>
          globToRegExp(normalizeGlobPattern(toAbsoluteExcludeGlob(g))),
        );
    }
    return out;
  } catch {
    return { ...DEFAULT_OPTS, exclude: [] };
  }
}

export type FsReadLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readFsLimits(): FsReadLimits {
  return {
    maxFiles: envInt('AGT0_FS_MAX_FILES', 10_000),
    /** Default raised now that fs_* TVFs stream-parse (lower peak RAM than full row arrays). */
    maxFileBytes: envInt('AGT0_FS_MAX_FILE_BYTES', 64 * 1024 * 1024),
    maxTotalBytes: envInt('AGT0_FS_MAX_TOTAL_BYTES', 100 * 1024 * 1024),
  };
}

function envIntPositive(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Chunk size when feeding CSV/TSV through the incremental parser (bytes). */
export function readFsParseChunkBytes(): number {
  return envIntPositive('AGT0_FS_PARSE_CHUNK_BYTES', 2 * 1024 * 1024);
}

/** Bytes read per file to discover column keys when a glob matches multiple CSV/TSV files. */
export function readFsPreviewBytes(): number {
  return envIntPositive('AGT0_FS_PREVIEW_BYTES', 256 * 1024);
}

/**
 * Max rows emitted per fs_csv / fs_tsv / fs_text / fs_jsonl scan (one SQL table reference).
 * `null` = unlimited. Stops runaway scans (e.g. accidental full read in a tight loop).
 */
export function readFsMaxRows(): number | null {
  const v = process.env.AGT0_FS_MAX_ROWS;
  if (v === undefined || v === '' || v === '0') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

export function pathMatchesAny(path: string, regexes: RegExp[]): boolean {
  for (const r of regexes) {
    if (r.test(path)) return true;
  }
  return false;
}

export function isGlobPattern(s: string): boolean {
  return s.includes('*') || s.includes('?');
}
