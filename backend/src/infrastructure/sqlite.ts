import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./sqliteMigrations";

let dbSingleton: Database.Database | null = null;

function resolveDatabasePath(): string {
    const configured = process.env.SQLITE_DB_PATH?.trim();
    if (configured) {
        return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
    }
    return path.join(process.cwd(), "data", "app.db");
}

function configureDatabase(db: Database.Database): void {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
}

export function getDatabase(): Database.Database {
    if (dbSingleton) {
        return dbSingleton;
    }

    const dbPath = resolveDatabasePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    configureDatabase(db);
    runMigrations(db);
    dbSingleton = db;
    return db;
}

export function closeDatabaseForTests(): void {
    if (!dbSingleton) {
        return;
    }
    dbSingleton.close();
    dbSingleton = null;
}
