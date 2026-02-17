import type Database from "better-sqlite3";

export type FeatureFlags = {
    aiTriageEnabled: boolean;
    aiMode: "disabled" | "shadow";
    safeFallback: "rules";
};

type FeatureFlagRow = {
    ai_triage_enabled: number;
    ai_mode: "disabled" | "shadow";
    safe_fallback: "rules";
};

export class FeatureFlagRepository {
    private readonly getStmt;
    private readonly updateStmt;

    constructor(db: Database.Database) {
        this.getStmt = db.prepare(
            "SELECT ai_triage_enabled, ai_mode, safe_fallback FROM feature_flags WHERE id = 1"
        );
        this.updateStmt = db.prepare(
            "UPDATE feature_flags SET ai_triage_enabled = ?, ai_mode = ?, safe_fallback = ? WHERE id = 1"
        );
    }

    get(): FeatureFlags {
        const row = this.getStmt.get() as FeatureFlagRow;
        return {
            aiTriageEnabled: row.ai_triage_enabled === 1,
            aiMode: row.ai_mode,
            safeFallback: row.safe_fallback,
        };
    }

    setAiEnabled(enabled: boolean): FeatureFlags {
        const next: FeatureFlags = {
            aiTriageEnabled: enabled,
            aiMode: enabled ? "shadow" : "disabled",
            safeFallback: "rules",
        };
        this.updateStmt.run(next.aiTriageEnabled ? 1 : 0, next.aiMode, next.safeFallback);
        return next;
    }
}
