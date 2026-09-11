import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'nimtzyagent.db';

/**
 * Append-only list of migrations. Each entry runs once, guarded by
 * `PRAGMA user_version`, so adding a migration is a pure append.
 */
const MIGRATIONS: string[] = [
  `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    system_prompt TEXT,
    preset_id TEXT,
    model TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS conversations_updated_at ON conversations (updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    reasoning TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    usage_json TEXT,
    attachments_json TEXT,
    thinking_ms INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE messages ADD COLUMN tool_calls_json TEXT;
  `,
];

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let index = current; index < MIGRATIONS.length; index += 1) {
    await db.execAsync(MIGRATIONS[index]);
    await db.execAsync(`PRAGMA user_version = ${index + 1}`);
  }
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return Promise.resolve(database);
  if (!opening) {
    opening = SQLite.openDatabaseAsync(DATABASE_NAME)
      .then(async (db) => {
        await migrate(db);
        database = db;
        return db;
      })
      .catch((error) => {
        opening = null;
        throw error;
      });
  }
  return opening;
}
