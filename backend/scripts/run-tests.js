require("ts-node/register/transpile-only");

const fs = require("fs");
const os = require("os");
const path = require("path");

function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeDirWithRetry(dirPath, attempts = 5) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            return;
        } catch (error) {
            const code = error && typeof error === "object" ? error.code : undefined;
            const isRetriable = code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY";
            if (!isRetriable) {
                throw error;
            }
            if (attempt === attempts) {
                console.warn(`WARN: temp cleanup skipped for ${dirPath} (${code})`);
                return;
            }
            sleepMs(50 * attempt);
        }
    }
}

function fail(message) {
    throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        fail(`${message} (expected: ${expected}, actual: ${actual})`);
    }
}

function assertTrue(value, message) {
    if (!value) {
        fail(message);
    }
}

function test(name, fn) {
    try {
        fn();
        console.log(`PASS: ${name}`);
        return true;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        console.error(err instanceof Error ? err.message : err);
        return false;
    }
}

function listFilesRecursive(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(fullPath));
            continue;
        }
        files.push(fullPath);
    }

    return files;
}

const { triageEmailRules } = require("../src/triageRules.ts");
const { mergeTokensForPersistence } = require("../src/authTokenPersistence.ts");
const { extractPlainTextFromPayload } = require("../src/gmail.ts");

const results = [];

results.push(
    test("gmail payload extraction: top-level plain text", () => {
        const payload = {
            mimeType: "text/plain",
            body: {
                data: Buffer.from("Hello plain text", "utf-8")
                    .toString("base64")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_"),
            },
        };
        const text = extractPlainTextFromPayload(payload);
        assertEqual(text, "Hello plain text", "Should decode top-level plain text payload");
    })
);

results.push(
    test("gmail payload extraction: nested multipart plain text fallback", () => {
        const payload = {
            mimeType: "multipart/alternative",
            parts: [
                {
                    mimeType: "text/html",
                    body: {
                        data: Buffer.from("<p>HTML</p>", "utf-8")
                            .toString("base64")
                            .replace(/\+/g, "-")
                            .replace(/\//g, "_"),
                    },
                },
                {
                    mimeType: "text/plain",
                    body: {
                        data: Buffer.from("Nested plain text", "utf-8")
                            .toString("base64")
                            .replace(/\+/g, "-")
                            .replace(/\//g, "_"),
                    },
                },
            ],
        };
        const text = extractPlainTextFromPayload(payload);
        assertEqual(text, "Nested plain text", "Should prefer nested text/plain payload");
    })
);

results.push(
    test("triageRules: github sender domain maps to operations", () => {
        const result = triageEmailRules({
            from: "GitHub <notifications@github.com>",
            subject: "Repository notification",
            snippet: "CI checks finished",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.category, "operations", "github.com sender should prioritize operations");
        assertEqual(result.priority, "P1", "operations should map to P1");
    })
);

results.push(
    test("triageRules: linkedin sender domain maps to career", () => {
        const result = triageEmailRules({
            from: "LinkedIn <jobs-noreply@linkedin.com>",
            subject: "Your weekly opportunities",
            snippet: "New roles and bonus information",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.category, "career", "linkedin.com sender should map to career");
        assertEqual(result.priority, "P2", "career should map to P2");
    })
);

results.push(
    test("triageRules: case-insensitive security match", () => {
        const result = triageEmailRules({
            from: "alerts@example.com",
            subject: "SECURITY ALERT",
            snippet: "suspicious sign-in detected",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.priority, "P0", "Security keyword should map to P0");
        assertEqual(result.category, "security", "Security keyword should map to security category");
    })
);

results.push(
    test("triageRules: recency boosts confidence for urgent categories", () => {
        const recent = triageEmailRules({
            from: "alerts@example.com",
            subject: "Security alert",
            snippet: "Verify this suspicious sign-in",
            date: new Date().toUTCString(),
        });
        const older = triageEmailRules({
            from: "alerts@example.com",
            subject: "Security alert",
            snippet: "Verify this suspicious sign-in",
            date: "Mon, 01 Jan 2024 00:00:00 +0000",
        });
        assertTrue(recent.confidence >= older.confidence, "Recent urgent emails should not have lower confidence");
    })
);

results.push(
    test("triageRules: billing match", () => {
        const result = triageEmailRules({
            from: "billing@example.com",
            subject: "Invoice available",
            snippet: "payment failed on your card",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.priority, "P1", "Billing keyword should map to P1");
        assertEqual(result.category, "billing", "Billing keyword should map to billing category");
    })
);

results.push(
    test("triageRules: overlapping operations signals increase confidence", () => {
        const result = triageEmailRules({
            from: "alerts@github.com",
            subject: "CI failed on main",
            snippet: "build failed and failing checks",
            date: new Date().toUTCString(),
        });
        assertEqual(result.category, "operations", "Operations overlap should map to operations");
        assertTrue(result.confidence >= 0.8, "Multiple operations signals should yield high confidence");
    })
);

results.push(
    test("triageRules: low-priority match", () => {
        const result = triageEmailRules({
            from: "no-reply@example.com",
            subject: "Weekly newsletter digest",
            snippet: "unsubscribe any time",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.priority, "P3", "Newsletter keyword should map to P3");
        assertEqual(result.category, "low", "Newsletter keyword should map to low category");
    })
);

results.push(
    test("triageRules: default match", () => {
        const result = triageEmailRules({
            from: "friend@example.com",
            subject: "Lunch?",
            snippet: "Want to catch up",
            date: "Mon, 17 Feb 2026 09:00:00 +0000",
        });
        assertEqual(result.priority, "P2", "Unmatched email should map to P2");
        assertEqual(result.category, "general", "Unmatched email should map to general category");
    })
);

results.push(
    test("triageRules: confidence always within [0,1]", () => {
        const samples = [
            { subject: "Password reset", snippet: "verification code 1234" },
            { subject: "Invoice", snippet: "billing update" },
            { subject: "Newsletter", snippet: "unsubscribe" },
            { subject: "General note", snippet: "hello there" },
        ];

        for (const sample of samples) {
            const result = triageEmailRules({
                from: "any@example.com",
                date: "Mon, 17 Feb 2026 09:00:00 +0000",
                ...sample,
            });
            assertTrue(result.confidence >= 0 && result.confidence <= 1, "Confidence must be between 0 and 1");
        }
    })
);

results.push(
    test("guard: no openai usage in backend/src and backend/package.json", () => {
        const backendRoot = path.resolve(__dirname, "..");
        const srcDir = path.join(backendRoot, "src");
        const srcFiles = listFilesRecursive(srcDir).filter((filePath) =>
            /\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(filePath)
        );
        const filesToScan = [...srcFiles, path.join(backendRoot, "package.json")];

        for (const filePath of filesToScan) {
            const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
            assertTrue(!content.includes("openai"), `Forbidden 'openai' reference found in ${filePath}`);
        }
    })
);

results.push(
    test("authTokenPersistence: preserves existing refresh token when Google omits it", () => {
        const merged = mergeTokensForPersistence({
            nextTokens: { access_token: "new-access", expiry_date: 2222 },
            currentTokens: { refresh_token: "keep-me", access_token: "old-access", expiry_date: 1111 },
            persistedTokens: { refresh_token: "persisted-refresh" },
        });
        assertEqual(merged.refresh_token, "keep-me", "Refresh token should be preserved from current token set");
        assertEqual(merged.access_token, "new-access", "Access token should be updated from nextTokens");
        assertEqual(merged.expiry_date, 2222, "Expiry should be updated from nextTokens");
    })
);

results.push(
    test("authTokenPersistence: falls back to persisted refresh token", () => {
        const merged = mergeTokensForPersistence({
            nextTokens: { access_token: "new-access" },
            currentTokens: {},
            persistedTokens: { refresh_token: "persisted-refresh" },
        });
        assertEqual(
            merged.refresh_token,
            "persisted-refresh",
            "Persisted refresh token should be used when next/current have none"
        );
    })
);

results.push(
    test("tokenStore: save/load/clear persistence", () => {
        const previousCwd = process.cwd();
        const previousEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "triage-token-store-"));

        try {
            process.chdir(tmpRoot);
            delete process.env.TOKEN_ENCRYPTION_KEY;
            const tokenStorePath = require.resolve("../src/tokenStore.ts");
            delete require.cache[tokenStorePath];
            const tokenStore = require("../src/tokenStore.ts");

            assertEqual(tokenStore.tokenFilePresent(), false, "Token file should not exist before save");
            tokenStore.saveTokens({
                refresh_token: "refresh-123",
                access_token: "access-abc",
                expiry_date: 9876543210,
            });
            assertEqual(tokenStore.tokenFilePresent(), true, "Token file should exist after save");
            const loaded = tokenStore.loadTokens();
            assertEqual(loaded?.refresh_token, "refresh-123", "Saved refresh_token should load back");
            assertEqual(loaded?.access_token, "access-abc", "Saved access_token should load back");
            assertEqual(loaded?.expiry_date, 9876543210, "Saved expiry_date should load back");
            tokenStore.clearTokens();
            assertEqual(tokenStore.tokenFilePresent(), false, "Token file should be deleted after clear");
        } finally {
            if (previousEncryptionKey === undefined) {
                delete process.env.TOKEN_ENCRYPTION_KEY;
            } else {
                process.env.TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
            }
            process.chdir(previousCwd);
            removeDirWithRetry(tmpRoot);
        }
    })
);

results.push(
    test("tokenStore: encrypts token file when TOKEN_ENCRYPTION_KEY is set", () => {
        const previousCwd = process.cwd();
        const previousEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "triage-token-store-encrypted-"));

        try {
            process.chdir(tmpRoot);
            process.env.TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key";

            const tokenStorePath = require.resolve("../src/tokenStore.ts");
            delete require.cache[tokenStorePath];
            const tokenStore = require("../src/tokenStore.ts");

            tokenStore.saveTokens({
                refresh_token: "refresh-secure",
                access_token: "access-secure",
                expiry_date: 1122334455,
            });

            const tokenFilePath = path.join(tmpRoot, "data", "token.json");
            const raw = fs.readFileSync(tokenFilePath, "utf-8");
            assertTrue(!raw.includes("refresh-secure"), "Encrypted token file must not contain plaintext token values");

            const loaded = tokenStore.loadTokens();
            assertEqual(loaded?.refresh_token, "refresh-secure", "Encrypted token payload should decrypt correctly");
            tokenStore.clearTokens();
        } finally {
            if (previousEncryptionKey === undefined) {
                delete process.env.TOKEN_ENCRYPTION_KEY;
            } else {
                process.env.TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
            }
            process.chdir(previousCwd);
            removeDirWithRetry(tmpRoot);
        }
    })
);

results.push(
    test("sqlite state: feature flags, rules, and overrides persist", () => {
        const previousCwd = process.cwd();
        const previousDbPath = process.env.DB_PATH;
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opsinbox-db-state-"));
        let dbModule = null;

        try {
            process.chdir(tmpRoot);
            process.env.DB_PATH = path.join(tmpRoot, "state.db");

            const envPath = require.resolve("../src/infrastructure/config/env.ts");
            const dbPath = require.resolve("../src/infrastructure/db/database.ts");
            const repoPath = require.resolve("../src/infrastructure/db/opsStateRepository.ts");
            delete require.cache[envPath];
            delete require.cache[dbPath];
            delete require.cache[repoPath];

            const repo = require("../src/infrastructure/db/opsStateRepository.ts");
            dbModule = require("../src/infrastructure/db/database.ts");

            const defaults = repo.getFeatureFlags();
            assertEqual(defaults.aiTriageEnabled, false, "Default aiTriageEnabled should be false");

            const updatedFlags = repo.setAiTriageEnabled(true);
            assertEqual(updatedFlags.aiMode, "shadow", "Enabled AI flag should set shadow mode");
            const loadedFlags = repo.getFeatureFlags();
            assertEqual(loadedFlags.aiTriageEnabled, true, "Updated feature flag should persist");

            const createdRule = repo.createRuleConfig({
                id: "rule-test-1",
                name: "CI failures",
                description: "Escalate CI failures",
                matchers: ["ci failed", "build failed"],
                priority: "P1",
                category: "operations",
                enabled: true,
            });
            assertEqual(createdRule.id, "rule-test-1", "Rule should be created");
            const rules = repo.listRuleConfigs();
            assertTrue(rules.some((rule) => rule.id === "rule-test-1"), "Created rule should be listed");

            const override = repo.upsertOverride("msg-123", {
                done: true,
                note: "Handled by on-call",
                tags: ["oncall", "incident"],
            });
            assertEqual(override.done, true, "Override should store done=true");
            const loadedOverride = repo.getOverride("msg-123");
            assertEqual(loadedOverride?.note, "Handled by on-call", "Override note should persist");

            repo.saveMessageMeta({
                id: "msg-123",
                threadId: "thread-123",
                from: "alerts@github.com",
                subject: "CI failed",
                snippet: "Build failed on main",
                date: new Date().toUTCString(),
            });
            repo.saveTriageResult("msg-123", {
                priority: "P1",
                category: "operations",
                summary: "Operational alert likely requiring quick action.",
                action: "Review logs or system status and resolve failures.",
                confidence: 0.88,
            });
        } finally {
            if (dbModule && typeof dbModule.closeDb === "function") {
                dbModule.closeDb();
            }
            if (previousDbPath === undefined) {
                delete process.env.DB_PATH;
            } else {
                process.env.DB_PATH = previousDbPath;
            }
            process.chdir(previousCwd);
            removeDirWithRetry(tmpRoot);
        }
    })
);

if (results.every(Boolean)) {
    console.log("ALL TESTS PASSED");
    process.exit(0);
}

console.error("TESTS FAILED");
process.exit(1);
