# agt0

**One file. All your agent needs.**

[![npm version](https://img.shields.io/npm/v/@seekcontext/agt0)](https://www.npmjs.com/package/@seekcontext/agt0)
[![license](https://img.shields.io/npm/l/@seekcontext/agt0)](./LICENSE)
[![node](https://img.shields.io/node/v/@seekcontext/agt0)](https://nodejs.org)

Local-first storage for AI agents — database, filesystem, and memory in a single SQLite file. Zero config. Zero network. Zero cost.

```
 ┌──────────────────────────────────────────────────────┐
 │                        agt0                           │
 │                                                       │
 │   Human ── CLI ──┐                                    │
 │                   ├──▶  SQL Engine + Virtual FS        │
 │   Agent ── API ──┘        │                           │
 │                      ┌────┴────┐                      │
 │                      │ SQLite  │  ← one .db file      │
 │                      │ tables + files + memory         │
 │                      └─────────┘                      │
 └──────────────────────────────────────────────────────┘
```

---

## Why agt0?

| Problem | agt0 |
|---|---|
| Agent state scattered across services | One `.db` file |
| Need a database AND a filesystem | Virtual FS inside SQLite |
| CSV/JSON import needs ETL | `SELECT * FROM fs_csv('/data.csv')` |
| Agent memory needs a separate store | Write to `/memory/`, query with SQL |
| Sharing state is painful | Copy one file |

---

## Quick Start

```bash
npm install -g @seekcontext/agt0

agt0 init myapp
agt0 fs put ./users.csv myapp:/data/users.csv
agt0 sql myapp -q "SELECT * FROM fs_csv('/data/users.csv')"

# Interactive SQL REPL
agt0 sql myapp
```

---

## Core Concepts

### SQL + FS Fusion

Query files with SQL. Write files with SQL. No import ceremony.

```sql
SELECT fs_write('/config.json', '{"port": 3000}');
SELECT json_extract(fs_read('/config.json'), '$.port');

-- CSV as table (rows in _data as JSON)
SELECT json_extract(_data, '$.name') AS name
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';

-- Grep text files
SELECT _path, _line_number, line
FROM fs_text('/logs/**/*.log')
WHERE line LIKE '%ERROR%';

-- JSONL logs
SELECT json_extract(line, '$.level') AS level, COUNT(*)
FROM fs_jsonl('/logs/app.jsonl')
GROUP BY level;

-- CSV → real table
INSERT INTO users (name, email)
SELECT json_extract(_data, '$.name'), json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv');
```

### CLI auto-expansion

In `agt0 sql`, `fs_csv`/`fs_tsv`/`fs_jsonl` with a single file path are automatically expanded so `SELECT *` shows real column names:

```
agt0:myapp> SELECT * FROM fs_csv('/data/users.csv');
name           email              role
─────────────  ─────────────────  ─────
Alice Johnson  alice@example.com  admin
Bob Smith      bob@example.com    user
```

CSV/TSV values are **strings**. Use `CAST` for numeric comparison: `WHERE CAST(id AS INTEGER) > 5`.

Disable with `AGT0_SQL_FS_EXPAND=0`. Node API: call `expandFsTableSql(sql, db)` explicitly.

### Virtual table modules

For repeated queries on a single file, create a virtual table:

```sql
CREATE VIRTUAL TABLE users USING csv_expand('/data/users.csv');
SELECT name, email FROM users WHERE role = 'admin';

CREATE VIRTUAL TABLE logs USING jsonl_expand('/logs/app.jsonl');
SELECT level, COUNT(*) FROM logs GROUP BY level;
```

Modules: `csv_expand`, `tsv_expand`, `jsonl_expand`. Single path only (no globs). Schema is fixed at creation — `DROP` and recreate if the file changes.

### Virtual Filesystem

```bash
agt0 fs put ./data.csv myapp:/data/data.csv   # upload
agt0 fs put -r ./src myapp:/src               # upload tree
agt0 fs get myapp:/data/data.csv ./out.csv    # download
agt0 fs ls myapp:/data/                       # list
agt0 fs cat myapp:/config.json                # read
agt0 fs rm myapp:/tmp/scratch.txt             # delete
agt0 fs sh myapp                              # interactive shell
```

---

## Agent Integration

### Option 1: Skill (recommended)

Point any AI agent at the skill file:

> Read https://agt0.dev/skill.md and follow instructions

### Option 2: Node API

```typescript
import { createDatabase, openDatabase, fsWrite, fsRead } from '@seekcontext/agt0';

const db = createDatabase('my-agent');
fsWrite(db, '/memory/prefs.json', Buffer.from('{"theme":"dark"}'));
const prefs = JSON.parse(fsRead(db, '/memory/prefs.json')!.toString());
const rows = db.prepare("SELECT * FROM fs_csv('/data/users.csv')").all();
db.close();
```

---

## CLI Reference

```
agt0
├── init <name>                         Create database
├── list                                List databases
├── delete <name> [--yes]               Delete database
├── use [name] [--clear]                Set/show default database
├── sql [db] [-q <sql>] [-f <file>]     SQL (inline / file / REPL)
├── fs
│   ├── ls <db>:/path                   List
│   ├── cat <db>:/path                  Read
│   ├── put <local> <db>:/path [-r]     Upload
│   ├── get <db>:/path <local>          Download
│   ├── rm <db>:/path [-r]             Delete
│   ├── mkdir <db>:/path                Make directory
│   └── sh [db]                         Interactive shell
├── inspect [db] [tables|schema]        Database info
├── dump [db] [-o file] [--ddl-only]    Export SQL
├── seed [db] <file>                    Run SQL file
└── branch <create|list|delete> [db]    Branch database
```

## SQL Functions

### Scalar

| Function | Returns | Description |
|---|---|---|
| `fs_read(path)` | TEXT | Read file |
| `fs_write(path, content)` | INTEGER | Write file (bytes written) |
| `fs_append(path, data)` | INTEGER | Append to file |
| `fs_exists(path)` | INTEGER | 1 if exists |
| `fs_size(path)` | INTEGER | File size (bytes) |
| `fs_mtime(path)` | TEXT | Last modified (ISO 8601) |
| `fs_remove(path [, recursive])` | INTEGER | Delete |
| `fs_mkdir(path [, recursive])` | INTEGER | Create directory |
| `fs_truncate(path, size)` | INTEGER | Truncate to size |
| `fs_read_at(path, offset, len)` | TEXT | Read byte range |
| `fs_write_at(path, offset, data)` | INTEGER | Write at offset |

### Table-Valued

| Function | Columns | Description |
|---|---|---|
| `fs_list(dir)` | path, type, size, mode, mtime | Directory listing |
| `fs_text(path [, opts])` | _line_number, line, _path | Text lines |
| `fs_csv(path [, opts])` | _line_number, _path, _data | CSV rows (JSON) |
| `fs_tsv(path [, opts])` | _line_number, _path, _data | TSV rows (JSON) |
| `fs_jsonl(path [, opts])` | _line_number, line, _path | JSONL lines |

Paths support globs (`*`, `**`, `?`). Options (JSON string): `exclude`, `strict`, `delimiter`, `header`.

## Data Storage

```
~/.agt0/
├── config.json
└── databases/
    ├── myapp.db           # one file = tables + files + memory
    └── myapp-staging.db   # branch
```

Override with `AGT0_HOME` env var. See [USER_MANUAL.md](./USER_MANUAL.md) for full reference.

## Publishing (maintainers)

`prepublishOnly` runs typecheck → build → test. Doc examples are smoke-tested in `test/docs-examples.e2e.test.ts` (README, USER_MANUAL, skill.md CLI/SQL) and `test/docs-node-api-examples.test.ts` (Node API).

## License

MIT
