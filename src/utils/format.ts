import chalk from 'chalk';

export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  if (rows.length === 0) {
    console.log(chalk.dim('(no results)'));
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((col) => {
    const maxVal = rows.reduce((max, row) => {
      const val = formatCell(row[col]);
      return Math.max(max, val.length);
    }, col.length);
    return Math.min(maxVal, 60);
  });

  // Header
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(chalk.bold(header));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));

  // Rows
  for (const row of rows) {
    const line = cols
      .map((c, i) => {
        const val = formatCell(row[c]);
        return val.slice(0, widths[i]).padEnd(widths[i]);
      })
      .join('  ');
    console.log(line);
  }

  console.log(chalk.dim(`\n(${rows.length} row${rows.length !== 1 ? 's' : ''})`));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `<BLOB ${value.length}B>`;
  return String(value);
}

export function printSuccess(msg: string): void {
  console.log(chalk.green('✓') + ' ' + msg);
}

export function printError(msg: string): void {
  console.error(chalk.red('✗') + ' ' + msg);
}

export function printInfo(msg: string): void {
  console.log(chalk.blue('ℹ') + ' ' + msg);
}

export function printKeyValue(pairs: [string, string | number][]): void {
  const maxKey = Math.max(...pairs.map(([k]) => k.length));
  for (const [key, val] of pairs) {
    console.log(`  ${chalk.dim(key.padEnd(maxKey))}  ${val}`);
  }
}
