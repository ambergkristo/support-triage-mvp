import type Database from "better-sqlite3";

export type TriageOverrideRecord = {
    emailId: string;
    done: boolean;
    note: string;
    tags: string[];
    updatedAt: string;
};

type OverrideRow = {
    user_id: string;
    email_id: string;
    done: number;
    note: string;
    tags_json: string;
    updated_at: string;
};

function fromRow(row: OverrideRow): TriageOverrideRecord {
    return {
        emailId: row.email_id,
        done: row.done === 1,
        note: row.note,
        tags: JSON.parse(row.tags_json) as string[],
        updatedAt: row.updated_at,
    };
}

export class TriageOverrideRepository {
    private readonly upsertStmt;
    private readonly listByUserStmt;

    constructor(private readonly db: Database.Database) {
        this.upsertStmt = db.prepare(`
            INSERT INTO triage_overrides (user_id, email_id, done, note, tags_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, email_id) DO UPDATE SET
                done = excluded.done,
                note = excluded.note,
                tags_json = excluded.tags_json,
                updated_at = excluded.updated_at
        `);
        this.listByUserStmt = db.prepare("SELECT * FROM triage_overrides WHERE user_id = ?");
    }

    upsert(userId: string, input: TriageOverrideRecord): void {
        this.upsertStmt.run(
            userId,
            input.emailId,
            input.done ? 1 : 0,
            input.note,
            JSON.stringify(input.tags),
            input.updatedAt
        );
    }

    listByUser(userId: string): TriageOverrideRecord[] {
        const rows = this.listByUserStmt.all(userId) as OverrideRow[];
        return rows.map(fromRow);
    }
}
