import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let testHome: string;

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'agt0-scalar-at-'));
  process.env.AGT0_HOME = testHome;
  mkdirSync(join(testHome, 'databases'), { recursive: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

function uniqName() {
  return `sat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

describe('fs_read_at / fs_write_at edge cases', () => {
  it('fs_read_at length 0 returns empty string', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/a.txt', Buffer.from('abc'));
      const row = db
        .prepare(`SELECT fs_read_at('/a.txt', 0, 0) AS s`)
        .get() as { s: string | null };
      expect(row.s).toBe('');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_read_at offset at EOF returns empty', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/a.txt', Buffer.from('ab'));
      const row = db
        .prepare(`SELECT fs_read_at('/a.txt', 2, 5) AS s`)
        .get() as { s: string | null };
      expect(row.s).toBe('');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_read_at short read when length crosses EOF', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/a.txt', Buffer.from('abcd'));
      const row = db
        .prepare(`SELECT fs_read_at('/a.txt', 2, 100) AS s`)
        .get() as { s: string | null };
      expect(row.s).toBe('cd');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_read_at missing file returns null', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      const row = db
        .prepare(`SELECT fs_read_at('/missing.bin', 0, 1) AS s`)
        .get() as { s: string | null };
      expect(row.s).toBeNull();
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_read_at rejects negative offset or length', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/a.txt', Buffer.from('x'));
      const r1 = db
        .prepare(`SELECT fs_read_at('/a.txt', -1, 1) AS s`)
        .get() as { s: string | null };
      const r2 = db
        .prepare(`SELECT fs_read_at('/a.txt', 0, -1) AS s`)
        .get() as { s: string | null };
      expect(r1.s).toBeNull();
      expect(r2.s).toBeNull();
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_write_at overwrites middle and preserves tail', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite, fsRead } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/m.txt', Buffer.from('abcdefgh'));
      const n = db
        .prepare(`SELECT fs_write_at('/m.txt', 2, 'XY') AS n`)
        .get() as { n: number | null };
      expect(n.n).toBe(2);
      expect(fsRead(db, '/m.txt')?.toString('utf-8')).toBe('abXYefgh');
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });

  it('fs_write_at rejects negative offset', async () => {
    const { createDatabase, openDatabase, deleteDatabase } = await import(
      '../src/core/database.js'
    );
    const { fsWrite } = await import('../src/core/virtual-fs.js');
    const name = uniqName();
    createDatabase(name);
    const db = openDatabase(name);
    try {
      fsWrite(db, '/a.txt', Buffer.from('a'));
      const row = db
        .prepare(`SELECT fs_write_at('/a.txt', -1, 'z') AS n`)
        .get() as { n: number | null };
      expect(row.n).toBeNull();
    } finally {
      db.close();
      deleteDatabase(name);
    }
  });
});
