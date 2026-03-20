/**
 * Smoke-test documentation examples (README + USER_MANUAL) against the built CLI.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const cli = join(repoRoot, 'dist', 'cli.js');

let home: string;

function agt0(args: string[], opts?: { input?: string }): string {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, AGT0_HOME: home },
    input: opts?.input,
  });
  expect(r.status, r.stderr || r.stdout || 'nonzero exit').toBe(0);
  return r.stdout;
}

function sql(db: string, query: string): void {
  agt0(['sql', db, '-q', query]);
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'agt0-docs-e2e-'));
  mkdirSync(join(home, 'databases'), { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('README Quick Start + SQL fusion', () => {
  it('init, put CSV, query fs_csv, config json', () => {
    agt0(['init', 'myapp']);
    const csv = join(tmpdir(), `readme-${Date.now()}.csv`);
    writeFileSync(
      csv,
      'name,email,role\nAlice,a@ex.com,admin\nBob,b@ex.com,user\n',
    );
    agt0(['fs', 'put', csv, 'myapp:/data/users.csv']);
    agt0([
      'sql',
      'myapp',
      '-q',
      "SELECT * FROM fs_csv('/data/users.csv') WHERE _data LIKE '%admin%'",
    ]);
    sql('myapp', "SELECT fs_write('/config.json', '{\"name\":\"agt0\",\"version\":\"0.1\"}')");
    const out = agt0([
      'sql',
      'myapp',
      '-q',
      "SELECT json_extract(fs_read('/config.json'), '$.name') AS n",
    ]);
    expect(out).toMatch(/agt0/);
    sql('myapp', "SELECT fs_write('/logs/today.log', 'Started at ' || datetime('now'))");
    sql('myapp', "SELECT * FROM fs_csv('/data/users.csv') WHERE _data LIKE '%admin%'");
    const j = join(tmpdir(), `j-${Date.now()}.jsonl`);
    writeFileSync(j, '{"level":"error"}\n{"level":"info"}\n');
    agt0(['fs', 'put', j, 'myapp:/logs/app.jsonl']);
    sql(
      'myapp',
      `SELECT _line_number FROM fs_jsonl('/logs/app.jsonl') WHERE json_extract(line, '$.level') = 'error'`,
    );
    sql('myapp', "SELECT path, size, mtime FROM fs_list('/data/')");
    const lg = join(tmpdir(), `l-${Date.now()}.log`);
    writeFileSync(lg, 'x ERROR y\n');
    agt0(['fs', 'put', lg, 'myapp:/logs/x.log']);
    sql(
      'myapp',
      "SELECT _path FROM fs_text('/logs/*.log') WHERE line LIKE '%ERROR%'",
    );
  });
});

describe('USER_MANUAL SQL + recipes', () => {
  it('fs fusion, CSV query, JSONL group, pipeline-style SQL', () => {
    agt0(['init', 'um']);
    sql(
      'um',
      "SELECT fs_write('/config/app.json', '{\"debug\": true, \"port\": 3000}')",
    );
    sql('um', "SELECT fs_read('/config/app.json')");
    sql('um', "SELECT json_extract(fs_read('/config/app.json'), '$.port')");
    sql(
      'um',
      "SELECT fs_append('/logs/app.log', 'Started at ' || datetime('now') || char(10))",
    );
    sql('um', "SELECT fs_truncate('/logs/app.log', 0)");
    sql(
      'um',
      "SELECT fs_write('/data/note.txt', '0123456789012345678901234567890123456789')",
    );
    sql('um', "SELECT fs_read_at('/data/note.txt', 10, 32)");
    sql('um', "SELECT fs_write_at('/data/patch.bin', 64, 'Hi')");
    const u = join(tmpdir(), `users-${Date.now()}.csv`);
    writeFileSync(u, 'name,email,role\nA,a@x.com,admin\n');
    agt0(['fs', 'put', u, 'um:/data/users.csv']);
    sql(
      'um',
      `SELECT json_extract(_data, '$.name') FROM fs_csv('/data/users.csv') WHERE json_extract(_data, '$.role') = 'admin'`,
    );
    const jl = join(tmpdir(), `jl-${Date.now()}.jsonl`);
    writeFileSync(jl, '{"timestamp":"t","level":"error","message":"m"}\n');
    agt0(['fs', 'put', jl, 'um:/logs/app.jsonl']);
    sql(
      'um',
      `SELECT _line_number FROM fs_jsonl('/logs/app.jsonl') WHERE json_extract(line, '$.level') = 'error' LIMIT 10`,
    );
    sql('um', "SELECT path FROM fs_list('/')");
    sql('um', "CREATE TABLE users (name TEXT, email TEXT)");
    const imp = join(tmpdir(), `imp-${Date.now()}.csv`);
    writeFileSync(imp, 'name,email\nX,x@y.com\n');
    agt0(['fs', 'put', imp, 'um:/data/import/users.csv']);
    sql(
      'um',
      `INSERT INTO users (name, email) SELECT DISTINCT json_extract(_data, '$.name'), json_extract(_data, '$.email') FROM fs_csv('/data/import/users.csv') WHERE json_extract(_data, '$.email') IS NOT NULL`,
    );
  });

  it('Recipe: log analysis aggregate', () => {
    agt0(['init', 'logs-db']);
    const jl = join(tmpdir(), `app-${Date.now()}.jsonl`);
    writeFileSync(
      jl,
      '{"level":"info"}\n{"level":"error"}\n{"level":"error"}\n',
    );
    agt0(['fs', 'put', jl, 'logs-db:/logs/app.jsonl']);
    agt0([
      'sql',
      'logs-db',
      '-q',
      `SELECT json_extract(line, '$.level') AS level, COUNT(*) AS count FROM fs_jsonl('/logs/app.jsonl') GROUP BY level ORDER BY count DESC`,
    ]);
  });

  it('Recipe: pipeline SQL', () => {
    agt0(['init', 'pipeline']);
    const raw = join(tmpdir(), `sales-${Date.now()}.csv`);
    writeFileSync(
      raw,
      'date,product,amount,region\n2024-01-01,A,10.5,N\n2024-01-02,B,3,N\n',
    );
    agt0(['fs', 'put', raw, 'pipeline:/raw/sales.csv']);
    sql(
      'pipeline',
      `CREATE TABLE sales (date TEXT, product TEXT, amount REAL, region TEXT)`,
    );
    sql(
      'pipeline',
      `INSERT INTO sales (date, product, amount, region) SELECT json_extract(_data, '$.date'), json_extract(_data, '$.product'), CAST(json_extract(_data, '$.amount') AS REAL), json_extract(_data, '$.region') FROM fs_csv('/raw/sales.csv')`,
    );
    agt0([
      'sql',
      'pipeline',
      '-q',
      'SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC',
    ]);
    sql(
      'pipeline',
      `SELECT fs_write('/reports/summary.json', (SELECT json_group_array(json_object('region', region, 'total', total)) FROM (SELECT region, SUM(amount) as total FROM sales GROUP BY region)))`,
    );
  });

  it('USER_MANUAL Recipe 3: compact fs_write JSON', () => {
    agt0(['init', 'config']);
    agt0([
      'sql',
      'config',
      '-q',
      `SELECT fs_write('/env/production.json', '{"database_url":"postgres://...","redis_url":"redis://...","debug":false}')`,
    ]);
    const out = agt0([
      'sql',
      'config',
      '-q',
      "SELECT json_extract(fs_read('/env/production.json'), '$.database_url') AS u",
    ]);
    expect(out).toContain('postgres');
  });

  it('USER_MANUAL branch create/list/delete', () => {
    agt0(['init', 'branchdemo']);
    agt0(['branch', 'create', 'branchdemo', '--name', 'staging']);
    agt0(['branch', 'list', 'branchdemo']);
    agt0(['branch', 'delete', 'branchdemo', '--name', 'staging']);
  });

  it('Recipe 1 style: recursive glob over uploaded tree', () => {
    agt0(['init', 'project-context']);
    const srcDir = mkdtempSync(join(tmpdir(), 'src-tree-'));
    writeFileSync(join(srcDir, 'a.ts'), 'x\n');
    mkdirSync(join(srcDir, 'sub'));
    writeFileSync(join(srcDir, 'sub', 'b.ts'), 'y\n');
    agt0(['fs', 'put', '-r', srcDir, 'project-context:/src']);
    agt0([
      'sql',
      'project-context',
      '-q',
      `SELECT COUNT(*) AS c FROM fs_text('/src/**/*.ts')`,
    ]);
  });
});
