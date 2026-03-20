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

# From file
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
```

### SQL Functions (Table-Valued)

```sql
-- List directory
SELECT path, type, size, mtime FROM fs_list('/data/');

-- Read text file by lines (supports glob: /logs/*.log)
SELECT _line_number, line, _path FROM fs_text('/logs/app.log');

-- Read CSV as table (auto-parses headers, _data is JSON object per row)
SELECT _line_number, _data, _path FROM fs_csv('/data/users.csv');

-- Read JSONL (each line is JSON)
SELECT _line_number, line, _path FROM fs_jsonl('/logs/events.jsonl');
```

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
- Glob patterns (`*`, `?`) work in `fs_text`, `fs_csv`, `fs_jsonl` path parameters.
- CSV columns are returned as a JSON string in the `_data` column. Use `json_extract(_data, '$.column_name')` to access individual fields.
