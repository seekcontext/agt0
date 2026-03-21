# agt0 User Manual

> One file. All your agent needs.

Complete reference for agt0 — local-first storage for AI agents. Database, filesystem, and memory in a single SQLite file.

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [CLI Commands](#cli-commands)
- [SQL + FS Fusion](#sql--fs-fusion)
- [SQL Function Reference](#sql-function-reference)
- [Node.js API](#nodejs-api)
- [Recipes](#recipes)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install -g @seekcontext/agt0
```

Requires **Node.js 20+**.

---

## Getting Started

```bash
# Create a database
agt0 init myapp

# Set as default (omit db name in later commands)
agt0 use myapp

# Upload a CSV and query it
agt0 fs put ./users.csv myapp:/data/users.csv
agt0 sql myapp -q "SELECT * FROM fs_csv('/data/users.csv')"

# Write and read files from SQL
agt0 sql myapp -q "SELECT fs_write('/config.json', '{\"mode\":\"production\"}')"
agt0 sql myapp -q "SELECT json_extract(fs_read('/config.json'), '$.mode')"
```

---

## CLI Commands

### SQL execution

```bash
agt0 sql myapp -q "SELECT * FROM users"     # inline query
agt0 sql myapp -f schema.sql                 # execute file
agt0 sql myapp                               # interactive REPL
```

REPL dot commands: `.help`, `.tables`, `.schema`, `.fshelp`, `.quit`.

### Filesystem

```bash
agt0 fs put ./data.csv myapp:/data/data.csv    # upload file
agt0 fs put -r ./src myapp:/src                # upload directory
agt0 fs get myapp:/data/data.csv ./local.csv   # download
agt0 fs ls myapp:/data/                        # list
agt0 fs cat myapp:/config.json                 # read
agt0 fs rm myapp:/data/old.csv                 # delete
agt0 fs rm -r myapp:/tmp/                      # delete recursive
agt0 fs mkdir myapp:/data/exports              # create directory
agt0 fs sh myapp                               # interactive shell
```

Shell commands: `ls`, `cd`, `cat`, `echo <text> > <path>`, `mkdir`, `rm`, `pwd`, `exit`.

### Database management

```bash
agt0 list                                # list all databases
agt0 inspect myapp                       # overview (tables, files, size)
agt0 inspect myapp tables                # table list with row counts
agt0 inspect myapp schema                # show CREATE statements
agt0 dump myapp -o backup.sql            # export (schema + data)
agt0 dump myapp --ddl-only               # schema only
agt0 seed myapp schema.sql               # run SQL file
agt0 delete myapp --yes                  # delete database
agt0 branch create myapp --name staging  # branch (full copy)
agt0 branch list myapp                   # list branches
agt0 branch delete myapp --name staging  # delete branch
```

---

## SQL + FS Fusion

The core feature: **query files with SQL, write files from SQL**. No import scripts needed.

### Read and write files

```sql
SELECT fs_write('/config/app.json', '{"debug": true, "port": 3000}');
SELECT fs_read('/config/app.json');
SELECT json_extract(fs_read('/config/app.json'), '$.port');

SELECT fs_append('/logs/app.log', 'Started at ' || datetime('now') || char(10));
SELECT fs_exists('/config/app.json'), fs_size('/config/app.json');
```

### Query CSV/TSV

Each CSV row becomes a JSON object in the `_data` column:

```sql
SELECT
  json_extract(_data, '$.name') AS name,
  json_extract(_data, '$.role') AS role
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';
```

### Query JSONL

Each line is available as `line`:

```sql
SELECT
  json_extract(line, '$.level') AS level,
  json_extract(line, '$.message') AS msg
FROM fs_jsonl('/logs/app.jsonl')
WHERE json_extract(line, '$.level') = 'error'
ORDER BY _line_number DESC
LIMIT 10;
```

### Search text files

```sql
SELECT _path, _line_number, line
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%';
```

### Import files into tables

```sql
INSERT INTO users (name, email)
SELECT DISTINCT
  json_extract(_data, '$.name'),
  json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv')
WHERE json_extract(_data, '$.email') IS NOT NULL;
```

### CLI auto-expansion

In `agt0 sql` (REPL, `-q`, `-f`), `fs_csv`/`fs_tsv`/`fs_jsonl` with a **single literal file path** (no globs) are automatically rewritten so `SELECT *` returns real column names:

```
agt0:myapp> SELECT * FROM fs_csv('/data/users.csv') WHERE role = 'admin';
name           email              role
─────────────  ─────────────────  ─────
Alice Johnson  alice@example.com  admin
```

Notes:
- CSV/TSV values are **strings**. For numeric comparison, use `CAST(amount AS REAL) > 100`.
- Glob paths are **not** rewritten — use `json_extract` or `csv_expand`.
- Disable with `AGT0_SQL_FS_EXPAND=0`.
- Node API does not auto-expand; call `expandFsTableSql(sql, db)` yourself (exported from `@seekcontext/agt0`).

### Virtual table modules

For repeated queries on a **single file**, create a virtual table with real columns:

```sql
CREATE VIRTUAL TABLE v_users USING csv_expand('/data/users.csv');
SELECT name, email FROM v_users WHERE role = 'admin';

CREATE VIRTUAL TABLE v_logs USING jsonl_expand('/logs/app.jsonl');
SELECT level, COUNT(*) FROM v_logs GROUP BY level;
```

Modules: `csv_expand`, `tsv_expand`, `jsonl_expand`. Optional 2nd argument is a JSON options string (same keys as the TVFs: `strict`, `delimiter`, `header`).

Schema is fixed at `CREATE VIRTUAL TABLE` time. If the file changes shape, `DROP` and recreate. Globs are not supported.

### Glob patterns

- `*` — one path segment (no `/`)
- `**` — any depth (crosses directories)
- `?` — one character

Example: `/data/**/*.csv` matches all CSVs under `/data/` at any depth.

### TVF options

Optional JSON string as 2nd argument to `fs_text`, `fs_csv`, `fs_tsv`, `fs_jsonl`:

| Key | Type | Description |
|---|---|---|
| `exclude` | string | Comma-separated globs to exclude |
| `strict` | boolean | Fail on malformed rows |
| `delimiter` | string | Custom delimiter (CSV/TSV) |
| `header` | boolean | First row is header (CSV/TSV) |

```sql
SELECT * FROM fs_csv('/data/*.csv', '{"delimiter": ";"}');
SELECT * FROM fs_text('/logs/**/*.log', '{"exclude": "*.tmp"}');
```

### Random access

```sql
SELECT fs_read_at('/data/note.txt', 10, 6);         -- read 6 bytes at offset 10
SELECT fs_write_at('/data/patch.bin', 64, 'patched'); -- write at offset (pads with NUL)
SELECT fs_truncate('/logs/app.log', 0);               -- truncate (log rotation)
```

---

## SQL Function Reference

### Scalar Functions

| Function | Returns | Description |
|---|---|---|
| `fs_read(path)` | TEXT | Read file content |
| `fs_write(path, content)` | INTEGER | Write file, returns bytes written |
| `fs_append(path, data)` | INTEGER | Append to file |
| `fs_exists(path)` | INTEGER | 1 if exists, 0 otherwise |
| `fs_size(path)` | INTEGER | File size in bytes |
| `fs_mtime(path)` | TEXT | Last modified (ISO 8601) |
| `fs_remove(path [, recursive])` | INTEGER | Delete, returns count |
| `fs_mkdir(path [, recursive])` | INTEGER | Create directory |
| `fs_truncate(path, size)` | INTEGER | Truncate to byte size |
| `fs_read_at(path, offset, length)` | TEXT | Read byte range as UTF-8 |
| `fs_write_at(path, offset, data)` | INTEGER | Write at byte offset |

### Table-Valued Functions

| Function | Columns | Description |
|---|---|---|
| `fs_list(dir)` | path, type, size, mode, mtime | Directory listing |
| `fs_text(path [, opts])` | _line_number, line, _path | Text lines |
| `fs_csv(path [, opts])` | _line_number, _data, _path | CSV rows (JSON) |
| `fs_tsv(path [, opts])` | _line_number, _data, _path | TSV rows (JSON) |
| `fs_jsonl(path [, opts])` | _line_number, line, _path | JSONL lines |

### Virtual Table Modules

| Module | Usage |
|---|---|
| `csv_expand` | `CREATE VIRTUAL TABLE t USING csv_expand('/path.csv' [, opts])` |
| `tsv_expand` | `CREATE VIRTUAL TABLE t USING tsv_expand('/path.tsv' [, opts])` |
| `jsonl_expand` | `CREATE VIRTUAL TABLE t USING jsonl_expand('/path.jsonl' [, opts])` |

---

## Node.js API

```bash
npm install @seekcontext/agt0
```

```typescript
import { createDatabase, openDatabase, fsWrite, fsRead, fsList } from '@seekcontext/agt0';

const db = createDatabase('my-agent');

fsWrite(db, '/context/system.md', Buffer.from('You are a helpful assistant.'));

const content = fsRead(db, '/context/system.md');
console.log(content?.toString('utf-8'));

const entries = fsList(db, '/');

const rows = db.prepare("SELECT * FROM fs_csv('/data/users.csv')").all();

db.close();
```

### Exports

| Export | Description |
|---|---|
| `createDatabase(name)` | Create database, returns `Database` |
| `openDatabase(name)` | Open existing database |
| `deleteDatabase(name)` | Delete database |
| `fsWrite(db, path, content)` | Write file (Buffer) |
| `fsRead(db, path)` | Read file → `Buffer \| null` |
| `fsList(db, dirPath)` | List directory entries |
| `expandFsTableSql(sql, db)` | CLI-style auto-expansion for programmatic use |
| `AGT0_HOME` / `DATABASES_DIR` | Storage paths |
| `dbPath(name)` / `dbExists(name)` | Path and existence helpers |
| `listDatabases()` | List all database names |
| `loadConfig()` / `saveConfig(config)` | Global config |
| `resolveDbName(name?)` | Resolve with default fallback |

---

## Recipes

### Agent memory

```bash
agt0 init agent-memory
agt0 sql agent-memory -q "
  SELECT fs_write('/memory/preferences.json', '{\"theme\": \"dark\", \"language\": \"en\"}')
"
agt0 sql agent-memory -q "
  SELECT json_extract(fs_read('/memory/preferences.json'), '$.theme')
"
```

### Project indexing

```bash
agt0 init project-ctx
agt0 fs put -r ./src project-ctx:/src

# Lines per file
agt0 sql project-ctx -q "
  SELECT _path, COUNT(*) AS lines
  FROM fs_text('/src/**/*.ts')
  GROUP BY _path ORDER BY lines DESC
"

# Find TODOs
agt0 sql project-ctx -q "
  SELECT _path, _line_number, line
  FROM fs_text('/src/**/*.ts')
  WHERE line LIKE '%TODO%'
"
```

### Log analysis

```bash
agt0 init logs-db
agt0 fs put ./app.jsonl logs-db:/logs/app.jsonl

agt0 sql logs-db -q "
  SELECT json_extract(line, '$.level') AS level, COUNT(*) AS count
  FROM fs_jsonl('/logs/app.jsonl')
  GROUP BY level ORDER BY count DESC
"
```

### Data pipeline (CSV → table → report)

```bash
agt0 init pipeline
agt0 fs put ./raw-sales.csv pipeline:/raw/sales.csv

agt0 sql pipeline -q "
  CREATE TABLE sales (date TEXT, product TEXT, amount REAL, region TEXT);
  INSERT INTO sales (date, product, amount, region)
  SELECT
    json_extract(_data, '$.date'),
    json_extract(_data, '$.product'),
    CAST(json_extract(_data, '$.amount') AS REAL),
    json_extract(_data, '$.region')
  FROM fs_csv('/raw/sales.csv');
"

agt0 sql pipeline -q "
  SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC
"

agt0 sql pipeline -q "
  SELECT fs_write('/reports/summary.json', (
    SELECT json_group_array(json_object('region', region, 'total', total))
    FROM (SELECT region, SUM(amount) AS total FROM sales GROUP BY region)
  ))
"
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGT0_HOME` | Storage directory | `~/.agt0` |
| `AGT0_FS_MAX_FILES` | Max files per glob | `10000` |
| `AGT0_FS_MAX_FILE_BYTES` | Max bytes per file in TVFs | `64 MiB` |
| `AGT0_FS_MAX_TOTAL_BYTES` | Max total bytes across matched files | `100 MiB` |
| `AGT0_FS_MAX_ROWS` | Max rows per TVF scan (0 = off) | off |
| `AGT0_FS_PARSE_CHUNK_BYTES` | CSV/TSV incremental parse chunk size | `2 MiB` |
| `AGT0_FS_PREVIEW_BYTES` | Per-file header preview for multi-file globs | `256 KiB` |
| `AGT0_FS_EXPAND_JSONL_SCAN_LINES` | Lines scanned by `jsonl_expand` to infer columns | `256` |
| `AGT0_SQL_FS_EXPAND` | CLI auto-expansion of `fs_csv`/`fs_tsv`/`fs_jsonl` | on |

---

## Troubleshooting

**"Database not found"** — Create it first: `agt0 init myapp`

**"No database specified"** — Pass the name or set a default: `agt0 use myapp`

**better-sqlite3 build fails** — `npm rebuild better-sqlite3` (may need `node-gyp` installed)

**Permission errors** — `mkdir -p ~/.agt0/databases && chmod -R u+rw ~/.agt0`

**Custom storage location** — `export AGT0_HOME=/path/to/storage`

**Reset everything** — `rm -rf ~/.agt0` (deletes all databases, not reversible)
