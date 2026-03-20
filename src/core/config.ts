import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const AGT0_HOME = join(homedir(), '.agt0');
export const DATABASES_DIR = join(AGT0_HOME, 'databases');
export const CONFIG_FILE = join(AGT0_HOME, 'config.json');

export interface Agt0Config {
  defaultDb?: string;
}

export function ensureHome(): void {
  if (!existsSync(AGT0_HOME)) mkdirSync(AGT0_HOME, { recursive: true });
  if (!existsSync(DATABASES_DIR)) mkdirSync(DATABASES_DIR, { recursive: true });
}

export function loadConfig(): Agt0Config {
  ensureHome();
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(config: Agt0Config): void {
  ensureHome();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function resolveDbName(nameOrUndefined?: string): string {
  if (nameOrUndefined) return nameOrUndefined;
  const config = loadConfig();
  if (config.defaultDb) return config.defaultDb;
  throw new Error(
    'No database specified. Use <db> argument or run: agt0 use <db>',
  );
}

export function dbPath(name: string): string {
  return join(DATABASES_DIR, `${name}.db`);
}

export function dbExists(name: string): boolean {
  return existsSync(dbPath(name));
}

export function listDatabases(): string[] {
  ensureHome();
  return readdirSync(DATABASES_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => f.replace(/\.db$/, ''));
}
