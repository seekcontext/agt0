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
export {
  normalizeVirtualPath,
  normalizeGlobPattern,
  globToRegExp,
  readFsLimits,
  parseFsTableOptions,
  isGlobPattern,
  sqlLikeLiteralPrefix,
  toAbsoluteExcludeGlob,
} from './core/fs-path.js';
export type { FsTableOptions, FsReadLimits } from './core/fs-path.js';
export {
  expandFsTableSql,
  isSqlFsExpandEnabled,
} from './core/sql-fs-expand.js';
export type { FsTableExpandName } from './core/sql-fs-expand.js';
