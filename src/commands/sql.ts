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
    chalk.dim(
      `Connected to '${name}'. Type .help for commands, .fshelp for fs_* SQL, .quit to exit.`,
    ),
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

function printFsSqlHelp(): void {
  console.log(chalk.bold('Scalar functions'));
  console.log(
    chalk.dim(
      '  fs_read fs_read_at fs_write fs_write_at fs_append fs_truncate fs_exists fs_size fs_mtime fs_remove fs_mkdir',
    ),
  );
  console.log();
  console.log(chalk.bold('Table-valued functions'));
  console.log(
    chalk.dim(
      '  fs_list(dir)  fs_text(pattern[, options])  fs_csv(pattern[, options])  fs_tsv(pattern[, options])  fs_jsonl(pattern[, options])',
    ),
  );
  console.log();
  console.log(chalk.bold('Glob rules'));
  console.log(
    chalk.dim(
      '  * = one path segment; ** = any depth; ? = one char (no slash). Example: /data/**/*.csv',
    ),
  );
  console.log();
  console.log(chalk.bold('options (2nd arg JSON string)'));
  console.log(
    chalk.dim(
      '  exclude: comma globs | strict: bool | delimiter: string | header: bool',
    ),
  );
  console.log();
  console.log(chalk.bold('Limits (env)'));
  console.log(
    chalk.dim(
      '  AGT0_FS_MAX_FILES  AGT0_FS_MAX_FILE_BYTES  AGT0_FS_MAX_TOTAL_BYTES',
    ),
  );
  console.log(
    chalk.dim(
      '  AGT0_FS_MAX_ROWS  AGT0_FS_PARSE_CHUNK_BYTES  AGT0_FS_PREVIEW_BYTES',
    ),
  );
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
      console.log('  .fshelp    Virtual filesystem SQL functions');
      console.log('  .quit      Exit the REPL');
      console.log('  .help      Show this help');
      break;
    case '.fshelp':
      printFsSqlHelp();
      break;
    default:
      printError(`Unknown command: ${cmd}`);
  }
}
