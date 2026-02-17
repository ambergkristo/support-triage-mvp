import { getDb } from "./database";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type TriageOverride = {
    done: boolean;
    note: string;
    tags: string[];
    updatedAt: string;
};

export type RuleConfig = {
    id: string;
    name: string;
    description: string;
    matchers: string[];
    priority: Priority;
    category: string;
    enabled: boolean;
};

export type FeatureFlags = {
    aiTriageEnabled: boolean;
    aiMode: "disabled" | "shadow";
    safeFallback: "rules";
};

type MessageMeta = {
    id: string;
    threadId?: string;
    from: string;
    subject: string;
    snippet: string;
    date: string;
};

type TriageResultRecord = {
    priority: Priority;
    category: string;
    summary: string;
    action: string;
    confidence: number;
};

const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
    aiTriageEnabled: false,
    aiMode: "disabled",
    safeFallback: "rules",
};

const DEFAULT_SECURITY_RULE: RuleConfig = {
    id: "rule-security-1",
    name: "Security alerts",
    description: "Escalate suspicious and verification-related messages.",
    matchers: ["verification code", "security alert", "suspicious"],
    priority: "P0",
    category: "security",
    enabled: true,
};

function safeParseStringArray(value: string): string[] {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is string => typeof item === "string");
    } catch {
        return [];
    }
}

function safeParseFeatureFlags(value: string): FeatureFlags {
    try {
        const parsed = JSON.parse(value) as Partial<FeatureFlags>;
        if (!parsed || typeof parsed !== "object") {
            return DEFAULT_FEATURE_FLAGS;
        }
        return {
            aiTriageEnabled: Boolean(parsed.aiTriageEnabled),
            aiMode: parsed.aiTriageEnabled ? "shadow" : "disabled",
            safeFallback: "rules",
        };
    } catch {
        return DEFAULT_FEATURE_FLAGS;
    }
}

export function getFeatureFlags(): FeatureFlags {
    const db = getDb();
    const row = db
        .prepare("SELECT value_json FROM feature_flags WHERE key = ?")
        .get("system") as { value_json: string } | undefined;

    if (!row) {
        db.prepare(
            "INSERT INTO feature_flags (key, value_json, updated_at) VALUES (?, ?, ?)"
        ).run("system", JSON.stringify(DEFAULT_FEATURE_FLAGS), new Date().toISOString());
        return DEFAULT_FEATURE_FLAGS;
    }

    return safeParseFeatureFlags(row.value_json);
}

export function setAiTriageEnabled(enabled: boolean): FeatureFlags {
    const nextFlags: FeatureFlags = {
        aiTriageEnabled: enabled,
        aiMode: enabled ? "shadow" : "disabled",
        safeFallback: "rules",
    };
    const db = getDb();
    db.prepare(
        `
        INSERT INTO feature_flags (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
    `
    ).run("system", JSON.stringify(nextFlags), new Date().toISOString());
    return nextFlags;
}

export function listRuleConfigs(): RuleConfig[] {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT id, name, description, matchers_json, priority, category, enabled
            FROM rule_configs
            ORDER BY id
        `
        )
        .all() as Array<{
        id: string;
        name: string;
        description: string;
        matchers_json: string;
        priority: Priority;
        category: string;
        enabled: number;
    }>;

    if (rows.length === 0) {
        createRuleConfig(DEFAULT_SECURITY_RULE);
        return [DEFAULT_SECURITY_RULE];
    }

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        matchers: safeParseStringArray(row.matchers_json),
        priority: row.priority,
        category: row.category,
        enabled: Boolean(row.enabled),
    }));
}

export function createRuleConfig(input: RuleConfig): RuleConfig {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
        `
        INSERT INTO rule_configs (
            id, name, description, matchers_json, priority, category, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
        input.id,
        input.name,
        input.description,
        JSON.stringify(input.matchers),
        input.priority,
        input.category,
        input.enabled ? 1 : 0,
        now,
        now
    );
    return input;
}

export function listOverrides(): Array<{ id: string; override: TriageOverride }> {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT
                a.message_id,
                a.done,
                a.tags_json,
                a.updated_at AS assignment_updated_at,
                n.body AS note_body,
                n.updated_at AS note_updated_at
            FROM assignments a
            LEFT JOIN notes n
                ON n.id = (
                    SELECT id
                    FROM notes
                    WHERE message_id = a.message_id
                    ORDER BY updated_at DESC
                    LIMIT 1
                )
            ORDER BY a.updated_at DESC
        `
        )
        .all() as Array<{
        message_id: string;
        done: number;
        tags_json: string;
        assignment_updated_at: string;
        note_body?: string;
        note_updated_at?: string;
    }>;

    return rows.map((row) => {
        const updatedAt =
            row.note_updated_at && row.note_updated_at > row.assignment_updated_at
                ? row.note_updated_at
                : row.assignment_updated_at;

        return {
            id: row.message_id,
            override: {
                done: Boolean(row.done),
                note: row.note_body ?? "",
                tags: safeParseStringArray(row.tags_json),
                updatedAt,
            },
        };
    });
}

export function getOverride(messageId: string): TriageOverride | null {
    const item = listOverrides().find((row) => row.id === messageId);
    return item?.override ?? null;
}

export function upsertOverride(messageId: string, override: Omit<TriageOverride, "updatedAt">): TriageOverride {
    const db = getDb();
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(override.tags);

    db.prepare(
        `
        INSERT INTO messages (id, thread_id, sender, subject, snippet, message_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
    `
    ).run(messageId, null, "unknown", "(pending sync)", "", now, now, now);

    db.prepare(
        `
        INSERT INTO assignments (message_id, status, done, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
            status = excluded.status,
            done = excluded.done,
            tags_json = excluded.tags_json,
            updated_at = excluded.updated_at
    `
    ).run(messageId, override.done ? "done" : "open", override.done ? 1 : 0, tagsJson, now, now);

    db.prepare(
        `
        INSERT INTO notes (message_id, body, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `
    ).run(messageId, override.note, now, now);

    return {
        ...override,
        updatedAt: now,
    };
}

export function listTeamInbox() {
    const db = getDb();
    return db
        .prepare(
            `
            SELECT
                a.message_id AS emailId,
                a.done AS done,
                a.tags_json AS tags_json,
                a.updated_at AS updatedAt,
                (
                    SELECT body
                    FROM notes
                    WHERE message_id = a.message_id
                    ORDER BY updated_at DESC
                    LIMIT 1
                ) AS note
            FROM assignments a
            ORDER BY a.updated_at DESC
        `
        )
        .all()
        .map((row: any) => ({
            emailId: String(row.emailId),
            done: Boolean(row.done),
            note: typeof row.note === "string" ? row.note : "",
            tags: safeParseStringArray(String(row.tags_json ?? "[]")),
            updatedAt: String(row.updatedAt),
        }));
}

export function saveMessageMeta(email: MessageMeta) {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
        `
        INSERT INTO messages (
            id, thread_id, sender, subject, snippet, message_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            thread_id = excluded.thread_id,
            sender = excluded.sender,
            subject = excluded.subject,
            snippet = excluded.snippet,
            message_date = excluded.message_date,
            updated_at = excluded.updated_at
    `
    ).run(
        email.id,
        email.threadId ?? null,
        email.from,
        email.subject,
        email.snippet,
        email.date,
        now,
        now
    );
}

export function saveTriageResult(messageId: string, triage: TriageResultRecord) {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
        `
        INSERT INTO triage_results (
            message_id, priority, category, summary, action, confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(message_id) DO UPDATE SET
            priority = excluded.priority,
            category = excluded.category,
            summary = excluded.summary,
            action = excluded.action,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
    `
    ).run(
        messageId,
        triage.priority,
        triage.category,
        triage.summary,
        triage.action,
        triage.confidence,
        now,
        now
    );
}

export function logActivity(event: string, payload: Record<string, unknown> = {}) {
    const db = getDb();
    db.prepare(
        "INSERT INTO activity_log (event, payload_json, created_at) VALUES (?, ?, ?)"
    ).run(event, JSON.stringify(payload), new Date().toISOString());
}
