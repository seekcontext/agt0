/**
 * Smoke-test documentation examples (README + USER_MANUAL) against the built CLI.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
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

describe('SQL REPL dot commands', () => {
  it('.fshelp prints virtual FS SQL help (SQL REPL only, not fs sh)', () => {
    agt0(['init', 'replhelp']);
    const r = spawnSync(process.execPath, [cli, 'sql', 'replhelp'], {
      encoding: 'utf-8',
      env: { ...process.env, AGT0_HOME: home },
      input: '.fshelp\n.quit\n',
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Scalar functions/);
    expect(r.stdout).toMatch(/fs_read/);
  });
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

/** README / USER_MANUAL / skill.md — run documented snippets end-to-end */
describe('README: SQL + FS fusion (documented snippets)', () => {
  it('config port 3000, ** glob logs, JSONL GROUP BY, INSERT from fs_csv', () => {
    agt0(['init', 'readme-fusion']);
    sql('readme-fusion', `SELECT fs_write('/config.json', '{"port": 3000}')`);
    const portOut = agt0([
      'sql',
      'readme-fusion',
      '-q',
      `SELECT json_extract(fs_read('/config.json'), '$.port')`,
    ]);
    expect(portOut).toMatch(/3000/);
    const csv = join(tmpdir(), `readme-fus-${Date.now()}.csv`);
    writeFileSync(
      csv,
      'name,email,role\nAlice Johnson,alice@example.com,admin\nBob Smith,bob@example.com,user\n',
    );
    agt0(['fs', 'put', csv, 'readme-fusion:/data/users.csv']);
    agt0([
      'sql',
      'readme-fusion',
      '-q',
      `SELECT json_extract(_data, '$.name') AS name FROM fs_csv('/data/users.csv') WHERE json_extract(_data, '$.role') = 'admin'`,
    ]);
    sql(
      'readme-fusion',
      `SELECT fs_write('/logs/nested/app.log', 'prefix ERROR suffix')`,
    );
    sql('readme-fusion', `SELECT fs_write('/logs/other.log', 'ok')`);
    agt0([
      'sql',
      'readme-fusion',
      '-q',
      `SELECT _path, _line_number, line FROM fs_text('/logs/**/*.log') WHERE line LIKE '%ERROR%'`,
    ]);
    const j = join(tmpdir(), `readme-jl-${Date.now()}.jsonl`);
    writeFileSync(j, '{"level":"info"}\n{"level":"error"}\n{"level":"info"}\n');
    agt0(['fs', 'put', j, 'readme-fusion:/logs/app.jsonl']);
    agt0([
      'sql',
      'readme-fusion',
      '-q',
      `SELECT json_extract(line, '$.level') AS level, COUNT(*) FROM fs_jsonl('/logs/app.jsonl') GROUP BY level`,
    ]);
    agt0(['fs', 'mkdir', 'readme-fusion:/data/import']);
    agt0(['fs', 'put', csv, 'readme-fusion:/data/import/users.csv']);
    sql('readme-fusion', 'CREATE TABLE users (name TEXT, email TEXT)');
    sql(
      'readme-fusion',
      `INSERT INTO users (name, email) SELECT json_extract(_data, '$.name'), json_extract(_data, '$.email') FROM fs_csv('/data/import/users.csv')`,
    );
  });
});

describe('README: virtual table modules (csv_expand, jsonl_expand)', () => {
  it('matches README CREATE VIRTUAL TABLE + SELECT patterns', () => {
    agt0(['init', 'readme-vt']);
    const csv = join(tmpdir(), `readme-vt-${Date.now()}.csv`);
    writeFileSync(
      csv,
      'name,email,role\nAlice Johnson,alice@example.com,admin\n',
    );
    agt0(['fs', 'put', csv, 'readme-vt:/data/users.csv']);
    sql(
      'readme-vt',
      `CREATE VIRTUAL TABLE users USING csv_expand('/data/users.csv')`,
    );
    agt0([
      'sql',
      'readme-vt',
      '-q',
      `SELECT name, email FROM users WHERE role = 'admin'`,
    ]);
    const jl = join(tmpdir(), `readme-vt-jl-${Date.now()}.jsonl`);
    writeFileSync(jl, '{"level":"info"}\n{"level":"error"}\n');
    agt0(['fs', 'put', jl, 'readme-vt:/logs/app.jsonl']);
    sql(
      'readme-vt',
      `CREATE VIRTUAL TABLE logs USING jsonl_expand('/logs/app.jsonl')`,
    );
    agt0([
      'sql',
      'readme-vt',
      '-q',
      `SELECT level, COUNT(*) FROM logs GROUP BY level`,
    ]);
  });
});

describe('USER_MANUAL: Getting Started + CLI filesystem', () => {
  it('use default db, production config SQL, fs get/cat/ls/rm/mkdir', () => {
    // Distinct name: README e2e already uses `myapp` in the same AGT0_HOME.
    const db = 'man-myapp';
    agt0(['init', db]);
    agt0(['use', db]);
    const csv = join(tmpdir(), `um-gs-${Date.now()}.csv`);
    writeFileSync(csv, 'name,email\nX,x@y.com\n');
    agt0(['fs', 'put', csv, `${db}:/data/users.csv`]);
    agt0([
      'sql',
      '-q',
      `SELECT * FROM fs_csv('/data/users.csv')`,
    ]);
    agt0([
      'sql',
      '-q',
      `SELECT fs_write('/config.json', '{"mode":"production"}')`,
    ]);
    const mode = agt0([
      'sql',
      '-q',
      `SELECT json_extract(fs_read('/config.json'), '$.mode')`,
    ]);
    expect(mode).toMatch(/production/);
    const outDir = mkdtempSync(join(tmpdir(), 'agt0-get-'));
    const outFile = join(outDir, 'local.csv');
    agt0(['fs', 'get', `${db}:/data/users.csv`, outFile]);
    expect(readFileSync(outFile, 'utf-8')).toContain('x@y.com');
    agt0(['fs', 'cat', `${db}:/data/users.csv`]);
    agt0(['fs', 'ls', `${db}:/data/`]);
    agt0(['fs', 'mkdir', `${db}:/data/exports`]);
    agt0(['fs', 'rm', `${db}:/config.json`]);
  });
});

describe('USER_MANUAL: sql -f, inspect, dump, seed, delete', () => {
  it('runs documented management commands', () => {
    agt0(['init', 'mgmt']);
    sql('mgmt', 'CREATE TABLE demo (id INTEGER PRIMARY KEY, note TEXT)');
    sql('mgmt', `INSERT INTO demo (note) VALUES ('hello')`);
    const sqlFile = join(tmpdir(), `mgmt-extra-${Date.now()}.sql`);
    writeFileSync(sqlFile, `INSERT INTO demo (note) VALUES ('from file');\n`);
    agt0(['sql', 'mgmt', '-f', sqlFile]);
    agt0(['list']);
    agt0(['inspect', 'mgmt']);
    agt0(['inspect', 'mgmt', 'tables']);
    agt0(['inspect', 'mgmt', 'schema']);
    const dumpPath = join(tmpdir(), `mgmt-dump-${Date.now()}.sql`);
    agt0(['dump', 'mgmt', '-o', dumpPath]);
    expect(readFileSync(dumpPath, 'utf-8')).toMatch(/CREATE TABLE/i);
    const ddlPath = join(tmpdir(), `mgmt-ddl-${Date.now()}.sql`);
    agt0(['dump', 'mgmt', '--ddl-only', '-o', ddlPath]);
    expect(readFileSync(ddlPath, 'utf-8')).toMatch(/CREATE TABLE/i);
    agt0(['init', 'mgmt-seed']);
    const seedPath = join(tmpdir(), `seed-${Date.now()}.sql`);
    writeFileSync(
      seedPath,
      `CREATE TABLE seeded (x INTEGER);\nINSERT INTO seeded VALUES (7);\n`,
    );
    agt0(['seed', 'mgmt-seed', seedPath]);
    agt0(['delete', 'mgmt-seed', '--yes']);
    expect(existsSync(join(home, 'databases', 'mgmt-seed.db'))).toBe(false);
  });
});

describe('USER_MANUAL: TVF options + fusion scalars', () => {
  it('fs_csv delimiter option, fs_text exclude, fs_exists/fs_size', () => {
    agt0(['init', 'opt']);
    const semi = join(tmpdir(), `semi-${Date.now()}.csv`);
    writeFileSync(semi, 'name;score\na;1\n');
    agt0(['fs', 'put', semi, 'opt:/data/report.csv']);
    agt0([
      'sql',
      'opt',
      '-q',
      `SELECT * FROM fs_csv('/data/*.csv', '{"delimiter": ";"}')`,
    ]);
    sql('opt', `SELECT fs_write('/logs/app.log', 'line')`);
    sql('opt', `SELECT fs_write('/logs/skip.tmp', 'x')`);
    agt0([
      'sql',
      'opt',
      '-q',
      `SELECT line FROM fs_text('/logs/**/*.log', '{"exclude": "*.tmp"}')`,
    ]);
    sql('opt', `SELECT fs_write('/probe.txt', 'hi')`);
    agt0([
      'sql',
      'opt',
      '-q',
      `SELECT fs_exists('/probe.txt'), fs_size('/probe.txt')`,
    ]);
  });
});

describe('USER_MANUAL: JSONL recipe (ORDER BY + message)', () => {
  it('matches USER_MANUAL Query JSONL block', () => {
    agt0(['init', 'um-jsonl']);
    const jl = join(tmpdir(), `um-msg-${Date.now()}.jsonl`);
    writeFileSync(
      jl,
      '{"level":"info","message":"ok"}\n{"level":"error","message":"bad"}\n',
    );
    agt0(['fs', 'put', jl, 'um-jsonl:/logs/app.jsonl']);
    agt0([
      'sql',
      'um-jsonl',
      '-q',
      `SELECT json_extract(line, '$.level') AS level, json_extract(line, '$.message') AS msg FROM fs_jsonl('/logs/app.jsonl') WHERE json_extract(line, '$.level') = 'error' ORDER BY _line_number DESC LIMIT 10`,
    ]);
  });
});

describe('USER_MANUAL: Agent memory + project indexing recipes', () => {
  it('agent-memory bash-style SQL', () => {
    agt0(['init', 'agent-memory']);
    agt0([
      'sql',
      'agent-memory',
      '-q',
      `SELECT fs_write('/memory/preferences.json', '{"theme": "dark", "language": "en"}')`,
    ]);
    const out = agt0([
      'sql',
      'agent-memory',
      '-q',
      `SELECT json_extract(fs_read('/memory/preferences.json'), '$.theme')`,
    ]);
    expect(out).toMatch(/dark/);
  });

  it('project-ctx lines per file + TODO (USER_MANUAL)', () => {
    agt0(['init', 'project-ctx']);
    const srcDir = mkdtempSync(join(tmpdir(), 'proj-ctx-'));
    writeFileSync(join(srcDir, 'a.ts'), '// TODO fix\nline2\n');
    mkdirSync(join(srcDir, 'nest'));
    writeFileSync(join(srcDir, 'nest', 'b.ts'), 'ok\n');
    agt0(['fs', 'put', '-r', srcDir, 'project-ctx:/src']);
    agt0([
      'sql',
      'project-ctx',
      '-q',
      `SELECT _path, COUNT(*) AS lines FROM fs_text('/src/**/*.ts') GROUP BY _path ORDER BY lines DESC`,
    ]);
    agt0([
      'sql',
      'project-ctx',
      '-q',
      `SELECT _path, _line_number, line FROM fs_text('/src/**/*.ts') WHERE line LIKE '%TODO%'`,
    ]);
  });
});

describe('skill.md: default database + sql -f', () => {
  it('after agt0 use, sql omits db name; -f runs file', () => {
    agt0(['init', 'skill-u']);
    agt0(['use', 'skill-u']);
    agt0(['sql', '-q', `SELECT 1 AS ok`]);
    const schemaFile = join(tmpdir(), `skill-schema-${Date.now()}.sql`);
    writeFileSync(
      schemaFile,
      `CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT);\nINSERT INTO tasks (title, status) VALUES ('Build API', 'doing');\n`,
    );
    agt0(['sql', '-f', schemaFile]);
    const out = agt0(['sql', '-q', `SELECT * FROM tasks WHERE status = 'doing'`]);
    expect(out).toMatch(/Build API/);
  });
});

describe('skill.md: documented SQL patterns', () => {
  it('memory SQL, CSV/JSONL/TVF, fs_list, virtual tables v_users + v_logs', () => {
    agt0(['init', 'skill-sql']);
    sql(
      'skill-sql',
      `SELECT fs_write('/memory/context.md', 'User prefers dark mode')`,
    );
    sql('skill-sql', `SELECT fs_read('/memory/context.md')`);
    sql(
      'skill-sql',
      `SELECT fs_append('/logs/session.log', 'Step completed' || char(10))`,
    );
    sql('skill-sql', `SELECT fs_write('/config.json', '{}')`);
    agt0(['sql', 'skill-sql', '-q', `SELECT fs_exists('/config.json')`]);
    agt0(['sql', 'skill-sql', '-q', `SELECT fs_size('/config.json')`]);
    const csv = join(tmpdir(), `skill-u-${Date.now()}.csv`);
    writeFileSync(csv, 'name,email,role\nA,a@x.com,admin\n');
    agt0(['fs', 'put', csv, 'skill-sql:/data/users.csv']);
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT json_extract(_data, '$.name') AS name, json_extract(_data, '$.email') AS email FROM fs_csv('/data/users.csv') WHERE json_extract(_data, '$.role') = 'admin'`,
    ]);
    const jl = join(tmpdir(), `skill-jl-${Date.now()}.jsonl`);
    writeFileSync(jl, '{"level":"info"}\n{"level":"error"}\n');
    agt0(['fs', 'put', jl, 'skill-sql:/logs/app.jsonl']);
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT json_extract(line, '$.level') AS level, COUNT(*) FROM fs_jsonl('/logs/app.jsonl') GROUP BY level`,
    ]);
    const srcDir = mkdtempSync(join(tmpdir(), 'skill-src-'));
    writeFileSync(join(srcDir, 'x.ts'), '// TODO skill\n');
    agt0(['fs', 'put', '-r', srcDir, 'skill-sql:/src']);
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT _path, _line_number, line FROM fs_text('/src/**/*.ts') WHERE line LIKE '%TODO%'`,
    ]);
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT path, type, size, mtime FROM fs_list('/data/')`,
    ]);
    sql(
      'skill-sql',
      `CREATE VIRTUAL TABLE v_users USING csv_expand('/data/users.csv')`,
    );
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT name, email FROM v_users WHERE role = 'admin'`,
    ]);
    const jl2 = join(tmpdir(), `skill-jl2-${Date.now()}.jsonl`);
    writeFileSync(jl2, '{"level":"error","msg":"oops"}\n');
    agt0(['fs', 'put', jl2, 'skill-sql:/logs/err.jsonl']);
    sql(
      'skill-sql',
      `CREATE VIRTUAL TABLE v_logs USING jsonl_expand('/logs/err.jsonl')`,
    );
    agt0([
      'sql',
      'skill-sql',
      '-q',
      `SELECT level, msg FROM v_logs WHERE level = 'error'`,
    ]);
    sql('skill-sql', 'CREATE TABLE users (name TEXT, email TEXT)');
    sql(
      'skill-sql',
      `INSERT INTO users (name, email) SELECT DISTINCT json_extract(_data, '$.name'), json_extract(_data, '$.email') FROM fs_csv('/data/users.csv') WHERE json_extract(_data, '$.email') IS NOT NULL`,
    );
  });
});

describe('README: CLI Quick Start filesystem commands', () => {
  it('fs put -r, get, ls, cat, rm (README Virtual Filesystem)', () => {
    agt0(['init', 'readme-cli']);
    const f = join(tmpdir(), `readme-d-${Date.now()}.csv`);
    writeFileSync(f, 'a,b\n1,2\n');
    agt0(['fs', 'put', f, 'readme-cli:/data/data.csv']);
    const tree = mkdtempSync(join(tmpdir(), 'readme-tree-'));
    writeFileSync(join(tree, 'f.txt'), 'x');
    agt0(['fs', 'put', '-r', tree, 'readme-cli:/src']);
    const dl = mkdtempSync(join(tmpdir(), 'readme-dl-'));
    const outCsv = join(dl, 'out.csv');
    agt0(['fs', 'get', 'readme-cli:/data/data.csv', outCsv]);
    expect(readFileSync(outCsv, 'utf-8')).toContain('1,2');
    agt0(['fs', 'ls', 'readme-cli:/data/']);
    agt0(['fs', 'cat', 'readme-cli:/data/data.csv']);
    agt0(['fs', 'rm', 'readme-cli:/data/data.csv']);
  });
});

describe('CLI: AGT0_SQL_FS_EXPAND=0 still executes literal fs_csv', () => {
  it('disables rewrite; query remains valid', () => {
    agt0(['init', 'no-expand']);
    const csv = join(tmpdir(), `ne-${Date.now()}.csv`);
    writeFileSync(csv, 'c\nv\n');
    agt0(['fs', 'put', csv, 'no-expand:/data/x.csv']);
    const r = spawnSync(process.execPath, [cli, 'sql', 'no-expand', '-q', `SELECT * FROM fs_csv('/data/x.csv')`], {
      encoding: 'utf-8',
      env: { ...process.env, AGT0_HOME: home, AGT0_SQL_FS_EXPAND: '0' },
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/_data|_line_number/i);
  });
});
