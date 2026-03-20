import { Command } from 'commander';
import { cmdInit } from './commands/init.js';
import { cmdList } from './commands/list.js';
import { cmdSql } from './commands/sql.js';
import {
  cmdFsLs,
  cmdFsCat,
  cmdFsPut,
  cmdFsGet,
  cmdFsRm,
  cmdFsMkdir,
  cmdFsSh,
} from './commands/fs.js';
import { cmdInspect } from './commands/inspect.js';
import { cmdDump, cmdSeed } from './commands/dump.js';
import { deleteDatabase } from './core/database.js';
import { loadConfig, saveConfig, resolveDbName, dbExists } from './core/config.js';
import { printSuccess, printError, printInfo } from './utils/format.js';
import { copyFileSync } from 'fs';
import { dbPath } from './core/config.js';

const program = new Command();

program
  .name('agt0')
  .description(
    'One file. All your agent needs.\nLocal-first storage for AI agents — database, filesystem, and memory in a single SQLite file.',
  )
  .version('0.1.0');

// ── init ──
program
  .command('init <name>')
  .description('Create a new database')
  .action((name: string) => {
    try {
      cmdInit(name);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── list ──
program
  .command('list')
  .alias('ls')
  .description('List all databases')
  .action(() => {
    try {
      cmdList();
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── delete ──
program
  .command('delete <name>')
  .alias('rm')
  .description('Delete a database')
  .option('-y, --yes', 'Skip confirmation')
  .action((name: string, opts: { yes?: boolean }) => {
    try {
      if (!opts.yes) {
        printInfo(`This will permanently delete database '${name}'.`);
        printInfo('Use --yes to skip confirmation.');
        // Simple sync confirmation via readline
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question('Continue? (y/N) ', (answer: string) => {
          rl.close();
          if (answer.toLowerCase() === 'y') {
            deleteDatabase(name);
            const config = loadConfig();
            if (config.defaultDb === name) {
              config.defaultDb = undefined;
              saveConfig(config);
            }
            printSuccess(`Database '${name}' deleted`);
          }
        });
        return;
      }
      deleteDatabase(name);
      const config = loadConfig();
      if (config.defaultDb === name) {
        config.defaultDb = undefined;
        saveConfig(config);
      }
      printSuccess(`Database '${name}' deleted`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── use ──
program
  .command('use [name]')
  .description('Set or show default database')
  .option('--clear', 'Clear default database')
  .action((name: string | undefined, opts: { clear?: boolean }) => {
    try {
      if (opts.clear) {
        const config = loadConfig();
        config.defaultDb = undefined;
        saveConfig(config);
        printSuccess('Default database cleared');
        return;
      }
      if (!name) {
        const config = loadConfig();
        if (config.defaultDb) {
          printInfo(`Default database: ${config.defaultDb}`);
        } else {
          printInfo('No default database set. Run: agt0 use <name>');
        }
        return;
      }
      if (!dbExists(name)) {
        printError(`Database '${name}' not found. Run: agt0 init ${name}`);
        process.exitCode = 1;
        return;
      }
      const config = loadConfig();
      config.defaultDb = name;
      saveConfig(config);
      printSuccess(`Default database set to '${name}'`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── sql ──
program
  .command('sql [db]')
  .description('Execute SQL (inline, file, or interactive REPL)')
  .option('-q, --query <sql>', 'Execute inline SQL')
  .option('-f, --file <path>', 'Execute SQL from file')
  .action((db: string | undefined, opts: { query?: string; file?: string }) => {
    try {
      cmdSql(db, opts);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── fs ──
const fs = program.command('fs').description('Virtual filesystem operations');

fs.command('ls <target>')
  .description('List files (usage: agt0 fs ls <db>:/path)')
  .action((target: string) => {
    try {
      cmdFsLs(target);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('cat <target>')
  .description('Read file content (usage: agt0 fs cat <db>:/path)')
  .action((target: string) => {
    try {
      cmdFsCat(target);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('put <local> <target>')
  .description('Upload file (usage: agt0 fs put ./file <db>:/path)')
  .option('-r, --recursive', 'Upload directory recursively')
  .action((local: string, target: string, opts: { recursive?: boolean }) => {
    try {
      cmdFsPut(local, target, opts);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('get <target> <local>')
  .description('Download file (usage: agt0 fs get <db>:/path ./file)')
  .action((target: string, local: string) => {
    try {
      cmdFsGet(target, local);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('rm <target>')
  .description('Remove file or directory')
  .option('-r, --recursive', 'Remove recursively')
  .action((target: string, opts: { recursive?: boolean }) => {
    try {
      cmdFsRm(target, opts);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('mkdir <target>')
  .description('Create directory')
  .action((target: string) => {
    try {
      cmdFsMkdir(target);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

fs.command('sh [db]')
  .description('Interactive filesystem shell')
  .action((db: string | undefined) => {
    try {
      cmdFsSh(db);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── inspect ──
program
  .command('inspect [db]')
  .description('Database overview, tables, or schema')
  .argument('[sub]', 'Subcommand: tables, schema')
  .action((db: string | undefined, sub: string | undefined) => {
    try {
      cmdInspect(db, sub);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── dump ──
program
  .command('dump [db]')
  .description('Export database as SQL')
  .option('-o, --output <file>', 'Output file')
  .option('--ddl-only', 'Schema only, no data')
  .action(
    (db: string | undefined, opts: { output?: string; ddlOnly?: boolean }) => {
      try {
        cmdDump(db, opts);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    },
  );

// ── seed ──
program
  .command('seed [db] <file>')
  .description('Run seed SQL file')
  .action((db: string | undefined, file: string) => {
    try {
      // If only one arg, it's the file and db is resolved from config
      if (!file) {
        file = db!;
        db = undefined;
      }
      cmdSeed(db, file);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ── branch ──
program
  .command('branch <action> [db]')
  .description('Branch a database (create/list/delete)')
  .option('-n, --name <name>', 'Branch name')
  .action((action: string, db: string | undefined, opts: { name?: string }) => {
    try {
      const name = resolveDbName(db);
      switch (action) {
        case 'create': {
          if (!opts.name) {
            printError('Branch name required: --name <name>');
            process.exitCode = 1;
            return;
          }
          const branchName = `${name}-${opts.name}`;
          if (dbExists(branchName)) {
            printError(`Branch '${branchName}' already exists`);
            process.exitCode = 1;
            return;
          }
          copyFileSync(dbPath(name), dbPath(branchName));
          printSuccess(`Branch '${branchName}' created from '${name}'`);
          break;
        }
        case 'list': {
          const { listDatabases } = require('./core/config.js');
          const dbs = listDatabases() as string[];
          const branches = dbs.filter(
            (d: string) => d.startsWith(name + '-') && d !== name,
          );
          if (branches.length === 0) {
            printInfo(`No branches for '${name}'`);
          } else {
            for (const b of branches) {
              console.log(`  ${b}`);
            }
          }
          break;
        }
        case 'delete': {
          if (!opts.name) {
            printError('Branch name required: --name <name>');
            process.exitCode = 1;
            return;
          }
          const branchName2 = `${name}-${opts.name}`;
          deleteDatabase(branchName2);
          printSuccess(`Branch '${branchName2}' deleted`);
          break;
        }
        default:
          printError(`Unknown action: ${action}. Use create, list, or delete.`);
          process.exitCode = 1;
      }
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program.parse();
