import type Database from "better-sqlite3";

export type RuleConfig = {
    id: string;
    name: string;
    description: string;
    matchers: string[];
    priority: "P0" | "P1" | "P2" | "P3";
    category: string;
    enabled: boolean;
};

type RuleConfigRow = {
    id: string;
    name: string;
    description: string;
    matchers_json: string;
    priority: "P0" | "P1" | "P2" | "P3";
    category: string;
    enabled: number;
};

function toModel(row: RuleConfigRow): RuleConfig {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        matchers: JSON.parse(row.matchers_json) as string[],
        priority: row.priority,
        category: row.category,
        enabled: row.enabled === 1,
    };
}

export class RuleConfigRepository {
    private readonly listStmt;
    private readonly insertStmt;

    constructor(db: Database.Database) {
        this.listStmt = db.prepare("SELECT * FROM rule_configs ORDER BY id ASC");
        this.insertStmt = db.prepare(`
            INSERT INTO rule_configs (id, name, description, matchers_json, priority, category, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
    }

    listAll(): RuleConfig[] {
        const rows = this.listStmt.all() as RuleConfigRow[];
        return rows.map(toModel);
    }

    create(rule: RuleConfig): RuleConfig {
        this.insertStmt.run(
            rule.id,
            rule.name,
            rule.description,
            JSON.stringify(rule.matchers),
            rule.priority,
            rule.category,
            rule.enabled ? 1 : 0
        );
        return rule;
    }
}
