/**
 * README + USER_MANUAL Node.js API examples (createDatabase, fs_*, fs_csv TVF, expandFsTableSql).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let testHome: string;
let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.AGT0_HOME;
  testHome = mkdtempSync(join(tmpdir(), 'agt0-docs-node-'));
  process.env.AGT0_HOME = testHome;
  mkdirSync(join(testHome, 'databases'), { recursive: true });
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.AGT0_HOME;
  else process.env.AGT0_HOME = prevHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe('README + USER_MANUAL Node API snippets', () => {
  it('README Agent Integration example', async () => {
    const { createDatabase, fsWrite, fsRead } = await import('../src/index.js');
    const db = createDatabase('my-agent');
    fsWrite(db, '/memory/prefs.json', Buffer.from('{"theme":"dark"}'));
    const prefs = JSON.parse(fsRead(db, '/memory/prefs.json')!.toString());
    expect(prefs.theme).toBe('dark');
    fsWrite(
      db,
      '/data/users.csv',
      Buffer.from('name,email\nAda,ada@ex.com\n'),
    );
    const rows = db
      .prepare("SELECT * FROM fs_csv('/data/users.csv')")
      .all() as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    db.close();
  });

  it('USER_MANUAL Node.js API example (fsList + fs_csv)', async () => {
    const { createDatabase, fsWrite, fsRead, fsList } = await import(
      '../src/index.js'
    );
    const db = createDatabase('my-agent-2');
    fsWrite(
      db,
      '/context/system.md',
      Buffer.from('You are a helpful assistant.'),
    );
    const content = fsRead(db, '/context/system.md');
    expect(content?.toString('utf-8')).toContain('helpful');
    const entries = fsList(db, '/');
    expect(entries.some((e) => e.path.includes('context'))).toBe(true);
    fsWrite(
      db,
      '/data/users.csv',
      Buffer.from('name,email\nBob,b@ex.com\n'),
    );
    const rows = db
      .prepare("SELECT * FROM fs_csv('/data/users.csv')")
      .all() as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    db.close();
  });

  it('expandFsTableSql rewrites literal-path fs_csv (USER_MANUAL / skill)', async () => {
    const { createDatabase, fsWrite, expandFsTableSql } = await import(
      '../src/index.js'
    );
    const db = createDatabase('expand-demo');
    fsWrite(db, '/data/users.csv', Buffer.from('name,role\nZ,admin\n'));
    const raw = `SELECT * FROM fs_csv('/data/users.csv') WHERE role = 'admin'`;
    const rewritten = expandFsTableSql(raw, db);
    expect(rewritten).not.toBe(raw);
    const rows = db.prepare(rewritten).all() as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(String(rows[0].name ?? '')).toContain('Z');
    db.close();
  });
});
