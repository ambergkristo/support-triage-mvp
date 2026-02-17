import crypto from "crypto";
import type Database from "better-sqlite3";
import type { AuthUser } from "../../domain/auth/types";

type UserRow = {
    id: string;
    email: string;
    createdAt: string;
};

function toUser(row: UserRow): AuthUser {
    return {
        id: row.id,
        email: row.email,
        createdAt: row.createdAt,
    };
}

export class UserRepository {
    private readonly findByEmailStmt;
    private readonly findByIdStmt;
    private readonly insertStmt;

    constructor(private readonly db: Database.Database) {
        this.findByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
        this.findByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
        this.insertStmt = db.prepare("INSERT INTO users (id, email, createdAt) VALUES (?, ?, ?)");
    }

    upsertGoogleUserByEmail(email: string): AuthUser {
        const normalizedEmail = email.trim().toLowerCase();
        const now = new Date().toISOString();
        const existing = this.findByEmailStmt.get(normalizedEmail) as UserRow | undefined;

        if (existing) {
            return toUser(existing);
        }

        const id = crypto.randomUUID();
        this.insertStmt.run(id, normalizedEmail, now);
        const created = this.findByIdStmt.get(id) as UserRow;
        return toUser(created);
    }

    findById(id: string): AuthUser | null {
        const row = this.findByIdStmt.get(id) as UserRow | undefined;
        return row ? toUser(row) : null;
    }
}
