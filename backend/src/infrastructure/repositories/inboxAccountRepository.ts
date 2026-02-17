import crypto from "crypto";
import type Database from "better-sqlite3";

export type InboxAccountRecord = {
    id: string;
    workspaceId: string;
    provider: "google";
    googleSubject: string;
    email: string;
    createdAt: string;
};

type InboxAccountRow = InboxAccountRecord;

export class InboxAccountRepository {
    private readonly findByWorkspaceEmailStmt;
    private readonly findByIdStmt;
    private readonly insertStmt;
    private readonly updateStmt;

    constructor(private readonly db: Database.Database) {
        this.findByWorkspaceEmailStmt = db.prepare(`
            SELECT id, workspaceId, provider, googleSubject, email, createdAt
            FROM inbox_accounts
            WHERE workspaceId = ? AND provider = 'google' AND lower(email) = lower(?)
            LIMIT 1
        `);
        this.findByIdStmt = db.prepare(
            "SELECT id, workspaceId, provider, googleSubject, email, createdAt FROM inbox_accounts WHERE id = ?"
        );
        this.insertStmt = db.prepare(`
            INSERT INTO inbox_accounts (id, workspaceId, provider, googleSubject, email, createdAt)
            VALUES (?, ?, 'google', ?, ?, ?)
        `);
        this.updateStmt = db.prepare(`
            UPDATE inbox_accounts
            SET googleSubject = ?, email = ?
            WHERE id = ?
        `);
    }

    upsertGoogleAccount(workspaceId: string, email: string, googleSubject: string): InboxAccountRecord {
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedSubject = googleSubject.trim() || normalizedEmail;
        const existing = this.findByWorkspaceEmailStmt.get(workspaceId, normalizedEmail) as
            | InboxAccountRow
            | undefined;

        if (existing) {
            this.updateStmt.run(normalizedSubject, normalizedEmail, existing.id);
            return this.findByIdStmt.get(existing.id) as InboxAccountRow;
        }

        const id = crypto.randomUUID();
        this.insertStmt.run(id, workspaceId, normalizedSubject, normalizedEmail, new Date().toISOString());
        return this.findByIdStmt.get(id) as InboxAccountRow;
    }
}
