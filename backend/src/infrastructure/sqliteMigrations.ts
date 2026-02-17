import type Database from "better-sqlite3";

type Migration = {
    id: string;
    statements: string[];
};

const migrations: Migration[] = [
    {
        id: "m3_001_multiuser_foundation",
        statements: [
            `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                createdAt TEXT NOT NULL
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                ownerUserId TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                FOREIGN KEY (ownerUserId) REFERENCES users(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS workspace_members (
                workspaceId TEXT NOT NULL,
                userId TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (workspaceId, userId),
                FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS inbox_accounts (
                id TEXT PRIMARY KEY,
                workspaceId TEXT NOT NULL,
                provider TEXT NOT NULL CHECK(provider = 'google'),
                googleSubject TEXT NOT NULL,
                email TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE INDEX IF NOT EXISTS idx_inbox_accounts_workspaceId ON inbox_accounts(workspaceId)
            `,
            `
            CREATE TABLE IF NOT EXISTS oauth_tokens (
                inboxAccountId TEXT PRIMARY KEY,
                encryptedTokenJson TEXT NOT NULL,
                updatedAt TEXT NOT NULL,
                FOREIGN KEY (inboxAccountId) REFERENCES inbox_accounts(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE INDEX IF NOT EXISTS idx_oauth_tokens_updatedAt ON oauth_tokens(updatedAt)
            `,
            `
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)
            `,
            `
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
            `,
            `
            CREATE TABLE IF NOT EXISTS triage_overrides (
                user_id TEXT NOT NULL,
                email_id TEXT NOT NULL,
                done INTEGER NOT NULL,
                note TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, email_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS rule_configs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                matchers_json TEXT NOT NULL,
                priority TEXT NOT NULL,
                category TEXT NOT NULL,
                enabled INTEGER NOT NULL
            )
            `,
            `
            CREATE TABLE IF NOT EXISTS feature_flags (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                ai_triage_enabled INTEGER NOT NULL,
                ai_mode TEXT NOT NULL,
                safe_fallback TEXT NOT NULL
            )
            `,
            `
            INSERT OR IGNORE INTO feature_flags (id, ai_triage_enabled, ai_mode, safe_fallback)
            VALUES (1, 0, 'disabled', 'rules')
            `,
        ],
    },
];

function ensureMigrationsTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    `);
}

export function runMigrations(db: Database.Database): void {
    ensureMigrationsTable(db);
    const applied = db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>;
    const appliedSet = new Set(applied.map((row) => row.id));

    const insertMigration = db.prepare(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)"
    );

    for (const migration of migrations) {
        if (appliedSet.has(migration.id)) {
            continue;
        }

        const apply = db.transaction(() => {
            for (const statement of migration.statements) {
                db.exec(statement);
            }
            insertMigration.run(migration.id, new Date().toISOString());
        });

        apply();
    }
}
