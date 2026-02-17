import type Database from "better-sqlite3";
import type { Credentials } from "google-auth-library";
import { decryptOAuthTokens, encryptOAuthTokens } from "../oauthTokenCrypto";

type TokenRow = {
    inboxAccountId: string;
    encryptedTokenJson: string;
    updatedAt: string;
};

export class OAuthTokenRepository {
    private readonly upsertStmt;
    private readonly findByInboxAccountStmt;
    private readonly findLatestLinkedContextStmt;
    private readonly deleteAllStmt;
    private readonly tokenExistsStmt;

    constructor(private readonly db: Database.Database) {
        this.upsertStmt = db.prepare(`
            INSERT INTO oauth_tokens (inboxAccountId, encryptedTokenJson, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(inboxAccountId) DO UPDATE SET
                encryptedTokenJson = excluded.encryptedTokenJson,
                updatedAt = excluded.updatedAt
        `);
        this.findByInboxAccountStmt = db.prepare(
            "SELECT inboxAccountId, encryptedTokenJson, updatedAt FROM oauth_tokens WHERE inboxAccountId = ?"
        );
        this.findLatestLinkedContextStmt = db.prepare(`
            SELECT
                u.id AS userId,
                w.id AS workspaceId,
                ia.id AS inboxAccountId,
                ia.email AS email
            FROM oauth_tokens ot
            JOIN inbox_accounts ia ON ia.id = ot.inboxAccountId
            JOIN workspaces w ON w.id = ia.workspaceId
            JOIN users u ON u.id = w.ownerUserId
            ORDER BY ot.updatedAt DESC
            LIMIT 1
        `);
        this.deleteAllStmt = db.prepare("DELETE FROM oauth_tokens");
        this.tokenExistsStmt = db.prepare("SELECT 1 AS ok FROM oauth_tokens LIMIT 1");
    }

    saveForInboxAccount(inboxAccountId: string, tokens: Credentials): void {
        this.upsertStmt.run(inboxAccountId, encryptOAuthTokens(tokens), new Date().toISOString());
    }

    findForInboxAccount(inboxAccountId: string): Credentials | null {
        const row = this.findByInboxAccountStmt.get(inboxAccountId) as TokenRow | undefined;
        if (!row) {
            return null;
        }
        return decryptOAuthTokens(row.encryptedTokenJson);
    }

    findLatestLinkedContext(): { userId: string; workspaceId: string; inboxAccountId: string; email: string } | null {
        const row = this.findLatestLinkedContextStmt.get() as
            | { userId: string; workspaceId: string; inboxAccountId: string; email: string }
            | undefined;
        return row ?? null;
    }

    clearAll(): void {
        this.deleteAllStmt.run();
    }

    tokenRowPresent(): boolean {
        const row = this.tokenExistsStmt.get() as { ok: number } | undefined;
        return Boolean(row?.ok);
    }
}
