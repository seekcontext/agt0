# agt0

**One file. All your agent needs.**

[![npm version](https://img.shields.io/npm/v/@seekcontext/agt0)](https://www.npmjs.com/package/@seekcontext/agt0)
[![license](https://img.shields.io/npm/l/@seekcontext/agt0)](./LICENSE)
[![node](https://img.shields.io/node/v/@seekcontext/agt0)](https://nodejs.org)

Local-first storage for AI agents — database, filesystem, and memory in a single SQLite file. Zero config. Zero network. Zero cost.

```
 ┌──────────────────────────────────────────────────────────┐
 │                        agt0                              │
 │                                                          │
 │   Human ──── CLI ────┐                                   │
 │                      ├──▶  SQL Engine + Virtual FS       │
 │   Agent ── SKILL.md ─┘        │                          │
 │                          ┌────┴────┐                     │
 │                          │ SQLite  │  ← one .db file     │
 │                          │ tables + files + memory       │
 │                          └─────────┘                     │
 └──────────────────────────────────────────────────────────┘
```

---

## Why agt0?

AI agents need persistent storage — structured data (tables, records), unstructured data (files, logs, configs), and memory (context, preferences). Today these live in separate systems: a database here, a filesystem there, a vector store somewhere else.

**agt0 collapses them into one SQLite file** with a single unified interface: **SQL**.

| Problem | agt0 Solution |
|---|---|
| Agent state scattered across services | Everything in one `.db` file |
| Need a database AND a filesystem | Virtual FS lives inside SQLite |
| CSV/JSON import requires ETL scripts | `SELECT * FROM fs_csv('/data.csv')` — zero import |
| Config across multiple env files | `fs_read('/env/prod.json')` from SQL |
| Agent memory needs a separate store | Write to `/memory/`, query with SQL |
| Sharing agent state is painful | Copy one file. Done. |

### Built for agents

Give any AI agent persistent, queryable storage in one line:

> **Read https://agt0.dev/skill.md and follow instructions**

That's it. The agent gets a full database + filesystem + memory layer. No API keys, no Docker, no infrastructure.

---

## Quick Start

```bash
npm install -g @seekcontext/agt0

# Create a database — everything lives in this one file
agt0 init myapp

# Upload a CSV and query it instantly — no import step
printf 'name,email,role\nAlice,a@ex.com,admin\nBob,b@ex.com,user\n' > ./users.csv
agt0 fs put ./users.csv myapp:/data/users.csv
agt0 sql myapp -q "SELECT * FROM fs_csv('/data/users.csv')"

# Write files from SQL
agt0 sql myapp -q "SELECT fs_write('/config.json', '{\"mode\":\"production\"}')"

# Read them back with JSON extraction
agt0 sql myapp -q "SELECT json_extract(fs_read('/config.json'), '$.mode')"
# → production

# Interactive SQL REPL (.help for commands, .fshelp for fs_* functions)
agt0 sql myapp
```

---

## Core Concepts

### One File = Everything

Each database is a single `.db` file (`~/.agt0/databases/<name>.db`). Tables, files, agent memory — all in one place. Copy it, back it up, version it, share it.

### SQL + FS Fusion

The killer feature: **query files with SQL, write files with SQL**. No import/export ceremony.

```sql
-- Read and write files
SELECT fs_read('/config.json');
SELECT fs_write('/logs/today.log', 'Started at ' || datetime('now'));

-- Query CSV as a table — no CREATE TABLE, no import
SELECT json_extract(_data, '$.name') AS name,
       json_extract(_data, '$.email') AS email
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';

-- Grep across log files with SQL
SELECT _path, _line_number, line
FROM fs_text('/logs/**/*.log')
WHERE line LIKE '%ERROR%';

-- Query JSONL structured logs
SELECT json_extract(line, '$.level') AS level, COUNT(*) AS count
FROM fs_jsonl('/logs/app.jsonl')
GROUP BY level;

-- Bridge: import CSV into a proper table
INSERT INTO users (name, email)
SELECT DISTINCT json_extract(_data, '$.name'), json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv');
```

### Virtual Filesystem

A POSIX-like filesystem stored inside SQLite. Manage via CLI or SQL.

```bash
agt0 fs put ./data.csv myapp:/data/data.csv    # Upload
agt0 fs put -r ./src myapp:/src                # Upload directory tree
agt0 fs get myapp:/data/data.csv ./local.csv   # Download
agt0 fs ls myapp:/data/                        # List
agt0 fs cat myapp:/config.json                 # Read
agt0 fs rm myapp:/tmp/scratch.txt              # Delete
agt0 fs sh myapp                               # Interactive shell
```

---

## Agent Integration

### Option 1: Skill instruction (recommended)

Point any AI agent at the skill file:

> Read https://agt0.dev/skill.md and follow instructions

The agent will install agt0, create a database, and use it for persistent storage — all autonomously.

### Option 2: Programmatic API

Use agt0 as a Node.js library:

```typescript
import { createDatabase, openDatabase, fsWrite, fsRead, fsList } from '@seekcontext/agt0';

const db = createDatabase('my-agent');

// Store agent memory
fsWrite(db, '/memory/preferences.json', Buffer.from(JSON.stringify({
  theme: 'dark', language: 'en'
})));

// Read it back
const prefs = JSON.parse(fsRead(db, '/memory/preferences.json')!.toString());

// Use SQL for complex queries
const rows = db.prepare("SELECT * FROM fs_csv('/data/users.csv')").all();

db.close();
```

### Agent use cases

| Use Case | How |
|---|---|
| **Persistent memory** | `fs_write('/memory/context.md', ...)` — survives across sessions |
| **Project context** | `fs put -r ./src db:/src` then `SELECT * FROM fs_text('/src/**/*.ts')` |
| **Task state** | Store progress in tables, query with SQL |
| **Log analysis** | `fs_jsonl('/logs/*.jsonl')` with SQL aggregation |
| **Config management** | JSON configs in virtual FS, query with `json_extract` |
| **Data pipeline** | CSV → SQL table → JSON report, all in one file |

---

## CLI Reference

```
agt0
├── init <name>                         Create a new database
├── list                                List all databases
├── delete <name> [--yes]               Delete a database
├── use [name] [--clear]                Set or show default database
├── sql [db] [-q <sql>] [-f <file>]     SQL execution (inline / file / REPL)
├── fs
│   ├── ls <db>:/path                   List files
│   ├── cat <db>:/path                  Read file content
│   ├── put <local> <db>:/path [-r]     Upload file(s)
│   ├── get <db>:/path <local>          Download file
│   ├── rm <db>:/path [-r]             Remove file/dir
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
| `fs_write(path, content)` | INTEGER | Write file, returns bytes written |
| `fs_append(path, data)` | INTEGER | Append to file |
| `fs_exists(path)` | INTEGER | 1 if exists, 0 otherwise |
| `fs_size(path)` | INTEGER | File size in bytes |
| `fs_mtime(path)` | TEXT | Last modified (ISO 8601) |
| `fs_remove(path, recursive)` | INTEGER | Delete, returns count |
| `fs_mkdir(path, recursive)` | INTEGER | Create directory |
| `fs_truncate(path, size)` | INTEGER | Truncate file to size in bytes |
| `fs_read_at(path, offset, length)` | TEXT | Read UTF-8 slice at byte offset |
| `fs_write_at(path, offset, data)` | INTEGER | Overwrite at byte offset; pads with zeros |

### Table-Valued Functions

| Function | Columns | Description |
|---|---|---|
| `fs_list(dir_path)` | path, type, size, mode, mtime | Directory listing |
| `fs_text(path [, options])` | _line_number, line, _path | Read text files by line |
| `fs_csv(path [, options])` | _line_number, _path, _data | Read CSV (row as JSON) |
| `fs_tsv(path [, options])` | _line_number, _path, _data | Read TSV |
| `fs_jsonl(path [, options])` | _line_number, line, _path | Read JSONL files |

Path patterns support `*`, `?`, and `**` globs. Optional `options` is a JSON string with keys: `exclude`, `strict`, `delimiter`, `header`. Safety limits via `AGT0_FS_MAX_FILES`, `AGT0_FS_MAX_FILE_BYTES`, `AGT0_FS_MAX_TOTAL_BYTES`.

## Data Storage

```
~/.agt0/
├── config.json          # Global config (default db, etc.)
└── databases/
    ├── myapp.db         # One file = tables + files + memory
    └── myapp-staging.db # Branches are copies
```

Override the storage location with the `AGT0_HOME` environment variable.

## Publishing (maintainers)

Publish from the **repository root**. `prepublishOnly` runs `npm run ci` (typecheck → build → test). Doc examples are smoke-tested in `test/docs-examples.e2e.test.ts`.

## License

MIT
