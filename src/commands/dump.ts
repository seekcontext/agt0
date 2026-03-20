import { writeFileSync, readFileSync } from 'fs';
import { openDatabase } from '../core/database.js';
import { resolveDbName } from '../core/config.js';
import { printSuccess } from '../utils/format.js';

export function cmdDump(
  dbName: string | undefined,
  options: { output?: string; ddlOnly?: boolean },
): void {
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const lines: string[] = [];
    lines.push(`-- agt0 dump: ${name}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Get all CREATE statements
    const objects = db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
         ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name`,
      )
      .all() as { type: string; name: string; sql: string }[];

    for (const obj of objects) {
      lines.push(obj.sql + ';');
      lines.push('');
    }

    // Dump data unless DDL-only
    if (!options.ddlOnly) {
      const tables = objects
        .filter((o) => o.type === 'table')
        .map((o) => o.name);

      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
        if (rows.length === 0) continue;

        lines.push(`-- Data for ${table}`);
        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map((c) => sqlLiteral(row[c]));
          lines.push(
            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`,
          );
        }
        lines.push('');
      }
    }

    const output = lines.join('\n');

    if (options.output) {
      writeFileSync(options.output, output);
      printSuccess(`Dumped to ${options.output}`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    db.close();
  }
}

export function cmdSeed(dbName: string | undefined, file: string): void {
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const sql = readFileSync(file, 'utf-8');
    db.exec(sql);
    printSuccess(`Seeded '${name}' from ${file}`);
  } finally {
    db.close();
  }
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
