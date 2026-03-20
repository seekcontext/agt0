import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let testHome: string;

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'agt0-tvf-'));
  process.env.AGT0_HOME = testHome;
  mkdirSync(join(testHome, 'databases'), { recursive: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function uniqName() {
  return `tvf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

describe('fs TVF and scalars', () => {
  it('resolves ** glob for fs_csv', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/data/nested/a.csv', Buffer.from('x,y\n1,2\n'));
      fsWrite(db, '/data/b.csv', Buffer.from('x,y\n3,4\n'));
      const rows = db
        .prepare(`SELECT _path FROM fs_csv('/data/**/*.csv') ORDER BY _path`)
        .all() as { _path: string }[];
      expect(rows.map((r) => r._path)).toEqual([
        '/data/b.csv',
        '/data/nested/a.csv',
      ]);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('unions columns across multiple CSV files', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/m/a.csv', Buffer.from('a,b\n1,2\n'));
      fsWrite(db, '/m/b.csv', Buffer.from('a,c\n3,4\n'));
      const rows = db
        .prepare(`SELECT _data FROM fs_csv('/m/*.csv') ORDER BY _path, _line_number`)
        .all() as { _data: string }[];
      const objs = rows.map((r) => JSON.parse(r._data) as Record<string, unknown>);
      expect(objs[0]).toMatchObject({ a: '1', b: '2', c: null });
      expect(objs[1]).toMatchObject({ a: '3', b: null, c: '4' });
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('honors exclude in options JSON', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/x/a.csv', Buffer.from('v\n1\n'));
      fsWrite(db, '/x/b.csv', Buffer.from('v\n2\n'));
      const rows = db
        .prepare(
          `SELECT _path FROM fs_csv('/x/*.csv', '{"exclude":"**/a.csv"}') ORDER BY _path`,
        )
        .all() as { _path: string }[];
      expect(rows).toEqual([{ _path: '/x/b.csv' }]);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('throws when file count exceeds AGT0_FS_MAX_FILES', async () => {
    const prev = process.env.AGT0_FS_MAX_FILES;
    process.env.AGT0_FS_MAX_FILES = '1';
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/q/1.csv', Buffer.from('a\n1\n'));
      fsWrite(db, '/q/2.csv', Buffer.from('a\n2\n'));
      expect(() => {
        db.prepare(`SELECT 1 FROM fs_csv('/q/*.csv')`).all();
      }).toThrow(/AGT0_FS_MAX_FILES/);
    } finally {
      db.close();
      deleteDatabase(name);
      if (prev === undefined) delete process.env.AGT0_FS_MAX_FILES;
      else process.env.AGT0_FS_MAX_FILES = prev;
    }
  });

  it('reads TSV via fs_tsv', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/t/x.tsv', Buffer.from('a\tb\n1\t2\n'));
      const row = db
        .prepare(`SELECT json_extract(_data, '$.a') AS a FROM fs_tsv('/t/x.tsv')`)
        .get() as { a: string };
      expect(row.a).toBe('1');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_truncate shortens file', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite, fsRead } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/trunc.txt', Buffer.from('hello'));
      db.prepare(`SELECT fs_truncate('/trunc.txt', 3)`).pluck().get();
      expect(fsRead(db, '/trunc.txt')?.toString()).toBe('hel');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_jsonl strict rejects bad JSON', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/j/bad.jsonl', Buffer.from('{"ok":true}\nnot-json\n'));
      expect(() => {
        db.prepare(`SELECT 1 FROM fs_jsonl('/j/bad.jsonl', '{"strict":true}')`).all();
      }).toThrow(/invalid JSONL/);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_list normalizes dir path', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/data/x.txt', Buffer.from('x'));
      const n = db
        .prepare(`SELECT COUNT(*) AS n FROM fs_list('/data/')`)
        .get() as { n: number };
      expect(n.n).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });
});
