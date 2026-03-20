import { describe, expect, it } from 'vitest';
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
} from '../src/core/fs-path.js';

describe('normalizeVirtualPath', () => {
  it('collapses slashes and resolves dots', () => {
    expect(normalizeVirtualPath('//data//x//')).toBe('/data/x');
    expect(normalizeVirtualPath('/data/foo/../bar')).toBe('/data/bar');
  });

  it('returns root', () => {
    expect(normalizeVirtualPath('/')).toBe('/');
    expect(normalizeVirtualPath('')).toBe('/');
  });
});

describe('globToRegExp', () => {
  it('matches single-segment star', () => {
    const r = globToRegExp('/data/*.csv');
    expect(r.test(normalizeVirtualPath('/data/a.csv'))).toBe(true);
    expect(r.test(normalizeVirtualPath('/data/sub/a.csv'))).toBe(false);
  });

  it('matches ** across directories', () => {
    const r = globToRegExp('/data/**/*.csv');
    expect(r.test(normalizeVirtualPath('/data/a.csv'))).toBe(true);
    expect(r.test(normalizeVirtualPath('/data/sub/a.csv'))).toBe(true);
    expect(r.test(normalizeVirtualPath('/other/a.csv'))).toBe(false);
  });

  it('matches ? as one non-slash char', () => {
    const r = globToRegExp('/data/?.csv');
    expect(r.test(normalizeVirtualPath('/data/x.csv'))).toBe(true);
    expect(r.test(normalizeVirtualPath('/data/ab.csv'))).toBe(false);
  });
});

describe('sqlLikeLiteralPrefix', () => {
  it('returns directory prefix before first single *', () => {
    expect(sqlLikeLiteralPrefix('/data/*.csv')).toBe('/data/');
  });

  it('returns literal prefix before glob when ** is present', () => {
    expect(sqlLikeLiteralPrefix('/data/**/*.csv')).toBe('/data/');
  });
});

describe('escapeLikePrefix', () => {
  it('escapes LIKE specials', () => {
    expect(escapeLikePrefix('/d%ta_')).toBe('/d\\%ta\\_');
  });
});

describe('parseFsTableOptions', () => {
  it('parses exclude and strict', () => {
    const o = parseFsTableOptions('{"exclude":"*.tmp","strict":true}');
    expect(o.strict).toBe(true);
    expect(o.exclude.length).toBe(1);
    expect(pathMatchesAny('/x.tmp', o.exclude)).toBe(true);
    expect(pathMatchesAny('/x.csv', o.exclude)).toBe(false);
  });
});

describe('readFsLimits', () => {
  it('reads env overrides', () => {
    const prev = process.env.AGT0_FS_MAX_FILES;
    process.env.AGT0_FS_MAX_FILES = '42';
    expect(readFsLimits().maxFiles).toBe(42);
    if (prev === undefined) delete process.env.AGT0_FS_MAX_FILES;
    else process.env.AGT0_FS_MAX_FILES = prev;
  });
});

describe('isGlobPattern', () => {
  it('detects meta chars', () => {
    expect(isGlobPattern('/a/*.csv')).toBe(true);
    expect(isGlobPattern('/a/b.csv')).toBe(false);
  });
});
