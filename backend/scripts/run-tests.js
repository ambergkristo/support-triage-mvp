require("ts-node/register/transpile-only");

const fs = require("fs");
const os = require("os");
const path = require("path");

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

async function test(name, fn) {
    try {
        await fn();
        console.log(`PASS: ${name}`);
        return true;
    } catch (err) {
        console.error(`FAIL: ${name}`);
        console.error(err instanceof Error ? err.message : err);
        return false;
    }
}

function requireFresh(modulePath) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    return require(modulePath);
}

function clearLocalRequireCache() {
    const suffixes = [
        "src/infrastructure/sqlite.ts",
        "src/infrastructure/sqliteMigrations.ts",
        "src/server.ts",
        "src/infrastructure/repositories/userRepository.ts",
        "src/infrastructure/repositories/workspaceRepository.ts",
        "src/infrastructure/repositories/inboxAccountRepository.ts",
        "src/infrastructure/repositories/oauthTokenRepository.ts",
    ];
    for (const key of Object.keys(require.cache)) {
        if (suffixes.some((suffix) => key.endsWith(suffix.replace(/\//g, path.sep)))) {
            delete require.cache[key];
        }
    }
}

async function withTempDb(run) {
    const previousDbPath = process.env.SQLITE_DB_PATH;
    const previousTokenKey = process.env.TOKEN_ENCRYPTION_KEY;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "triage-m3-tests-"));
    const dbPath = path.join(tmpRoot, "app.db");
    process.env.SQLITE_DB_PATH = dbPath;
    process.env.TOKEN_ENCRYPTION_KEY = "m3-test-encryption-key";

    clearLocalRequireCache();
    const sqlite = requireFresh("../src/infrastructure/sqlite.ts");
    sqlite.closeDatabaseForTests();

    try {
        await run({ dbPath });
    } finally {
        sqlite.closeDatabaseForTests();
        clearLocalRequireCache();
        if (previousDbPath === undefined) {
            delete process.env.SQLITE_DB_PATH;
        } else {
            process.env.SQLITE_DB_PATH = previousDbPath;
        }
        if (previousTokenKey === undefined) {
            delete process.env.TOKEN_ENCRYPTION_KEY;
        } else {
            process.env.TOKEN_ENCRYPTION_KEY = previousTokenKey;
        }
        // SQLite can hold short-lived WAL/SHM handles on Windows; skip hard cleanup in tests.
    }
}

function listFilesRecursive(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

async function main() {
    const results = [];
    const { extractPlainTextFromPayload } = require("../src/gmail.ts");

    results.push(
        await test("gmail payload extraction: top-level plain text", async () => {
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
        await test("m3: first OAuth provisioning creates user/workspace/inbox rows", async () => {
            await withTempDb(async () => {
                const { getDatabase } = requireFresh("../src/infrastructure/sqlite.ts");
                const { UserRepository } = requireFresh("../src/infrastructure/repositories/userRepository.ts");
                const { WorkspaceRepository } = requireFresh(
                    "../src/infrastructure/repositories/workspaceRepository.ts"
                );
                const { InboxAccountRepository } = requireFresh(
                    "../src/infrastructure/repositories/inboxAccountRepository.ts"
                );
                const { OAuthTokenRepository } = requireFresh(
                    "../src/infrastructure/repositories/oauthTokenRepository.ts"
                );

                const db = getDatabase();
                const users = new UserRepository(db);
                const workspaces = new WorkspaceRepository(db);
                const inboxes = new InboxAccountRepository(db);
                const tokens = new OAuthTokenRepository(db);

                const user = users.upsertGoogleUserByEmail("owner@example.com");
                const workspace = workspaces.ensurePersonalWorkspace(user.id);
                workspaces.ensureOwnerMembership(workspace.id, user.id);
                const inbox = inboxes.upsertGoogleAccount(workspace.id, user.email, user.email);
                tokens.saveForInboxAccount(inbox.id, {
                    access_token: "oauth-access",
                    refresh_token: "oauth-refresh",
                    expiry_date: 4102444800000,
                });

                const userRow = db.prepare("SELECT id, email, createdAt FROM users WHERE id = ?").get(user.id);
                const workspaceRow = db
                    .prepare("SELECT id, name, ownerUserId, createdAt FROM workspaces WHERE id = ?")
                    .get(workspace.id);
                const memberRow = db
                    .prepare("SELECT workspaceId, userId, role FROM workspace_members WHERE workspaceId = ? AND userId = ?")
                    .get(workspace.id, user.id);
                const inboxRow = db
                    .prepare("SELECT id, workspaceId, provider, googleSubject, email, createdAt FROM inbox_accounts WHERE id = ?")
                    .get(inbox.id);

                assertTrue(Boolean(userRow), "Expected users row");
                assertTrue(Boolean(workspaceRow), "Expected workspaces row");
                assertEqual(workspaceRow.name, "Personal", "Expected default workspace Personal");
                assertTrue(Boolean(memberRow), "Expected workspace_members row");
                assertEqual(memberRow.role, "owner", "Expected owner membership");
                assertTrue(Boolean(inboxRow), "Expected inbox_accounts row");
                assertEqual(inboxRow.provider, "google", "Expected google provider");
            });
        })
    );

    results.push(
        await test("m3: oauth_tokens stores encrypted payload and decrypts", async () => {
            await withTempDb(async () => {
                const { getDatabase } = requireFresh("../src/infrastructure/sqlite.ts");
                const { UserRepository } = requireFresh("../src/infrastructure/repositories/userRepository.ts");
                const { WorkspaceRepository } = requireFresh(
                    "../src/infrastructure/repositories/workspaceRepository.ts"
                );
                const { InboxAccountRepository } = requireFresh(
                    "../src/infrastructure/repositories/inboxAccountRepository.ts"
                );
                const { OAuthTokenRepository } = requireFresh(
                    "../src/infrastructure/repositories/oauthTokenRepository.ts"
                );

                const db = getDatabase();
                const users = new UserRepository(db);
                const workspaces = new WorkspaceRepository(db);
                const inboxes = new InboxAccountRepository(db);
                const oauthTokens = new OAuthTokenRepository(db);

                const user = users.upsertGoogleUserByEmail("secure@example.com");
                const workspace = workspaces.ensurePersonalWorkspace(user.id);
                workspaces.ensureOwnerMembership(workspace.id, user.id);
                const inbox = inboxes.upsertGoogleAccount(workspace.id, user.email, user.email);
                oauthTokens.saveForInboxAccount(inbox.id, {
                    access_token: "a-secure",
                    refresh_token: "r-secure",
                    expiry_date: 4102444800000,
                });

                const row = db
                    .prepare("SELECT encryptedTokenJson FROM oauth_tokens WHERE inboxAccountId = ?")
                    .get(inbox.id);
                assertTrue(Boolean(row), "Expected oauth_tokens row");
                assertTrue(
                    !String(row.encryptedTokenJson).includes("r-secure"),
                    "Encrypted token payload must not contain plaintext refresh token"
                );

                const loaded = oauthTokens.findForInboxAccount(inbox.id);
                assertEqual(loaded.refresh_token, "r-secure", "Expected decrypted refresh token");
            });
        })
    );

    results.push(
        await test("m3: restart-safe auth linkage keeps ids available", async () => {
            await withTempDb(async () => {
                {
                    const { getDatabase } = requireFresh("../src/infrastructure/sqlite.ts");
                    const { UserRepository } = requireFresh("../src/infrastructure/repositories/userRepository.ts");
                    const { WorkspaceRepository } = requireFresh(
                        "../src/infrastructure/repositories/workspaceRepository.ts"
                    );
                    const { InboxAccountRepository } = requireFresh(
                        "../src/infrastructure/repositories/inboxAccountRepository.ts"
                    );
                    const { OAuthTokenRepository } = requireFresh(
                        "../src/infrastructure/repositories/oauthTokenRepository.ts"
                    );

                    const db = getDatabase();
                    const users = new UserRepository(db);
                    const workspaces = new WorkspaceRepository(db);
                    const inboxes = new InboxAccountRepository(db);
                    const oauthTokens = new OAuthTokenRepository(db);

                    const user = users.upsertGoogleUserByEmail("persist@example.com");
                    const workspace = workspaces.ensurePersonalWorkspace(user.id);
                    workspaces.ensureOwnerMembership(workspace.id, user.id);
                    const inbox = inboxes.upsertGoogleAccount(workspace.id, user.email, user.email);
                    oauthTokens.saveForInboxAccount(inbox.id, {
                        access_token: "persist-access",
                        refresh_token: "persist-refresh",
                        expiry_date: 4102444800000,
                    });
                }

                clearLocalRequireCache();
                const { OAuthTokenRepository } = requireFresh("../src/infrastructure/repositories/oauthTokenRepository.ts");
                const { getDatabase } = requireFresh("../src/infrastructure/sqlite.ts");
                const oauthTokensAfterRestart = new OAuthTokenRepository(getDatabase());
                const context = oauthTokensAfterRestart.findLatestLinkedContext();
                assertTrue(Boolean(context), "Expected linked auth context after simulated restart");
                assertTrue(Boolean(context.userId), "Expected persisted userId");
                assertTrue(Boolean(context.workspaceId), "Expected persisted workspaceId");
                assertTrue(Boolean(context.inboxAccountId), "Expected persisted inboxAccountId");
                const tokens = oauthTokensAfterRestart.findForInboxAccount(context.inboxAccountId);
                assertEqual(tokens.refresh_token, "persist-refresh", "Expected persisted token after restart");
            });
        })
    );

    results.push(
        await test("guard: no openai usage in backend/src and backend/package.json", async () => {
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

    if (results.every(Boolean)) {
        console.log("ALL TESTS PASSED");
        process.exit(0);
    }

    console.error("TESTS FAILED");
    process.exit(1);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
