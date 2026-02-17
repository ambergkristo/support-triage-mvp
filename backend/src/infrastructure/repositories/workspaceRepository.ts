import crypto from "crypto";
import type Database from "better-sqlite3";

export type WorkspaceRecord = {
    id: string;
    name: string;
    ownerUserId: string;
    createdAt: string;
};

type WorkspaceRow = WorkspaceRecord;

export class WorkspaceRepository {
    private readonly findPersonalStmt;
    private readonly insertWorkspaceStmt;
    private readonly upsertMemberStmt;

    constructor(private readonly db: Database.Database) {
        this.findPersonalStmt = db.prepare(
            "SELECT id, name, ownerUserId, createdAt FROM workspaces WHERE ownerUserId = ? AND name = 'Personal' LIMIT 1"
        );
        this.insertWorkspaceStmt = db.prepare(
            "INSERT INTO workspaces (id, name, ownerUserId, createdAt) VALUES (?, 'Personal', ?, ?)"
        );
        this.upsertMemberStmt = db.prepare(`
            INSERT INTO workspace_members (workspaceId, userId, role)
            VALUES (?, ?, ?)
            ON CONFLICT(workspaceId, userId) DO UPDATE SET role = excluded.role
        `);
    }

    ensurePersonalWorkspace(ownerUserId: string): WorkspaceRecord {
        const existing = this.findPersonalStmt.get(ownerUserId) as WorkspaceRow | undefined;
        if (existing) {
            return existing;
        }

        const workspaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        this.insertWorkspaceStmt.run(workspaceId, ownerUserId, now);
        return this.findPersonalStmt.get(ownerUserId) as WorkspaceRow;
    }

    ensureOwnerMembership(workspaceId: string, userId: string): void {
        this.upsertMemberStmt.run(workspaceId, userId, "owner");
    }
}
