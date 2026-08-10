import Database from 'bun:sqlite';
import { mkdirSync } from 'fs';

mkdirSync('./data', { recursive: true });

const db = new Database(process.env.DATABASE_URL || './data/chat.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_session ON conversations(session_id, created_at);
`);

export default db;
