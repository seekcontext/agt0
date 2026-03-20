import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { openDatabase } from '../core/database.js';
import { resolveDbName } from '../core/config.js';
import { printTable, printSuccess, printError } from '../utils/format.js';
import chalk from 'chalk';

export function cmdSql(
  dbName: string | undefined,
  options: { query?: string; file?: string },
): void {
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    if (options.query) {
      executeSql(db, options.query);
    } else if (options.file) {
      const sql = readFileSync(options.file, 'utf-8');
      executeSql(db, sql);
    } else {
      startRepl(db, name);
    }
  } finally {
    if (options.query || options.file) {
      db.close();
    }
  }
}

function executeSql(db: ReturnType<typeof openDatabase>, sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) return;

  // Split by semicolons for multi-statement execution
  const statements = trimmed
    .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    try {
      const upper = stmt.toUpperCase().trimStart();
      if (
        upper.startsWith('SELECT') ||
        upper.startsWith('PRAGMA') ||
        upper.startsWith('WITH') ||
        upper.startsWith('EXPLAIN')
      ) {
        const rows = db.prepare(stmt).all() as Record<string, unknown>[];
        printTable(rows);
      } else {
        const result = db.prepare(stmt).run();
        printSuccess(`${result.changes} row(s) affected`);
      }
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  }
}

function startRepl(db: ReturnType<typeof openDatabase>, name: string): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan(`agt0:${name}> `),
    terminal: true,
  });

  console.log(
    chalk.dim(`Connected to '${name}'. Type .help for commands, .quit to exit.`),
  );
  console.log();

  let buffer = '';

  rl.prompt();

  rl.on('line', (line: string) => {
    const trimmed = line.trim();

    // Dot commands
    if (!buffer && trimmed.startsWith('.')) {
      handleDotCommand(db, trimmed);
      rl.prompt();
      return;
    }

    buffer += (buffer ? '\n' : '') + line;

    // Execute when we see a semicolon at the end
    if (trimmed.endsWith(';')) {
      executeSql(db, buffer);
      buffer = '';
      rl.setPrompt(chalk.cyan(`agt0:${name}> `));
    } else {
      rl.setPrompt(chalk.dim('...> '));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    db.close();
    console.log();
  });
}

function handleDotCommand(
  db: ReturnType<typeof openDatabase>,
  cmd: string,
): void {
  switch (cmd.split(/\s+/)[0]) {
    case '.quit':
    case '.exit':
      db.close();
      process.exit(0);
      break;
    case '.tables': {
      const rows = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as { name: string }[];
      for (const row of rows) {
        console.log(row.name);
      }
      break;
    }
    case '.schema': {
      const rows = db
        .prepare(
          `SELECT sql FROM sqlite_master
           WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all() as { sql: string }[];
      for (const row of rows) {
        console.log(row.sql + ';');
      }
      break;
    }
    case '.help':
      console.log(chalk.dim('Commands:'));
      console.log('  .tables    List all tables');
      console.log('  .schema    Show CREATE statements');
      console.log('  .quit      Exit the REPL');
      console.log('  .help      Show this help');
      break;
    default:
      printError(`Unknown command: ${cmd}`);
  }
}
