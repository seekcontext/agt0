import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  expandFsTableSql,
  findExpandableTvfCalls,
  findMatchingClosingParen,
  isSqlFsExpandEnabled,
  parseSqlSingleQuotedString,
  sqliteDoubleQuotedIdentifier,
  sqliteJsonPathLiteralForKey,
} from '../src/core/sql-fs-expand.js';

let testHome: string;

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'agt0-sqlexp-'));
  process.env.AGT0_HOME = testHome;
  mkdirSync(`${testHome}/databases`, { recursive: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function uniqName() {
  return `sqlexp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

describe('parseSqlSingleQuotedString', () => {
  it('parses simple literal', () => {
    const s = `SELECT * FROM t WHERE x = 'hello'`;
    const open = s.indexOf("'");
    const r = parseSqlSingleQuotedString(s, open);
    expect(r).toEqual({ value: 'hello', end: s.length });
  });

  it('handles doubled single-quote escape', () => {
    const r = parseSqlSingleQuotedString(`'a''b'`, 0);
    expect(r).toEqual({ value: "a'b", end: 6 });
  });

  it('returns null for non-quote', () => {
    expect(parseSqlSingleQuotedString(`abc`, 0)).toBeNull();
  });
});

describe('findMatchingClosingParen', () => {
  it('matches simple parens', () => {
    expect(findMatchingClosingParen(`(a)`, 0)).toBe(2);
  });

  it('ignores parens inside single-quoted strings', () => {
    expect(findMatchingClosingParen(`(')')`, 0)).toBe(4);
  });

  it('handles nested calls', () => {
    const s = `fs_csv('a', '{"x":1}')`;
    const open = s.indexOf('(');
    expect(findMatchingClosingParen(s, open)).toBe(s.length - 1);
  });

  it('skips line comments', () => {
    const s = `(1 -- comment )\n)`;
    expect(findMatchingClosingParen(s, 0)).toBe(s.length - 1);
  });

  it('skips block comments', () => {
    const s = `(1 /* ) */ )`;
    expect(findMatchingClosingParen(s, 0)).toBe(s.length - 1);
  });
});

describe('sqliteJsonPathLiteralForKey', () => {
  it('builds dotted path for plain identifier key', () => {
    expect(sqliteJsonPathLiteralForKey('name')).toBe("'$.name'");
  });

  it('uses quoted label path and escapes double quotes in key', () => {
    const lit = sqliteJsonPathLiteralForKey('a"b');
    expect(lit).toContain('$."');
    expect(lit).toContain('a""b');
  });
});

describe('sqliteDoubleQuotedIdentifier', () => {
  it('escapes double quotes', () => {
    expect(sqliteDoubleQuotedIdentifier('x"y')).toBe('"x""y"');
  });
});

describe('findExpandableTvfCalls', () => {
  it('finds fs_csv call', () => {
    const calls = findExpandableTvfCalls(`SELECT * FROM fs_csv('/a.csv')`);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('fs_csv');
  });

  it('does not match inside single-quoted string', () => {
    const calls = findExpandableTvfCalls(`SELECT 'fs_csv(/x.csv)' FROM t`);
    expect(calls).toHaveLength(0);
  });

  it('does not match after line comment', () => {
    const calls = findExpandableTvfCalls(`-- fs_csv('/x.csv')\nSELECT 1`);
    expect(calls).toHaveLength(0);
  });

  it('does not match inside block comment', () => {
    const calls = findExpandableTvfCalls(`/* fs_csv('/x.csv') */ SELECT 1`);
    expect(calls).toHaveLength(0);
  });

  it('does not match as suffix of identifier', () => {
    const calls = findExpandableTvfCalls(`SELECT * FROM my_fs_csv('/a.csv')`);
    expect(calls).toHaveLength(0);
  });

  it('finds multiple calls', () => {
    const calls = findExpandableTvfCalls(
      `SELECT * FROM fs_csv('/a.csv') JOIN fs_tsv('/b.tsv') ON 1`,
    );
    expect(calls.map((c) => c.name)).toEqual(['fs_csv', 'fs_tsv']);
  });
});

describe('isSqlFsExpandEnabled', () => {
  it('respects AGT0_SQL_FS_EXPAND=0', () => {
    const prev = process.env.AGT0_SQL_FS_EXPAND;
    process.env.AGT0_SQL_FS_EXPAND = '0';
    expect(isSqlFsExpandEnabled()).toBe(false);
    if (prev === undefined) delete process.env.AGT0_SQL_FS_EXPAND;
    else process.env.AGT0_SQL_FS_EXPAND = prev;
  });
});

describe('expandFsTableSql integration', () => {
  it('leaves SQL unchanged when disabled', async () => {
    const prev = process.env.AGT0_SQL_FS_EXPAND;
    process.env.AGT0_SQL_FS_EXPAND = '0';
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/d/a.csv', Buffer.from('x,y\n1,2\n'));
      const sql = `SELECT * FROM fs_csv('/d/a.csv')`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
      if (prev === undefined) delete process.env.AGT0_SQL_FS_EXPAND;
      else process.env.AGT0_SQL_FS_EXPAND = prev;
    }
  });

  it('does not expand glob paths', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/d/a.csv', Buffer.from('x,y\n1,2\n'));
      const sql = `SELECT * FROM fs_csv('/d/*.csv')`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('does not expand missing files', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      const sql = `SELECT * FROM fs_csv('/nope/missing.csv')`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands fs_csv and SELECT * returns real columns', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(
        db,
        '/data/users.csv',
        Buffer.from('name,role\nAlice,admin\nBob,user\n'),
      );
      const sql = `SELECT * FROM fs_csv('/data/users.csv') WHERE role = 'admin'`;
      const expanded = expandFsTableSql(sql, db);
      expect(expanded).not.toBe(sql);
      expect(expanded).toContain('json_extract(_data');
      const rows = db.prepare(expanded).all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Alice');
      expect(rows[0].role).toBe('admin');
      const cols = db.prepare(expanded).columns().map((c) => c.name);
      expect(cols).toContain('name');
      expect(cols).toContain('role');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands fs_tsv', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/t/x.tsv', Buffer.from('a\tb\n3\t4\n'));
      const sql = `SELECT a, b FROM fs_tsv('/t/x.tsv')`;
      const expanded = expandFsTableSql(sql, db);
      const row = db.prepare(expanded).get() as { a: string; b: string };
      expect(row).toEqual({ a: '3', b: '4' });
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands fs_jsonl with union keys', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(
        db,
        '/j/l.jsonl',
        Buffer.from('{"k":1,"x":"a"}\n{"k":2,"y":"b"}\n'),
      );
      const sql = `SELECT k, x, y FROM fs_jsonl('/j/l.jsonl') ORDER BY k`;
      const expanded = expandFsTableSql(sql, db);
      const rows = db.prepare(expanded).all() as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0].k).toBe(1);
      expect(rows[0].x).toBe('a');
      expect(rows[0].y).toBeNull();
      expect(rows[1].y).toBe('b');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands CSV headers with spaces (quoted JSON path)', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(
        db,
        '/h/spaced.csv',
        Buffer.from('"weird col",plain\n1,two\n'),
      );
      const sql = `SELECT * FROM fs_csv('/h/spaced.csv')`;
      const expanded = expandFsTableSql(sql, db);
      expect(expanded).toContain('$."weird col"');
      const row = db.prepare(expanded).get() as Record<string, unknown>;
      expect(row['weird col']).toBe('1');
      expect(row.plain).toBe('two');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('honors custom delimiter in options', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/p/d.dat', Buffer.from('u|w\n1|2\n'));
      const sql = `SELECT u, w FROM fs_csv('/p/d.dat', '{"delimiter":"|"}')`;
      const expanded = expandFsTableSql(sql, db);
      const row = db.prepare(expanded).get() as { u: string; w: string };
      expect(row).toEqual({ u: '1', w: '2' });
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands two independent fs_csv calls in one query', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/m/a.csv', Buffer.from('id\n1\n'));
      fsWrite(db, '/m/b.csv', Buffer.from('id\n2\n'));
      const sql = `SELECT * FROM fs_csv('/m/a.csv') UNION ALL SELECT * FROM fs_csv('/m/b.csv')`;
      const expanded = expandFsTableSql(sql, db);
      const rows = db.prepare(expanded).all() as { id: string }[];
      expect(rows.map((r) => r.id).sort()).toEqual(['1', '2']);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands subquery with nested fs_csv', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/s/outer.csv', Buffer.from('x\n1\n'));
      fsWrite(db, '/s/inner.csv', Buffer.from('y\n1\n'));
      const sql = `SELECT * FROM fs_csv('/s/outer.csv') WHERE x IN (SELECT y FROM fs_csv('/s/inner.csv'))`;
      const expanded = expandFsTableSql(sql, db);
      const rows = db.prepare(expanded).all() as { x: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].x).toBe('1');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('prefixes reserved-like header _line_number', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(
        db,
        '/r/weird.csv',
        Buffer.from('_line_number,ok\nv1,v2\n'),
      );
      const sql = `SELECT * FROM fs_csv('/r/weird.csv')`;
      const expanded = expandFsTableSql(sql, db);
      const row = db.prepare(expanded).get() as Record<string, unknown>;
      expect(row.field__line_number).toBe('v1');
      expect(row.ok).toBe('v2');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('rejects malformed second argument (non-string)', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/q/x.csv', Buffer.from('a\n1\n'));
      const sql = `SELECT * FROM fs_csv('/q/x.csv', 123)`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('leaves SQL unchanged when no fs_* TVF appears', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      const sql = `SELECT 1 AS x`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands inside WITH ... SELECT', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/w/t.csv', Buffer.from('n\n9\n'));
      const sql = `WITH c AS (SELECT * FROM fs_csv('/w/t.csv')) SELECT n FROM c`;
      const expanded = expandFsTableSql(sql, db);
      const v = db.prepare(expanded).pluck().get() as string;
      expect(v).toBe('9');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('expands for INSERT ... SELECT from fs_csv', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/i/s.csv', Buffer.from('v\n42\n'));
      db.exec(`CREATE TABLE sink (v TEXT)`);
      const sql = `INSERT INTO sink SELECT v FROM fs_csv('/i/s.csv')`;
      const expanded = expandFsTableSql(sql, db);
      db.prepare(expanded).run();
      const n = db.prepare(`SELECT v FROM sink`).pluck().get();
      expect(n).toBe('42');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('findExpandableTvfCalls detects fs_jsonl', () => {
    const calls = findExpandableTvfCalls(
      `SELECT 1 FROM fs_jsonl('/l.jsonl')`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('fs_jsonl');
  });

  it('rejects extra arguments', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/q/x.csv', Buffer.from('a\n1\n'));
      const sql = `SELECT * FROM fs_csv('/q/x.csv', '', 'extra')`;
      expect(expandFsTableSql(sql, db)).toBe(sql);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });
});
