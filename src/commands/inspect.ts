import { openDatabase } from '../core/database.js';
import { resolveDbName, dbPath } from '../core/config.js';
import { printTable, printKeyValue } from '../utils/format.js';
import { statSync } from 'fs';
import chalk from 'chalk';

export function cmdInspect(
  dbName: string | undefined,
  sub: string | undefined,
): void {
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    switch (sub) {
      case 'tables':
        inspectTables(db);
        break;
      case 'schema':
        inspectSchema(db);
        break;
      default:
        inspectSummary(db, name);
    }
  } finally {
    db.close();
  }
}

function inspectSummary(
  db: ReturnType<typeof openDatabase>,
  name: string,
): void {
  const stat = statSync(dbPath(name));
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { name: string }[];

  const fileCount = db
    .prepare("SELECT COUNT(*) as count FROM _fs WHERE type = 'file'")
    .get() as { count: number };

  const totalSize = db
    .prepare("SELECT COALESCE(SUM(size), 0) as total FROM _fs WHERE type = 'file'")
    .get() as { total: number };

  console.log(chalk.bold(`Database: ${name}`));
  console.log();
  printKeyValue([
    ['File', dbPath(name)],
    ['Size', formatSize(stat.size)],
    ['Tables', String(tables.length)],
    ['Files in VFS', String(fileCount.count)],
    ['VFS data size', formatSize(totalSize.total)],
  ]);
  console.log();
  console.log(chalk.dim('Tables:'));
  for (const t of tables) {
    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "${t.name}"`)
      .get() as { n: number };
    console.log(`  ${t.name}  ${chalk.dim(`(${count.n} rows)`)}`);
  }
}

function inspectTables(db: ReturnType<typeof openDatabase>): void {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { name: string }[];

  const rows = tables.map((t) => {
    const count = db
      .prepare(`SELECT COUNT(*) as n FROM "${t.name}"`)
      .get() as { n: number };
    const info = db.prepare(`PRAGMA table_info("${t.name}")`).all() as {
      name: string;
      type: string;
    }[];
    return {
      table: t.name,
      rows: count.n,
      columns: info.length,
      column_names: info.map((c) => c.name).join(', '),
    };
  });

  printTable(rows, ['table', 'rows', 'columns', 'column_names']);
}

function inspectSchema(db: ReturnType<typeof openDatabase>): void {
  const rows = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { sql: string }[];
  for (const row of rows) {
    console.log(row.sql + ';\n');
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
