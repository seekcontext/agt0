# agt0 User Manual

## Installation

```bash
npm install -g agt0
```

Requires Node.js 20 or later. Verify:

```bash
agt0 --version
```

## Getting Started

### 1. Create Your First Database

```bash
agt0 init myapp
```

This creates `~/.agt0/databases/myapp.db` — a single SQLite file that stores your tables and files. The first database you create is automatically set as the default.

### 2. Run SQL

```bash
# Inline query
agt0 sql myapp -q "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"
agt0 sql myapp -q "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')"
agt0 sql myapp -q "SELECT * FROM users"

# From a file
agt0 sql myapp -f schema.sql

# Interactive REPL
agt0 sql myapp
```

In the REPL, type SQL ending with `;` to execute. Dot commands are also available:

```
agt0:myapp> SELECT * FROM users;
agt0:myapp> .tables
agt0:myapp> .schema
agt0:myapp> .help
agt0:myapp> .quit
```

### 3. Use the Virtual Filesystem

Every agt0 database has a built-in virtual filesystem. Files are stored inside the SQLite database itself.

```bash
# Upload a local file
agt0 fs put ./data.csv myapp:/data/data.csv

# Upload a directory recursively
agt0 fs put -r ./docs myapp:/docs

# List files
agt0 fs ls myapp:/
agt0 fs ls myapp:/data/

# Read a file
agt0 fs cat myapp:/data/data.csv

# Download to local
agt0 fs get myapp:/data/data.csv ./downloaded.csv

# Delete
agt0 fs rm myapp:/data/data.csv

# Create directory
agt0 fs mkdir myapp:/data/exports
```

### 4. Interactive File Shell

```bash
agt0 fs sh myapp
```

Available commands:

```
fs:/> ls                        # List current directory
fs:/> cd data                   # Change directory
fs:/data> cat users.csv         # Read file
fs:/data> echo hello > test.txt # Write file
fs:/data> mkdir exports         # Create directory
fs:/data> rm test.txt           # Delete file
fs:/data> pwd                   # Print working directory
fs:/data> cd ..                 # Go up
fs:/> exit                      # Exit shell
```

### 5. Default Database

Set a default to omit the database name:

```bash
agt0 use myapp

# Now these are equivalent:
agt0 sql myapp -q "SELECT 1"
agt0 sql -q "SELECT 1"

# Clear the default
agt0 use --clear
```

---

## SQL + FS Fusion

This is agt0's core feature: **query files as tables, manipulate files from SQL**.

### Read/Write Files from SQL

```sql
-- Write a configuration file
SELECT fs_write('/config/app.json', '{"debug": true, "port": 3000}');

-- Read it back
SELECT fs_read('/config/app.json');
-- → {"debug": true, "port": 3000}

-- Parse JSON
SELECT json_extract(fs_read('/config/app.json'), '$.port');
-- → 3000

-- Append to a log
SELECT fs_append('/logs/app.log', 'Started at ' || datetime('now') || char(10));

-- Check existence and size
SELECT fs_exists('/config/app.json'), fs_size('/config/app.json');
-- → 1, 34
```

### Query CSV Files as Tables

Upload a CSV and query it immediately — no `CREATE TABLE`, no import script:

```bash
agt0 fs put ./users.csv myapp:/data/users.csv
```

```sql
-- Each row is returned with _data as a JSON object
SELECT
  _line_number,
  json_extract(_data, '$.name') AS name,
  json_extract(_data, '$.email') AS email
FROM fs_csv('/data/users.csv')
WHERE json_extract(_data, '$.role') = 'admin';
```

### Query JSONL Log Files

```sql
-- Read structured logs
SELECT
  _line_number,
  json_extract(line, '$.timestamp') AS ts,
  json_extract(line, '$.level') AS level,
  json_extract(line, '$.message') AS msg
FROM fs_jsonl('/logs/app.jsonl')
WHERE json_extract(line, '$.level') = 'error'
ORDER BY _line_number DESC
LIMIT 10;
```

### Query Text Files with Grep-like Power

```sql
-- Find lines matching a pattern (like grep)
SELECT _path, _line_number, line
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%';

-- Count errors per file (like grep -c)
SELECT _path, COUNT(*) AS error_count
FROM fs_text('/logs/*.log')
WHERE line LIKE '%ERROR%'
GROUP BY _path
ORDER BY error_count DESC;
```

### List Files (Directory Listing)

```sql
-- List all files and directories
SELECT path, type, size, mtime
FROM fs_list('/')
ORDER BY mtime DESC;

-- Find large files
SELECT path, size, mtime
FROM fs_list('/data/')
WHERE size > 1000000;
```

### The Bridge: File → Table

The most powerful pattern: read from files, write to tables:

```sql
-- Import CSV data into a proper table with deduplication
INSERT INTO users (name, email)
SELECT DISTINCT
  json_extract(_data, '$.name'),
  json_extract(_data, '$.email')
FROM fs_csv('/data/import/users.csv')
WHERE json_extract(_data, '$.email') IS NOT NULL;
```

---

## Database Management

### List Databases

```bash
agt0 list
```

Shows all databases with their size and last modified time. The default database is marked with `*`.

### Inspect Database

```bash
# Summary overview
agt0 inspect myapp

# List tables with row counts
agt0 inspect myapp tables

# Show CREATE statements
agt0 inspect myapp schema
```

### Export Database

```bash
# Full dump (schema + data)
agt0 dump myapp -o backup.sql

# Schema only
agt0 dump myapp --ddl-only -o schema.sql

# Print to stdout
agt0 dump myapp
```

### Import SQL

```bash
agt0 seed myapp schema.sql
```

### Branching

Create isolated copies for testing:

```bash
# Create a branch
agt0 branch create myapp --name staging

# List branches
agt0 branch list myapp

# Delete a branch
agt0 branch delete myapp --name staging
```

Branches are full copies of the SQLite file. Changes to a branch don't affect the original.

---

## Recipes

### Recipe 1: Project Context for a Coding Agent

```bash
agt0 init project-context
agt0 fs put -r ./src project-context:/src
agt0 fs put ./package.json project-context:/package.json
agt0 sql project-context -q "
  SELECT _path, COUNT(*) as lines
  FROM fs_text('/src/*.ts')
  GROUP BY _path
  ORDER BY lines DESC"
```

### Recipe 2: Log Analysis

```bash
agt0 init logs-db
agt0 fs put ./app.jsonl logs-db:/logs/app.jsonl

agt0 sql logs-db -q "
  SELECT
    json_extract(line, '$.level') AS level,
    COUNT(*) AS count
  FROM fs_jsonl('/logs/app.jsonl')
  GROUP BY level
  ORDER BY count DESC"
```

### Recipe 3: Configuration Management

```bash
agt0 init config
agt0 sql config -q "SELECT fs_write('/env/production.json', '{
  \"database_url\": \"postgres://...\",
  \"redis_url\": \"redis://...\",
  \"debug\": false
}')"

agt0 sql config -q "SELECT json_extract(fs_read('/env/production.json'), '$.database_url')"
```

### Recipe 4: Data Pipeline

```bash
agt0 init pipeline

# Upload raw data
agt0 fs put ./raw-sales.csv pipeline:/raw/sales.csv

# Create clean table and import
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
  FROM sales GROUP BY region ORDER BY total DESC"

# Export results back to filesystem
agt0 sql pipeline -q "
  SELECT fs_write('/reports/summary.json', (
    SELECT json_group_array(json_object('region', region, 'total', total))
    FROM (SELECT region, SUM(amount) as total FROM sales GROUP BY region)
  ))"
```

---

## Using as a Library

agt0 can be imported as an npm module:

```typescript
import { createDatabase, openDatabase, fsWrite, fsRead, fsList } from 'agt0';

// Create a new database
const db = createDatabase('my-agent');

// Write a file
fsWrite(db, '/context/system.md', Buffer.from('You are a helpful assistant.'));

// Read it back
const content = fsRead(db, '/context/system.md');
console.log(content?.toString('utf-8'));

// List files
const entries = fsList(db, '/');
console.log(entries);

// Execute SQL (note: use single quotes for SQL string literals)
const rows = db.prepare("SELECT * FROM fs_list('/')").all();
console.log(rows);

// Use fs functions in SQL
db.prepare("SELECT fs_write('/data/hello.txt', 'Hello World')").run();
const result = db.prepare("SELECT fs_read('/data/hello.txt') AS content").get();
console.log(result);

db.close();
```

---

## Troubleshooting

### "Database not found"

Make sure you've created the database first:

```bash
agt0 init myapp
```

### "No database specified"

Either pass the database name explicitly or set a default:

```bash
agt0 use myapp
```

### better-sqlite3 installation fails

If npm can't install the native module:

```bash
# Try rebuilding
npm rebuild better-sqlite3

# Or install with node-gyp
npm install -g node-gyp
npm rebuild better-sqlite3
```

### Reset everything

```bash
rm -rf ~/.agt0
```
