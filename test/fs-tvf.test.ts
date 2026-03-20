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

  it('throws when row count exceeds AGT0_FS_MAX_ROWS', async () => {
    const prev = process.env.AGT0_FS_MAX_ROWS;
    process.env.AGT0_FS_MAX_ROWS = '2';
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/r/rows.csv', Buffer.from('a\n1\n2\n3\n'));
      expect(() => {
        db.prepare(`SELECT 1 FROM fs_csv('/r/rows.csv')`).all();
      }).toThrow(/AGT0_FS_MAX_ROWS/);
    } finally {
      db.close();
      deleteDatabase(name);
      if (prev === undefined) delete process.env.AGT0_FS_MAX_ROWS;
      else process.env.AGT0_FS_MAX_ROWS = prev;
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

  it('fs_read_at and fs_write_at', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite, fsRead } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/rw.bin', Buffer.from('hello'));
      fsWrite(db, '/gap.bin', Buffer.from('ab'));
      const mid = db
        .prepare(`SELECT fs_read_at('/rw.bin', 1, 3) AS s`)
        .get() as { s: string };
      expect(mid.s).toBe('ell');
      db.prepare(`SELECT fs_write_at('/rw.bin', 5, 'xx')`).pluck().get();
      const buf = fsRead(db, '/rw.bin');
      expect(buf?.length).toBe(7);
      expect(buf?.toString('utf-8')).toBe('helloxx');
      db.prepare(`SELECT fs_write_at('/gap.bin', 4, 'Z')`).pluck().get();
      const g = fsRead(db, '/gap.bin');
      expect(g?.equals(Buffer.from('ab\0\0Z', 'binary'))).toBe(true);
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

  it('csv_expand exposes CSV headers as real columns', async () => {
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
      db.exec(
        `CREATE VIRTUAL TABLE v_users USING csv_expand('/data/users.csv')`,
      );
      const rows = db
        .prepare(
          `SELECT name, role FROM v_users WHERE role = 'admin' ORDER BY name`,
        )
        .all() as { name: string; role: string }[];
      expect(rows).toEqual([{ name: 'Alice', role: 'admin' }]);
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('tsv_expand reads tab-separated files', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/t/items.tsv', Buffer.from('sku\tqty\nA\t10\n'));
      db.exec(`CREATE VIRTUAL TABLE v_items USING tsv_expand('/t/items.tsv')`);
      const row = db
        .prepare(`SELECT sku, qty FROM v_items`)
        .get() as { sku: string; qty: string };
      expect(row).toEqual({ sku: 'A', qty: '10' });
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('jsonl_expand unions keys across lines', async () => {
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
        '/logs/e.jsonl',
        Buffer.from(
          '{"level":"info","msg":"a"}\n{"level":"error","msg":"b","code":1}\n',
        ),
      );
      db.exec(`CREATE VIRTUAL TABLE v_logs USING jsonl_expand('/logs/e.jsonl')`);
      const err = db
        .prepare(
          `SELECT msg, code FROM v_logs WHERE level = 'error'`,
        )
        .get() as { msg: string; code: number };
      expect(err).toEqual({ msg: 'b', code: 1 });
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('csv_expand rejects glob paths', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/g/x.csv', Buffer.from('a\n1\n'));
      expect(() => {
        db.exec(`CREATE VIRTUAL TABLE bad USING csv_expand('/g/*.csv')`);
      }).toThrow(/no globs/);
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
