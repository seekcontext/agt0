# agt0

Local-first storage for AI agents. Database, filesystem, and memory in a single SQLite file. Zero config, zero network, zero cost.

## Install

```bash
npm install -g @seekcontext/agt0
```

Verify:

```bash
agt0 --version
```

## Quick Start

```bash
# Create a database (one file = everything)
agt0 init myapp

# Set as default so you can omit the name
agt0 use myapp
```

## SQL Execution

```bash
# Inline
agt0 sql myapp -q "SELECT 1 + 1 AS result"

# From file (must exist on disk)
agt0 sql myapp -f schema.sql

# Interactive REPL (when no -q or -f)
agt0 sql myapp
```

## Virtual Filesystem

Every database has a built-in filesystem. Files are stored inside SQLite.

### CLI Operations

```bash
agt0 fs put ./data.csv myapp:/data/data.csv      # Upload file
agt0 fs put -r ./docs myapp:/docs                 # Upload directory
agt0 fs ls myapp:/data/                           # List files
agt0 fs cat myapp:/data/data.csv                  # Read file
agt0 fs get myapp:/data/data.csv ./local.csv      # Download file
agt0 fs rm myapp:/data/old.csv                    # Delete file
agt0 fs mkdir myapp:/data/exports                 # Create directory
```

### SQL Functions (Scalar)

```sql
SELECT fs_read('/config.json');                             -- Read file
SELECT fs_write('/data/hello.txt', 'Hello!');               -- Write file (returns bytes)
SELECT fs_append('/logs/app.log', 'New entry\n');           -- Append
SELECT fs_exists('/config.json');                           -- Check: 1 or 0
SELECT fs_size('/config.json');                             -- Size in bytes
SELECT fs_mtime('/config.json');                            -- Last modified ISO 8601
SELECT fs_remove('/tmp/scratch.txt');                       -- Delete file
SELECT fs_mkdir('/data/exports', 1);                        -- Create dir (1=recursive)
SELECT fs_truncate('/logs/app.log', 0);                     -- Truncate to size (bytes)
SELECT fs_read_at('/data/blob.bin', 0, 16);                   -- Read 16 bytes from offset (UTF-8 text)
SELECT fs_write_at('/data/blob.bin', 100, 'patch');          -- Write at byte offset (pads with zeros)
```

### SQL Functions (Table-Valued)

Optional second argument on `fs_text`, `fs_csv`, `fs_tsv`, `fs_jsonl`: a JSON string with `exclude` (comma-separated globs), `strict` (bool), `delimiter` (string), `header` (bool). Relative exclude globs are rooted as `**/pattern`.

```sql
-- List directory
SELECT path, type, size, mode, mtime FROM fs_list('/data/');

-- Read text file by lines (globs: *, ?, **)
SELECT _line_number, line, _path FROM fs_text('/logs/app.log');
SELECT _line_number, line, _path FROM fs_text('/logs/**/*.log', '{"exclude":"*.tmp,*.bak"}');

-- Read CSV (_data is JSON per row; multi-file globs use union of column names)
SELECT _line_number, _data, _path FROM fs_csv('/data/users.csv');

-- TSV (tab-separated)
SELECT _line_number, _data, _path FROM fs_tsv('/data/report.tsv');

-- Read JSONL (each line is JSON)
SELECT _line_number, line, _path FROM fs_jsonl('/logs/events.jsonl');
```

**Glob rules:** `*` = one path segment (no slash); `**` = any depth; `?` = one character (not slash). Example: `/data/**/*.csv`.

**Limits (override via env):** `AGT0_FS_MAX_FILES`, `AGT0_FS_MAX_FILE_BYTES`, `AGT0_FS_MAX_TOTAL_BYTES`.

### Key Pattern: File → SQL Query

```sql
-- Query CSV like a table
SELECT json_extract(_data, '$.name') AS name
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';

-- Import CSV into a table with deduplication
INSERT INTO users (name, email)
SELECT DISTINCT
  json_extract(_data, '$.name'),
  json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv')
WHERE json_extract(_data, '$.email') IS NOT NULL;

-- Grep-like search across files
SELECT _path, _line_number, line
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%';
```

## Database Management

```bash
agt0 list                                    # List all databases
agt0 use myapp                               # Set default database
agt0 inspect myapp                           # Overview: tables, files, size
agt0 inspect myapp tables                    # Table list with row counts
agt0 inspect myapp schema                    # Show CREATE statements
agt0 dump myapp -o backup.sql                # Full SQL export
agt0 dump myapp --ddl-only                   # Schema only
agt0 seed myapp seed.sql                     # Run SQL file
agt0 delete myapp --yes                      # Delete database
agt0 branch create myapp --name staging      # Branch (copy) database
```

## Interactive File Shell

```bash
agt0 fs sh myapp
```

Commands: `ls`, `cd`, `cat`, `echo <text> > <path>`, `mkdir`, `rm`, `pwd`, `exit`.

## Storage Layout

```
~/.agt0/
├── config.json              # Default database setting
└── databases/
    ├── myapp.db             # Single file = db + fs + memory
    └── myapp-staging.db     # Branch
```

## Important Notes

- All data is local. No network required.
- Each database is a single `.db` file. Copy it to back up.
- The `_fs` table is the system table for the virtual filesystem. Do not drop it.
- Glob patterns (`*`, `?`, `**`) work in `fs_text`, `fs_csv`, `fs_tsv`, `fs_jsonl` path parameters.
- SQL REPL: `.fshelp` lists `fs_*` functions and options.
- `fs_read_at` / `fs_write_at` use **byte** offsets; `fs_read_at` returns a UTF-8 string for that byte range (binary files may not round-trip through TEXT).
- CSV columns are returned as a JSON string in the `_data` column. Use `json_extract(_data, '$.column_name')` to access individual fields.
