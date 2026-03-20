import { createDatabase } from '../core/database.js';
import { saveConfig, loadConfig } from '../core/config.js';
import { printSuccess, printKeyValue } from '../utils/format.js';
import { dbPath } from '../core/config.js';

export function cmdInit(name: string): void {
  const db = createDatabase(name);
  db.close();

  const config = loadConfig();
  if (!config.defaultDb) {
    config.defaultDb = name;
    saveConfig(config);
  }

  printSuccess(`Database '${name}' created`);
  console.log();
  printKeyValue([
    ['Name', name],
    ['Path', dbPath(name)],
    ['Status', 'active'],
  ]);
}
