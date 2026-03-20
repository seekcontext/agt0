# agt0

**One file. All your agent needs.**

Local-first storage for AI agents — database, filesystem, and memory in a single SQLite file. CLI for humans, MCP for agents, SQL to connect everything.

## Why agt0?

AI agents need to store structured data (tables, records), unstructured data (files, logs, configs), and memory (context, preferences) — but today these live in separate systems. agt0 fuses them into a single SQLite file with two unified interfaces: **SQL** and **filesystem**.

```
┌──────────────┐     ┌──────────────┐
│  Human (CLI) │     │ Agent (MCP)  │
└──────┬───────┘     └──────┬───────┘
       │                    │
       ▼                    ▼
┌─────────────────────────────────────┐
│            agt0 Core                │
│  ┌──────────┬──────────┬─────────┐  │
│  │  SQL     │  FS      │ Memory  │  │
│  │  Engine  │  Layer   │ Layer   │  │
│  └──────────┴──────────┴─────────┘  │
│         ┌──────────────┐            │
│         │    SQLite    │            │
│         │  (one file)  │            │
│         └──────────────┘            │
└─────────────────────────────────────┘
```

## Quick Start

```bash
npm install -g @seekcontext/agt0

# Create a database
agt0 init myapp

# Write a file into the virtual filesystem
agt0 fs put ./users.csv myapp:/data/users.csv

# Query it with SQL — no import step needed
agt0 sql myapp -q "SELECT * FROM fs_csv('/data/users.csv')"

# Or use the interactive filesystem shell
agt0 fs sh myapp
fs:/> echo '{"name":"agt0","version":"0.1"}' > /config.json
fs:/> exit

# Read that file from SQL
agt0 sql myapp -q "SELECT json_extract(fs_read('/config.json'), '$.name')"
# → agt0
```

## Core Concepts

### One File = Everything

Each database is a single `.db` file (`~/.agt0/databases/<name>.db`). It contains your tables, your files, and your agent's memory. Copy it, back it up, or share it — it's just one file.

### SQL + FS Fusion

The killer feature: **query files with SQL, write files with SQL**. No import/export steps.

```sql
-- Read a file
SELECT fs_read('/config.json');

-- Write a file
SELECT fs_write('/logs/today.log', 'Started at ' || datetime('now'));

-- Query CSV as a table
SELECT * FROM fs_csv('/data/users.csv') WHERE _data LIKE '%admin%';

-- Query JSONL logs
SELECT _line_number, json_extract(line, '$.level') AS level
FROM fs_jsonl('/logs/app.jsonl')
WHERE json_extract(line, '$.level') = 'error';

-- List files
SELECT path, size, mtime FROM fs_list('/data/');

-- Query text files with line numbers
SELECT * FROM fs_text('/logs/*.log') WHERE line LIKE '%error%';
```

### Virtual Filesystem

A POSIX-like filesystem stored inside SQLite. Use CLI commands or SQL functions.

```bash
agt0 fs put ./data.csv myapp:/data/data.csv    # Upload
agt0 fs get myapp:/data/data.csv ./local.csv   # Download
agt0 fs ls myapp:/data/                        # List
agt0 fs cat myapp:/config.json                 # Read
agt0 fs rm myapp:/tmp/scratch.txt              # Delete
agt0 fs mkdir myapp:/data/exports              # Create dir
agt0 fs sh myapp                               # Interactive shell
```

### For AI Agents

Tell your agent:

> Read https://agt0.dev/skill.md and follow instructions

Or use agt0 as an npm library:

```typescript
import { openDatabase, fsWrite, fsRead } from '@seekcontext/agt0';

const db = openDatabase('my-agent');
fsWrite(db, '/memory/context.md', Buffer.from('User prefers dark mode'));
const content = fsRead(db, '/memory/context.md');
db.close();
```

## CLI Reference

```
agt0
├── init <name>                         Create a new database
├── list                                List all databases
├── delete <name> [--yes]               Delete a database
├── use [name] [--clear]                Set or show default database
├── sql [db] [-q <sql>] [-f <file>]     Execute SQL (inline/file/REPL)
├── fs
│   ├── ls <db>:/path                   List files
│   ├── cat <db>:/path                  Read file content
│   ├── put <local> <db>:/path [-r]     Upload file(s)
│   ├── get <db>:/path <local>          Download file
│   ├── rm <db>:/path [-r]              Remove file/dir
│   ├── mkdir <db>:/path                Create directory
│   └── sh [db]                         Interactive file shell
├── inspect [db] [tables|schema]        Database overview
├── dump [db] [-o file] [--ddl-only]    Export as SQL
├── seed [db] <file>                    Run seed SQL file
└── branch <create|list|delete> [db]    Branch database
```

## SQL Functions

### Scalar Functions

| Function | Returns | Description |
|---|---|---|
| `fs_read(path)` | TEXT | Read file content |
| `fs_write(path, content)` | INTEGER | Write file, returns bytes |
| `fs_append(path, data)` | INTEGER | Append to file |
| `fs_exists(path)` | INTEGER | 1 if exists, 0 otherwise |
| `fs_size(path)` | INTEGER | File size in bytes |
| `fs_mtime(path)` | TEXT | Last modified (ISO 8601) |
| `fs_remove(path, recursive)` | INTEGER | Delete, returns count |
| `fs_mkdir(path, recursive)` | INTEGER | Create directory |
| `fs_truncate(path, size)` | INTEGER | Truncate file to size in bytes |
| `fs_read_at(path, offset, length)` | TEXT | Read UTF-8 slice (bytes); short read at EOF |
| `fs_write_at(path, offset, data)` | INTEGER | Overwrite/patch at byte offset; extends with zeros |

### Table-Valued Functions

| Function | Columns | Description |
|---|---|---|
| `fs_list(dir_path)` | path, type, size, mode, mtime | Directory listing |
| `fs_text(path_pattern [, options])` | _line_number, line, _path | Read text files by line |
| `fs_csv(path_pattern [, options])` | _line_number, _path, _data | Read CSV (parsed as JSON) |
| `fs_tsv(path_pattern [, options])` | _line_number, _path, _data | Read TSV |
| `fs_jsonl(path_pattern [, options])` | _line_number, line, _path | Read JSONL files |

Path patterns support `*`, `?`, and `**` globs. Optional `options` is a JSON string: `exclude`, `strict`, `delimiter`, `header`. Enforce limits with `AGT0_FS_MAX_FILES`, `AGT0_FS_MAX_FILE_BYTES`, `AGT0_FS_MAX_TOTAL_BYTES`.

## Data Storage

```
~/.agt0/
├── config.json          # Global config (default db, etc.)
└── databases/
    ├── myapp.db         # Each database is one SQLite file
    └── myapp-staging.db # Branches are copies
```

## Publishing (maintainers)

Publish from the **repository root** (not a nested `package/` folder). `prepublishOnly` runs **`npm run ci`** (`typecheck`, `build`, `test`). Locally: `npm run ci` before pushing.

If npm prints `Unknown env config "devdir"`, remove the unsupported `devdir` entry from your `~/.npmrc` (or project `.npmrc`).

## License

MIT
