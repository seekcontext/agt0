# agt0 User Manual

> One file. All your agent needs.

Complete reference for agt0 — local-first storage for AI agents with database, filesystem, and memory in a single SQLite file.

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [SQL Execution](#sql-execution)
- [Virtual Filesystem (CLI)](#virtual-filesystem-cli)
- [Interactive Shells](#interactive-shells)
- [SQL + FS Fusion](#sql--fs-fusion)
- [Database Management](#database-management)
- [Programmatic API (Node.js)](#programmatic-api-nodejs)
- [Recipes](#recipes)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install -g @seekcontext/agt0
```

Requires **Node.js 20** or later. Verify the installation:

```bash
agt0 --version
```

---

## Getting Started

### 1. Create a database

```bash
agt0 init myapp
```

This creates `~/.agt0/databases/myapp.db` — a single SQLite file that holds tables, files, and agent memory. The first database you create is automatically set as the default.

### 2. Set the default database

```bash
agt0 use myapp
```

With a default set, you can omit the database name from most commands:

```bash
# These are equivalent when myapp is the default:
agt0 sql myapp -q "SELECT 1"
agt0 sql -q "SELECT 1"

# Clear the default
agt0 use --clear

# Show current default
agt0 use
```

### 3. Your first SQL query

```bash
agt0 sql myapp -q "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
agt0 sql myapp -q "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')"
agt0 sql myapp -q "SELECT * FROM users"
```

### 4. Your first file operation

```bash
# Upload a file into the virtual filesystem
agt0 fs put ./readme.txt myapp:/docs/readme.txt

# Read it back
agt0 fs cat myapp:/docs/readme.txt

# Query it with SQL
agt0 sql myapp -q "SELECT fs_read('/docs/readme.txt')"
```

---

## SQL Execution

### Inline query

```bash
agt0 sql myapp -q "SELECT * FROM users WHERE name = 'Alice'"
```

### Execute a SQL file

```bash
agt0 sql myapp -f schema.sql
```

The file must exist on the local filesystem.

### Interactive REPL

```bash
agt0 sql myapp
```

When neither `-q` nor `-f` is provided, agt0 opens an interactive SQL REPL. Type SQL statements ending with `;` to execute.

**Dot commands** (available only in the SQL REPL):

| Command | Description |
|---|---|
| `.help` | Show all dot commands |
| `.tables` | List all tables |
| `.schema` | Show CREATE statements for all tables |
| `.fshelp` | Show all `fs_*` SQL functions with usage |
| `.quit` | Exit the REPL |

Example session:

```
agt0:myapp> SELECT * FROM users;
agt0:myapp> .tables
agt0:myapp> .schema
agt0:myapp> .fshelp
agt0:myapp> .quit
```

---

## Virtual Filesystem (CLI)

Every agt0 database has a built-in virtual filesystem. Files are stored inside the SQLite database itself — not on the regular filesystem.

### Upload files

```bash
# Single file
agt0 fs put ./data.csv myapp:/data/data.csv

# Entire directory (recursive)
agt0 fs put -r ./project/src myapp:/src
```

### List files

```bash
agt0 fs ls myapp:/
agt0 fs ls myapp:/data/
```

### Read a file

```bash
agt0 fs cat myapp:/data/data.csv
```

### Download a file

```bash
agt0 fs get myapp:/data/data.csv ./downloaded.csv
```

### Delete files

```bash
# Single file
agt0 fs rm myapp:/data/old.csv

# Directory (recursive)
agt0 fs rm -r myapp:/tmp/
```

### Create directories

```bash
agt0 fs mkdir myapp:/data/exports
```

---

## Interactive Shells

### SQL REPL (`agt0 sql`)

```bash
agt0 sql myapp
```

Full SQL execution environment with dot commands. See [SQL Execution](#sql-execution) above.

### Filesystem Shell (`agt0 fs sh`)

```bash
agt0 fs sh myapp
```

A POSIX-like interactive shell for browsing and editing the virtual filesystem.

Available commands:

| Command | Description |
|---|---|
| `ls` | List current directory |
| `cd <dir>` | Change directory |
| `cat <file>` | Read file content |
| `echo <text> > <path>` | Write text to a file |
| `mkdir <dir>` | Create directory |
| `rm <path>` | Delete file or directory |
| `pwd` | Print working directory |
| `help` | Show available commands |
| `exit` | Exit the shell |

Example session:

```
fs:/> ls
fs:/> mkdir data
fs:/> cd data
fs:/data> echo '{"key": "value"}' > config.json
fs:/data> cat config.json
fs:/data> cd ..
fs:/> exit
```

> **Note:** The filesystem shell and SQL REPL are separate interfaces. Dot commands (`.help`, `.tables`) work only in the SQL REPL. Shell commands (`ls`, `cd`, `cat`) work only in `agt0 fs sh`.

---

## SQL + FS Fusion

This is agt0's defining feature: **query files with SQL, manipulate files from SQL**. No import scripts, no ETL pipelines.

### Read and write files from SQL

```sql
-- Write a configuration file
SELECT fs_write('/config/app.json', '{"debug": true, "port": 3000}');

-- Read it back
SELECT fs_read('/config/app.json');
-- → {"debug": true, "port": 3000}

-- Parse JSON fields
SELECT json_extract(fs_read('/config/app.json'), '$.port');
-- → 3000

-- Append to a log file
SELECT fs_append('/logs/app.log', 'Started at ' || datetime('now') || char(10));

-- Check if a file exists and its size
SELECT fs_exists('/config/app.json'), fs_size('/config/app.json');
-- → 1, 29
```

### Query CSV files as tables

Upload a CSV and query it immediately — no `CREATE TABLE`, no import script:

```bash
agt0 fs put ./users.csv myapp:/data/users.csv
```

```sql
SELECT
  json_extract(_data, '$.name') AS name,
  json_extract(_data, '$.email') AS email,
  json_extract(_data, '$.role') AS role
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';
```

Each row is returned with `_data` as a JSON object containing all columns. Access individual fields with `json_extract(_data, '$.column_name')`.

### Dynamic columns: `csv_expand`, `tsv_expand`, `jsonl_expand`

When you want **real column names** (no `json_extract` on `_data` / `line`), create a **virtual table** for one file. The path must be a **single file** — **globs are not allowed** (use `fs_csv` / `fs_tsv` / `fs_jsonl` for patterns).

```sql
CREATE VIRTUAL TABLE v_users USING csv_expand('/data/users.csv');
SELECT name, email FROM v_users WHERE role = 'admin';

CREATE VIRTUAL TABLE v_sales USING tsv_expand('/data/export.tsv');

CREATE VIRTUAL TABLE v_logs USING jsonl_expand('/logs/app.jsonl');
SELECT level, COUNT(*) FROM v_logs GROUP BY level;
```

Optional **2nd argument**: same JSON options string as the TVFs (`exclude` applies only to other APIs; for expand it is ignored). Examples: `'{"strict": true}'`, `'{"header": false}'`, `'{"delimiter": "|"}'` (for `csv_expand`).

**JSONL schema:** columns are the sorted **union** of keys from JSON **objects** in the first `AGT0_FS_EXPAND_JSONL_SCAN_LINES` non-empty lines (default `256`). Values that are nested objects/arrays are stored as JSON **text**. If `strict` is `false`, a nullable `_raw` column is included: valid object lines have `_raw` SQL `NULL`; bad lines store the source line in `_raw`. If no object keys are found, the table has `_line_number`, `_path`, and either `_raw` (non-strict) or `line` (strict).

**CSV/TSV:** if a normal header cannot be inferred from the preview, the virtual table has `_line_number`, `_path`, `_raw` only (one row per non-empty line). Otherwise each header becomes a column (names may be prefixed to avoid clashes with `_line_number` / `_path` / `_raw`).

**Lifecycle:** the schema is fixed when you run `CREATE VIRTUAL TABLE`. If the file layout changes, run `DROP TABLE v_users` (or your name) and create it again.

### Query JSONL log files

```sql
SELECT
  json_extract(line, '$.timestamp') AS ts,
  json_extract(line, '$.level') AS level,
  json_extract(line, '$.message') AS msg
FROM fs_jsonl('/logs/app.jsonl')
WHERE json_extract(line, '$.level') = 'error'
ORDER BY _line_number DESC
LIMIT 10;
```

### Search text files (grep-like)

```sql
-- Find lines matching a pattern
SELECT _path, _line_number, line
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%';

-- Count errors per file
SELECT _path, COUNT(*) AS error_count
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%'
GROUP BY _path
ORDER BY error_count DESC;
```

### List files from SQL

```sql
-- List all files and directories
SELECT path, type, size, mode, mtime
FROM fs_list('/')
ORDER BY mtime DESC;

-- Find large files
SELECT path, size
FROM fs_list('/data/')
WHERE size > 1000000;
```

### Random access (byte-level)

```sql
-- Write a file first
SELECT fs_write('/data/note.txt', '0123456789ABCDEF');

-- Read 6 bytes starting at offset 10
SELECT fs_read_at('/data/note.txt', 10, 6);
-- → ABCDEF

-- Overwrite at offset (pads with NUL bytes if beyond EOF)
SELECT fs_write_at('/data/patch.bin', 64, 'patched');

-- Truncate a file (e.g., log rotation)
SELECT fs_truncate('/logs/app.log', 0);
```

### The bridge: file → table

The most powerful pattern — read from files, insert into proper tables:

```sql
-- Import CSV into a typed table with deduplication
INSERT INTO users (name, email)
SELECT DISTINCT
  json_extract(_data, '$.name'),
  json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv')
WHERE json_extract(_data, '$.email') IS NOT NULL;
```

### Glob patterns and options

**Glob syntax:**
- `*` — matches one path segment (no `/`)
- `**` — matches any depth (crosses directories)
- `?` — matches one character (not `/`)
- Example: `/data/**/*.csv` matches all CSV files under `/data/` at any depth

**Table function options** (optional JSON string as 2nd argument):

| Key | Type | Description |
|---|---|---|
| `exclude` | string | Comma-separated globs to exclude |
| `strict` | boolean | Fail on malformed CSV/JSONL rows |
| `delimiter` | string | Custom delimiter for CSV/TSV |
| `header` | boolean | Whether first row is header (CSV/TSV) |

Example:

```sql
SELECT * FROM fs_text('/logs/**/*.log', '{"exclude": "*.tmp,*.bak"}');
SELECT * FROM fs_csv('/data/*.csv', '{"delimiter": ";", "header": true}');
```

When glob matches multiple files, columns are the **union** of all headers across files (missing values appear as JSON `null` in `_data`).

---

## Database Management

### List databases

```bash
agt0 list
```

Shows all databases with size and last modified time. The default database is marked with `*`.

### Inspect a database

```bash
# Summary overview (tables, file count, total size)
agt0 inspect myapp

# Table list with row counts
agt0 inspect myapp tables

# Show CREATE statements
agt0 inspect myapp schema
```

### Export a database

```bash
# Full dump (schema + data) to file
agt0 dump myapp -o backup.sql

# Schema only (no data)
agt0 dump myapp --ddl-only -o schema.sql

# Print to stdout
agt0 dump myapp
```

### Import SQL

```bash
agt0 seed myapp schema.sql
```

Runs the SQL file against the database.

### Branching

Create isolated copies for testing or experimentation:

```bash
# Create a branch (full copy of the .db file)
agt0 branch create myapp --name staging

# List branches
agt0 branch list myapp

# Delete a branch
agt0 branch delete myapp --name staging
```

Branches are independent copies. Changes to a branch do not affect the original.

### Delete a database

```bash
agt0 delete myapp --yes
```

---

## Programmatic API (Node.js)

agt0 can be imported as an npm module for use in your own applications:

```bash
npm install @seekcontext/agt0
```

### Basic usage

```typescript
import { createDatabase, openDatabase, fsWrite, fsRead, fsList } from '@seekcontext/agt0';

// Create a new database (or open existing with openDatabase)
const db = createDatabase('my-agent');

// Write a file
fsWrite(db, '/context/system.md', Buffer.from('You are a helpful assistant.'));

// Read it back
const content = fsRead(db, '/context/system.md');
console.log(content?.toString('utf-8'));
// → You are a helpful assistant.

// List files
const entries = fsList(db, '/');
console.log(entries);
// → [{ path: '/context', type: 'dir', size: 0, mode: 0, mtime: '...' }]

db.close();
```

### SQL from code

```typescript
import { openDatabase } from '@seekcontext/agt0';

const db = openDatabase('my-agent');

// Use fs_* functions in SQL
db.prepare("SELECT fs_write('/data/hello.txt', 'Hello World')").run();
const result = db.prepare("SELECT fs_read('/data/hello.txt') AS content").get() as { content: string };
console.log(result.content);

// Query tables
const rows = db.prepare("SELECT * FROM fs_csv('/data/users.csv')").all();

db.close();
```

### Exported API

| Export | Description |
|---|---|
| `createDatabase(name)` | Create a new database, returns `Database` |
| `openDatabase(name)` | Open an existing database, returns `Database` |
| `deleteDatabase(name)` | Delete a database |
| `fsWrite(db, path, content)` | Write a file (Buffer) |
| `fsRead(db, path)` | Read a file, returns `Buffer \| null` |
| `fsList(db, dirPath)` | List directory entries |
| `AGT0_HOME` | Base directory path (`~/.agt0`) |
| `DATABASES_DIR` | Databases directory path |
| `dbPath(name)` | Get full path for a database name |
| `dbExists(name)` | Check if a database exists |
| `listDatabases()` | List all database names |
| `loadConfig()` / `saveConfig(config)` | Read/write global config |
| `resolveDbName(name?)` | Resolve database name (with default fallback) |

---

## Recipes

### Recipe 1: Agent persistent memory

Store agent context and preferences that survive across sessions:

```bash
agt0 init agent-memory
agt0 sql agent-memory -q "
  SELECT fs_write('/memory/preferences.json', '{
    \"theme\": \"dark\",
    \"language\": \"en\",
    \"verbosity\": \"concise\"
  }')
"

# Later: read preferences back
agt0 sql agent-memory -q "
  SELECT json_extract(fs_read('/memory/preferences.json'), '$.theme')
"
# → dark

# Append conversation summaries
agt0 sql agent-memory -q "
  SELECT fs_append('/memory/history.md',
    '## Session ' || datetime('now') || char(10) ||
    'User asked about database design.' || char(10) || char(10))
"
```

### Recipe 2: Project context for a coding agent

Index an entire codebase for analysis:

```bash
agt0 init project-ctx
agt0 fs put -r ./src project-ctx:/src
agt0 fs put ./package.json project-ctx:/package.json

# Lines per file
agt0 sql project-ctx -q "
  SELECT _path, COUNT(*) AS lines
  FROM fs_text('/src/**/*.ts')
  GROUP BY _path
  ORDER BY lines DESC
"

# Find all TODO comments
agt0 sql project-ctx -q "
  SELECT _path, _line_number, line
  FROM fs_text('/src/**/*.ts')
  WHERE line LIKE '%TODO%'
  ORDER BY _path, _line_number
"
```

### Recipe 3: Log analysis

```bash
agt0 init logs-db
agt0 fs put ./app.jsonl logs-db:/logs/app.jsonl

# Error distribution by level
agt0 sql logs-db -q "
  SELECT
    json_extract(line, '$.level') AS level,
    COUNT(*) AS count
  FROM fs_jsonl('/logs/app.jsonl')
  GROUP BY level
  ORDER BY count DESC
"

# Recent errors with context
agt0 sql logs-db -q "
  SELECT
    json_extract(line, '$.timestamp') AS ts,
    json_extract(line, '$.message') AS msg
  FROM fs_jsonl('/logs/app.jsonl')
  WHERE json_extract(line, '$.level') = 'error'
  ORDER BY _line_number DESC
  LIMIT 20
"
```

### Recipe 4: Configuration management

```bash
agt0 init config

# Store environment configs
agt0 sql config -q "SELECT fs_write('/env/production.json', '{
  \"database_url\": \"postgres://prod:5432/app\",
  \"redis_url\": \"redis://prod:6379\",
  \"debug\": false
}')"

agt0 sql config -q "SELECT fs_write('/env/staging.json', '{
  \"database_url\": \"postgres://stage:5432/app\",
  \"redis_url\": \"redis://stage:6379\",
  \"debug\": true
}')"

# Compare configs
agt0 sql config -q "
  SELECT
    json_extract(fs_read('/env/production.json'), '$.debug') AS prod_debug,
    json_extract(fs_read('/env/staging.json'), '$.debug') AS stage_debug
"
```

### Recipe 5: Data pipeline (CSV → Table → Report)

```bash
agt0 init pipeline

# Upload raw data
agt0 fs put ./raw-sales.csv pipeline:/raw/sales.csv

# Create typed table and import
agt0 sql pipeline -q "
  CREATE TABLE sales (
    date TEXT, product TEXT, amount REAL, region TEXT
  );
  INSERT INTO sales (date, product, amount, region)
  SELECT
    json_extract(_data, '$.date'),
    json_extract(_data, '$.product'),
    CAST(json_extract(_data, '$.amount') AS REAL),
    json_extract(_data, '$.region')
  FROM fs_csv('/raw/sales.csv');
"

# Analyze
agt0 sql pipeline -q "
  SELECT region, SUM(amount) AS total
  FROM sales GROUP BY region ORDER BY total DESC
"

# Export summary back to filesystem as JSON
agt0 sql pipeline -q "
  SELECT fs_write('/reports/summary.json', (
    SELECT json_group_array(json_object('region', region, 'total', total))
    FROM (SELECT region, SUM(amount) AS total FROM sales GROUP BY region)
  ))
"
```

### Recipe 6: Multi-file merge and analysis

```bash
agt0 init analytics

# Upload multiple CSVs
agt0 fs put ./jan-sales.csv analytics:/data/jan-sales.csv
agt0 fs put ./feb-sales.csv analytics:/data/feb-sales.csv
agt0 fs put ./mar-sales.csv analytics:/data/mar-sales.csv

# Query across ALL CSVs with a single glob
agt0 sql analytics -q "
  SELECT
    _path,
    COUNT(*) AS rows,
    SUM(CAST(json_extract(_data, '$.amount') AS REAL)) AS total
  FROM fs_csv('/data/**/*.csv')
  GROUP BY _path
"
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGT0_HOME` | Override storage directory | `~/.agt0` |
| `AGT0_FS_MAX_FILES` | Max files matched by glob | `10000` |
| `AGT0_FS_MAX_FILE_BYTES` | Max bytes per file in table functions | `64MiB` |
| `AGT0_FS_MAX_TOTAL_BYTES` | Max total bytes across all matched files | `100MiB` |
| `AGT0_FS_MAX_ROWS` | Max rows emitted per `fs_csv` / `fs_tsv` / `fs_text` / `fs_jsonl` / `*_expand` scan (`0` = off) | off |
| `AGT0_FS_PARSE_CHUNK_BYTES` | Chunk size when incrementally parsing CSV/TSV (bytes) | `2MiB` |
| `AGT0_FS_PREVIEW_BYTES` | Bytes read per file to discover CSV/TSV columns when a glob matches multiple files | `256KiB` |
| `AGT0_FS_EXPAND_JSONL_SCAN_LINES` | For `jsonl_expand`, max non-empty lines scanned at `CREATE` time to infer column keys | `256` |

---

## SQL Function Quick Reference

### Scalar Functions

| Function | Returns | Description |
|---|---|---|
| `fs_read(path)` | TEXT | Read file content |
| `fs_write(path, content)` | INTEGER | Write file, returns bytes written |
| `fs_append(path, data)` | INTEGER | Append to file, returns total bytes |
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
| `fs_list(dir_path)` | path, type, size, mode, mtime | Directory listing |
| `fs_text(path [, opts])` | _line_number, line, _path | Text file lines |
| `fs_csv(path [, opts])` | _line_number, _data, _path | CSV rows (JSON) |
| `fs_tsv(path [, opts])` | _line_number, _data, _path | TSV rows (JSON) |
| `fs_jsonl(path [, opts])` | _line_number, line, _path | JSONL lines |

### Virtual table modules (single path; dynamic columns)

| Module | Usage | Notes |
|---|---|---|
| `csv_expand` | `CREATE VIRTUAL TABLE t USING csv_expand('/path.csv' [, opts])` | Columns from CSV header; no globs |
| `tsv_expand` | `CREATE VIRTUAL TABLE t USING tsv_expand('/path.tsv' [, opts])` | Tab-separated; same options as `fs_tsv` |
| `jsonl_expand` | `CREATE VIRTUAL TABLE t USING jsonl_expand('/path.jsonl' [, opts])` | Union of object keys from first N lines (see `AGT0_FS_EXPAND_JSONL_SCAN_LINES`) |

---

## Troubleshooting

### "Database not found"

Create the database first:

```bash
agt0 init myapp
```

### "No database specified"

Either pass the database name or set a default:

```bash
agt0 use myapp
```

### better-sqlite3 installation fails

```bash
# Rebuild the native module
npm rebuild better-sqlite3

# If that fails, ensure build tools are installed
npm install -g node-gyp
npm rebuild better-sqlite3
```

### Permission errors on `~/.agt0`

Ensure the directory is writable:

```bash
mkdir -p ~/.agt0/databases
chmod -R u+rw ~/.agt0
```

### Override storage location

If you can't use `~/.agt0`, set the `AGT0_HOME` environment variable:

```bash
export AGT0_HOME=/path/to/my/storage
agt0 init myapp
```

### Reset everything

```bash
rm -rf ~/.agt0
```

This deletes all databases and configuration. Not reversible.
