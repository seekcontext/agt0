export { createDatabase, openDatabase, deleteDatabase } from './core/database.js';
export { fsWrite, fsRead, fsList } from './core/virtual-fs.js';
export type { FsEntry } from './core/virtual-fs.js';
export {
  AGT0_HOME,
  DATABASES_DIR,
  dbPath,
  dbExists,
  listDatabases,
  loadConfig,
  saveConfig,
  resolveDbName,
} from './core/config.js';
export type { Agt0Config } from './core/config.js';
