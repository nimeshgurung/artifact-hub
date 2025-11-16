import type Database from 'better-sqlite3';

/**
 * Initialize database schema
 * Note: This is an alpha version - breaking changes may occur.
 * Users should be prepared to reset their database.
 */
export function initializeSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check current schema version
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const versionRow = db.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version') as { value: string } | undefined;
  const currentVersion = versionRow ? parseInt(versionRow.value) : 0;

  if (currentVersion < 1) {
    initializeSchemaV1(db);
  }

  if (currentVersion < 2) {
    migrateToV2(db);
  }

  if (currentVersion < 3) {
    migrateToV3(db);
  }

  // Update schema version
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('schema_version', '3');
}

/**
 * Initial schema (version 1)
 */
function initializeSchemaV1(db: Database.Database): void {

  // Create catalogs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalogs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL,
      last_fetched TEXT,
      status TEXT NOT NULL DEFAULT 'healthy',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create artifacts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      path TEXT NOT NULL,
      version TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT,
      keywords TEXT,
      language TEXT,
      framework TEXT,
      use_case TEXT,
      difficulty TEXT,
      source_url TEXT NOT NULL,
      metadata TEXT,
      author TEXT,
      compatibility TEXT,
      dependencies TEXT,
      estimated_time TEXT,
      supporting_files TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, catalog_id),
      FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE
    );
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
      id UNINDEXED,
      catalog_id UNINDEXED,
      name,
      description,
      tags,
      keywords,
      category,
      content='artifacts',
      content_rowid='rowid'
    );
  `);

  // Create triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS artifacts_fts_insert AFTER INSERT ON artifacts BEGIN
      INSERT INTO artifacts_fts(rowid, id, catalog_id, name, description, tags, keywords, category)
      VALUES (new.rowid, new.id, new.catalog_id, new.name, new.description, new.tags, new.keywords, new.category);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS artifacts_fts_delete AFTER DELETE ON artifacts BEGIN
      DELETE FROM artifacts_fts WHERE rowid = old.rowid;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS artifacts_fts_update AFTER UPDATE ON artifacts BEGIN
      DELETE FROM artifacts_fts WHERE rowid = old.rowid;
      INSERT INTO artifacts_fts(rowid, id, catalog_id, name, description, tags, keywords, category)
      VALUES (new.rowid, new.id, new.catalog_id, new.name, new.description, new.tags, new.keywords, new.category);
    END;
  `);

  // Create installations table (old schema without foreign keys for initial setup)
  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_path TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT,
      UNIQUE(artifact_id, catalog_id)
    );
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artifacts_catalog ON artifacts(catalog_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
    CREATE INDEX IF NOT EXISTS idx_artifacts_category ON artifacts(category);
    CREATE INDEX IF NOT EXISTS idx_installations_artifact ON installations(artifact_id, catalog_id);
  `);
}

/**
 * Migration to version 2: Add foreign key constraints to installations table
 */
function migrateToV2(db: Database.Database): void {
  // Check if installations table exists and needs migration
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='installations'").get() as { sql: string } | undefined;

  if (!tableInfo) {
    return; // Table doesn't exist yet, will be created by initializeSchemaV1
  }

  // Check if foreign keys already exist
  if (tableInfo.sql.includes('FOREIGN KEY')) {
    return; // Already migrated
  }

  console.log('Migrating installations table to add foreign key constraints...');

  // SQLite doesn't support ALTER TABLE to add foreign keys, so we need to recreate the table
  db.exec(`
    -- Create new table with foreign keys
    CREATE TABLE installations_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL,
      catalog_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_path TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used TEXT,
      UNIQUE(artifact_id, catalog_id),
      FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE,
      FOREIGN KEY (artifact_id, catalog_id) REFERENCES artifacts(id, catalog_id) ON DELETE CASCADE
    );

    -- Copy data from old table
    INSERT INTO installations_new (id, artifact_id, catalog_id, version, installed_path, installed_at, last_used)
    SELECT id, artifact_id, catalog_id, version, installed_path, installed_at, last_used
    FROM installations;

    -- Drop old table
    DROP TABLE installations;

    -- Rename new table
    ALTER TABLE installations_new RENAME TO installations;

    -- Recreate index
    CREATE INDEX IF NOT EXISTS idx_installations_artifact ON installations(artifact_id, catalog_id);
  `);

  console.log('Migration to v2 complete');
}

/**
 * Migration to version 3: Add supporting_files column to artifacts table
 */
function migrateToV3(db: Database.Database): void {
  // Check if artifacts table exists
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='artifacts'").get() as { sql: string } | undefined;

  if (!tableInfo) {
    return; // Table doesn't exist yet, will be created by initializeSchemaV1
  }

  // Check if supporting_files column already exists
  if (tableInfo.sql.includes('supporting_files')) {
    return; // Already migrated
  }

  console.log('Migrating artifacts table to add supporting_files column...');

  // Add the missing column
  db.exec(`
    ALTER TABLE artifacts ADD COLUMN supporting_files TEXT;
  `);

  console.log('Migration to v3 complete');
}

