import { statSync } from 'fs';
import { listDatabases, loadConfig, dbPath } from '../core/config.js';
import { printTable } from '../utils/format.js';
import chalk from 'chalk';

export function cmdList(): void {
  const dbs = listDatabases();
  if (dbs.length === 0) {
    console.log(chalk.dim('No databases yet. Run: agt0 init <name>'));
    return;
  }

  const config = loadConfig();
  const rows = dbs.map((name) => {
    const stat = statSync(dbPath(name));
    return {
      name: name === config.defaultDb ? `${name} ${chalk.green('*')}` : name,
      size: formatSize(stat.size),
      modified: stat.mtime.toISOString().slice(0, 19).replace('T', ' '),
    };
  });

  printTable(rows, ['name', 'size', 'modified']);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
