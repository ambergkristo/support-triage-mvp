import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { env } from "../config/env";

type Migration = {
    id: string;
    apply: (db: Database.Database) => void;
};

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "opsinbox.db");
const DATABASE_PATH = env.DB_PATH || DEFAULT_DB_PATH;

const migrations: Migration[] = [
    {
        id: "001_initial_schema",
        apply: (db) => {
            db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS inbox_accounts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    provider TEXT NOT NULL,
                    account_email TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT,
                    sender TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    snippet TEXT NOT NULL,
                    message_date TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS triage_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL UNIQUE,
                    priority TEXT NOT NULL,
                    category TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    action TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                );

                CREATE TABLE IF NOT EXISTS assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL UNIQUE,
                    assignee_user_id TEXT,
                    status TEXT NOT NULL DEFAULT 'open',
                    done INTEGER NOT NULL DEFAULT 0,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (message_id) REFERENCES messages(id),
                    FOREIGN KEY (assignee_user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL,
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                );

                CREATE TABLE IF NOT EXISTS activity_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS rule_configs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    matchers_json TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    category TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS feature_flags (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            `);
        },
    },
];

let dbInstance: Database.Database | null = null;

function initializeDb(): Database.Database {
    const dataDir = path.dirname(DATABASE_PATH);
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new Database(DATABASE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);

    const applied = new Set(
        db
            .prepare("SELECT id FROM schema_migrations")
            .all()
            .map((row) => String((row as { id: string }).id))
    );

    const insertMigration = db.prepare(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
    );

    for (const migration of migrations) {
        if (applied.has(migration.id)) {
            continue;
        }
        const tx = db.transaction(() => {
            migration.apply(db);
            insertMigration.run(migration.id, new Date().toISOString());
        });
        tx();
    }

    return db;
}

export function getDb(): Database.Database {
    if (!dbInstance) {
        dbInstance = initializeDb();
    }
    return dbInstance;
}

export function closeDb() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
