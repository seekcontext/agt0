import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { basename, posix, resolve } from 'path';
import { openDatabase } from '../core/database.js';
import { resolveDbName } from '../core/config.js';
import { fsWrite, fsRead, fsList } from '../core/virtual-fs.js';
import { printTable, printSuccess, printError, printInfo } from '../utils/format.js';
import chalk from 'chalk';

// ── agt0 fs ls <db>:/path ──
export function cmdFsLs(target: string): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const entries = fsList(db, fsPath);
    if (entries.length === 0) {
      console.log(chalk.dim('(empty directory)'));
      return;
    }
    const rows = entries.map((e) => ({
      type: e.type === 'dir' ? chalk.blue('dir') : 'file',
      size: e.type === 'file' ? formatSize(e.size) : '-',
      mtime: e.mtime.slice(0, 19).replace('T', ' '),
      path: e.type === 'dir' ? chalk.blue(e.path) : e.path,
    }));
    printTable(rows, ['type', 'size', 'mtime', 'path']);
  } finally {
    db.close();
  }
}

// ── agt0 fs cat <db>:/path ──
export function cmdFsCat(target: string): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const content = fsRead(db, fsPath);
    if (content === null) {
      printError(`File not found: ${fsPath}`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(content);
    if (!content.toString('utf-8').endsWith('\n')) {
      process.stdout.write('\n');
    }
  } finally {
    db.close();
  }
}

// ── agt0 fs put <local> <db>:/path ──
export function cmdFsPut(
  localPath: string,
  target: string,
  options: { recursive?: boolean },
): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    if (options.recursive && existsSync(localPath) && statSync(localPath).isDirectory()) {
      putRecursive(db, localPath, fsPath);
    } else {
      if (!existsSync(localPath)) {
        printError(`Local file not found: ${localPath}`);
        process.exitCode = 1;
        return;
      }
      const content = readFileSync(localPath);
      const targetPath = fsPath.endsWith('/')
        ? posix.join(fsPath, basename(localPath))
        : fsPath;
      fsWrite(db, targetPath, content);
      printSuccess(`${localPath} → ${targetPath} (${formatSize(content.length)})`);
    }
  } finally {
    db.close();
  }
}

function putRecursive(
  db: ReturnType<typeof openDatabase>,
  localDir: string,
  fsDir: string,
): void {
  const entries = readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localFull = resolve(localDir, entry.name);
    const remoteFull = posix.join(fsDir, entry.name);
    if (entry.isDirectory()) {
      putRecursive(db, localFull, remoteFull);
    } else if (entry.isFile()) {
      const content = readFileSync(localFull);
      fsWrite(db, remoteFull, content);
      printSuccess(`${localFull} → ${remoteFull}`);
    }
  }
}

// ── agt0 fs get <db>:/path <local> ──
export function cmdFsGet(target: string, localPath: string): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const content = fsRead(db, fsPath);
    if (content === null) {
      printError(`File not found: ${fsPath}`);
      process.exitCode = 1;
      return;
    }
    writeFileSync(localPath, content);
    printSuccess(`${fsPath} → ${localPath} (${formatSize(content.length)})`);
  } finally {
    db.close();
  }
}

// ── agt0 fs rm <db>:/path ──
export function cmdFsRm(target: string, options: { recursive?: boolean }): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    const rec = options.recursive ? 1 : 0;
    const result = db.prepare(
      rec
        ? "DELETE FROM _fs WHERE path = ? OR path LIKE ? || '/%'"
        : 'DELETE FROM _fs WHERE path = ?',
    );
    const changes = rec
      ? result.run(fsPath, fsPath).changes
      : result.run(fsPath).changes;
    if (changes === 0) {
      printError(`Not found: ${fsPath}`);
    } else {
      printSuccess(`Removed ${changes} entry(s)`);
    }
  } finally {
    db.close();
  }
}

// ── agt0 fs mkdir <db>:/path ──
export function cmdFsMkdir(target: string): void {
  const { dbName, fsPath } = parseTarget(target);
  const name = resolveDbName(dbName);
  const db = openDatabase(name);

  try {
    db.prepare(`SELECT fs_mkdir(?, 1)`).run(fsPath);
    printSuccess(`Created directory: ${fsPath}`);
  } finally {
    db.close();
  }
}

// ── agt0 fs sh <db> — interactive file shell ──
export function cmdFsSh(dbName: string | undefined): void {
  const name = resolveDbName(dbName);
  const db = openDatabase(name);
  let cwd = '/';

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.yellow(`fs:${cwd}> `),
    terminal: true,
  });

  console.log(
    chalk.dim(`Filesystem shell for '${name}'. Type 'help' to see commands.`),
  );
  console.log();

  rl.prompt();

  rl.on('line', (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const [cmd, ...args] = parseShellArgs(trimmed);

    try {
      switch (cmd) {
        case 'ls':
          shellLs(db, resolveFsPath(cwd, args[0] || '.'));
          break;
        case 'cat':
          if (!args[0]) {
            printError('Usage: cat <path>');
          } else {
            shellCat(db, resolveFsPath(cwd, args[0]));
          }
          break;
        case 'echo': {
          const { content, targetPath } = parseEchoRedirect(args, cwd);
          if (targetPath) {
            db.prepare('SELECT fs_write(?, ?)').run(targetPath, content);
            printSuccess(`Wrote to ${targetPath}`);
          } else {
            console.log(content);
          }
          break;
        }
        case 'mkdir':
          if (!args[0]) {
            printError('Usage: mkdir <path>');
          } else {
            db.prepare('SELECT fs_mkdir(?, 1)').run(resolveFsPath(cwd, args[0]));
            printSuccess(`Created: ${resolveFsPath(cwd, args[0])}`);
          }
          break;
        case 'rm':
          if (!args[0]) {
            printError('Usage: rm <path>');
          } else {
            const p = resolveFsPath(cwd, args[0]);
            const r = db.prepare('DELETE FROM _fs WHERE path = ?').run(p);
            r.changes > 0
              ? printSuccess(`Removed: ${p}`)
              : printError(`Not found: ${p}`);
          }
          break;
        case 'cd':
          if (!args[0] || args[0] === '/') {
            cwd = '/';
          } else if (args[0] === '..') {
            cwd = posix.dirname(cwd);
          } else {
            cwd = resolveFsPath(cwd, args[0]);
          }
          rl.setPrompt(chalk.yellow(`fs:${cwd}> `));
          break;
        case 'pwd':
          console.log(cwd);
          break;
        case 'exit':
        case 'quit':
          db.close();
          rl.close();
          return;
        case 'help':
          console.log(chalk.dim('Commands:'));
          console.log('  ls [path]                List directory');
          console.log("  cat <path>               Read file");
          console.log("  echo <text> > <path>     Write file");
          console.log('  mkdir <path>             Create directory');
          console.log('  rm <path>                Remove file');
          console.log('  cd <path>                Change directory');
          console.log('  pwd                      Print working directory');
          console.log('  exit                     Exit shell');
          break;
        default:
          printError(`Unknown command: ${cmd}. Type 'help' for available commands.`);
      }
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    db.close();
    console.log();
  });
}

// ── helpers ──

function parseTarget(target: string): { dbName: string | undefined; fsPath: string } {
  const colonIdx = target.indexOf(':');
  if (colonIdx === -1) {
    return { dbName: undefined, fsPath: target.startsWith('/') ? target : '/' + target };
  }
  const dbName = target.slice(0, colonIdx) || undefined;
  let fsPath = target.slice(colonIdx + 1);
  if (!fsPath.startsWith('/')) fsPath = '/' + fsPath;
  return { dbName, fsPath };
}

function resolveFsPath(cwd: string, relative: string): string {
  if (relative.startsWith('/')) return posix.normalize(relative);
  return posix.normalize(posix.join(cwd, relative));
}

function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

function parseEchoRedirect(
  args: string[],
  cwd: string,
): { content: string; targetPath: string | null } {
  const redirectIdx = args.indexOf('>');
  if (redirectIdx === -1) {
    return { content: args.join(' '), targetPath: null };
  }
  const content = args.slice(0, redirectIdx).join(' ');
  const target = args[redirectIdx + 1];
  if (!target) {
    return { content, targetPath: null };
  }
  return { content, targetPath: resolveFsPath(cwd, target) };
}

function shellLs(db: ReturnType<typeof openDatabase>, path: string): void {
  const entries = fsList(db, path);
  if (entries.length === 0) {
    console.log(chalk.dim('(empty)'));
    return;
  }
  for (const e of entries) {
    const name = e.path.split('/').pop() || e.path;
    if (e.type === 'dir') {
      console.log(chalk.blue(name + '/'));
    } else {
      console.log(`${name}  ${chalk.dim(formatSize(e.size))}`);
    }
  }
}

function shellCat(db: ReturnType<typeof openDatabase>, path: string): void {
  const content = fsRead(db, path);
  if (content === null) {
    printError(`File not found: ${path}`);
    return;
  }
  process.stdout.write(content);
  if (!content.toString('utf-8').endsWith('\n')) {
    process.stdout.write('\n');
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
