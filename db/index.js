import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

/**
 * Get the database file path.
 * Uses MARKETOS_DB_PATH env var, or defaults to data/marketos.db
 */
function getDbPath() {
  const dataDir = process.env.MARKETOS_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dataDir, 'marketos.db');
}

/**
 * Initialize the SQLite database.
 * Creates the database file and runs schema migrations if needed.
 */
export async function initDatabase() {
  const dbPath = getDbPath();
  const dataDir = path.dirname(dbPath);

  // Ensure data directory exists
  await mkdir(dataDir, { recursive: true });

  // Open database
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  console.log(`[DB] SQLite database initialized at ${dbPath}`);
  return db;
}

/**
 * Get the database instance.
 * Throws if database has not been initialized.
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] SQLite database closed.');
  }
}

/**
 * Check if the database is initialized and accessible.
 */
export function isDatabaseReady() {
  try {
    if (!db) return false;
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
