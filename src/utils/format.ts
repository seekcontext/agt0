import chalk from 'chalk';

/** Max width per column when printing to a TTY; split terminal width across columns. */
function ttyColumnWidthCap(columnCount: number): number | undefined {
  if (!process.stdout.isTTY) return undefined;
  const tw = process.stdout.columns;
  if (!tw || tw < 24) return 72;
  const gutter = 2 * Math.max(0, columnCount - 1);
  const usable = tw - gutter;
  return Math.max(8, Math.floor(usable / columnCount));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  if (rows.length === 0) {
    console.log(chalk.dim('(no results)'));
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);
  const cap = ttyColumnWidthCap(cols.length);
  const widths = cols.map((col) => {
    const maxVal = rows.reduce((max, row) => {
      const val = formatCell(row[col]);
      return Math.max(max, val.length);
    }, col.length);
    if (cap === undefined) return maxVal;
    // Fit terminal, but never truncate the column header label.
    return Math.max(Math.min(maxVal, cap), col.length);
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
