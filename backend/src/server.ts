import crypto from "crypto";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
    exchangeCodeForTokens,
    getAuthUrl,
    getEmailDetail,
    getGoogleUserEmail,
    listEmailMetasPage,
} from "./gmail";
import { triageEmailRules } from "./triageRules";
import { getDatabase } from "./infrastructure/sqlite";
import { UserRepository } from "./infrastructure/repositories/userRepository";
import { WorkspaceRepository } from "./infrastructure/repositories/workspaceRepository";
import { InboxAccountRepository } from "./infrastructure/repositories/inboxAccountRepository";
import { OAuthTokenRepository } from "./infrastructure/repositories/oauthTokenRepository";
import { TriageOverrideRepository } from "./infrastructure/repositories/triageOverrideRepository";
import { RuleConfigRepository, type RuleConfig } from "./infrastructure/repositories/ruleConfigRepository";
import { FeatureFlagRepository } from "./infrastructure/repositories/featureFlagRepository";

dotenv.config();

type ApiErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "INTERNAL_ERROR";

type TriageOverride = {
    done: boolean;
    note: string;
    tags: string[];
    updatedAt: string;
};

const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_REDIRECT_URL = process.env.FRONTEND_REDIRECT_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN;

const db = getDatabase();
const userRepository = new UserRepository(db);
const workspaceRepository = new WorkspaceRepository(db);
const inboxAccountRepository = new InboxAccountRepository(db);
const oauthTokenRepository = new OAuthTokenRepository(db);
const triageOverrideRepository = new TriageOverrideRepository(db);
const ruleConfigRepository = new RuleConfigRepository(db);
const featureFlagRepository = new FeatureFlagRepository(db);

function ensureDefaultRules(): void {
    const existing = ruleConfigRepository.listAll();
    if (existing.length > 0) {
        return;
    }

    ruleConfigRepository.create({
        id: "rule-security-1",
        name: "Security alerts",
        description: "Escalate suspicious and verification-related messages.",
        matchers: ["verification code", "security alert", "suspicious"],
        priority: "P0",
        category: "security",
        enabled: true,
    });
}

ensureDefaultRules();

function logAudit(event: string, fields: Record<string, unknown> = {}) {
    console.log(
        JSON.stringify({
            ts: new Date().toISOString(),
            event,
            ...fields,
        })
    );
}

function sendError(
    res: express.Response,
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: string
) {
    return res.status(status).json({
        message: "error",
        error: {
            code,
            message,
            ...(details ? { details } : {}),
        },
    });
}

function parseLimit(
    rawLimit: string | undefined,
    options: { fallback: number; min: number; max: number }
): { value: number; error?: string } {
    const { fallback, min, max } = options;
    if (rawLimit === undefined) {
        return { value: fallback };
    }

    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        return { value: fallback, error: `limit must be an integer between ${min} and ${max}` };
    }

    return { value: parsed };
}

function requireActiveGoogleContext(res: express.Response) {
    const context = oauthTokenRepository.findLatestLinkedContext();
    if (!context) {
        sendError(res, 401, "UNAUTHORIZED", "Not authenticated with Google OAuth");
        return null;
    }

    const tokens = oauthTokenRepository.findForInboxAccount(context.inboxAccountId);
    if (!tokens) {
        sendError(res, 401, "UNAUTHORIZED", "Not authenticated with Google OAuth");
        return null;
    }

    return { context, tokens };
}

export function createApp() {
    const app = express();
    app.use(express.json());

    const allowedOrigins = CORS_ORIGIN
        ? CORS_ORIGIN.split(",")
              .map((origin) => origin.trim())
              .filter((origin) => origin.length > 0)
        : [];

    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                    return callback(null, true);
                }
                return callback(new Error("CORS origin denied"));
            },
        })
    );

    app.use((req, res, next) => {
        const startedAt = Date.now();
        res.on("finish", () => {
            logAudit("http_request", {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
        next();
    });

    app.get("/", (req, res) => {
        res.json({ status: "API running" });
    });

    app.get("/health", (req, res) => {
        res.json({ status: "ok" });
    });

    app.get("/auth/google", (req, res) => {
        res.redirect(getAuthUrl());
    });

    app.get("/oauth2callback", async (req, res) => {
        try {
            const code = req.query.code as string | undefined;
            if (!code) {
                return sendError(res, 400, "BAD_REQUEST", "Missing code");
            }

            const tokens = await exchangeCodeForTokens(code);
            const email = await getGoogleUserEmail(tokens);
            if (!email) {
                return sendError(res, 500, "INTERNAL_ERROR", "Google account email not available");
            }

            const user = userRepository.upsertGoogleUserByEmail(email);
            const workspace = workspaceRepository.ensurePersonalWorkspace(user.id);
            workspaceRepository.ensureOwnerMembership(workspace.id, user.id);
            const inboxAccount = inboxAccountRepository.upsertGoogleAccount(workspace.id, user.email, user.email);
            oauthTokenRepository.saveForInboxAccount(inboxAccount.id, tokens);

            if (FRONTEND_REDIRECT_URL) {
                logAudit("auth_oauth_success", {
                    redirectedToFrontend: true,
                    userId: user.id,
                    workspaceId: workspace.id,
                    inboxAccountId: inboxAccount.id,
                });
                return res.redirect(`${FRONTEND_REDIRECT_URL}?oauth=success`);
            }

            logAudit("auth_oauth_success", {
                redirectedToFrontend: false,
                userId: user.id,
                workspaceId: workspace.id,
                inboxAccountId: inboxAccount.id,
            });
            return res.json({
                message: "OAuth successful",
                userId: user.id,
                workspaceId: workspace.id,
                inboxAccountId: inboxAccount.id,
            });
        } catch (err: any) {
            logAudit("auth_oauth_failed", { reason: err?.message ?? "unknown" });
            return sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "OAuth failed");
        }
    });

    app.get("/auth/status", (req, res) => {
        const context = oauthTokenRepository.findLatestLinkedContext();
        const tokens = context ? oauthTokenRepository.findForInboxAccount(context.inboxAccountId) : null;
        if (!context || !tokens) {
            return res.json({
                authenticated: false,
                hasRefreshToken: false,
                tokenFilePresent: false,
                userId: null,
                workspaceId: null,
                inboxAccountId: null,
                user: null,
            });
        }

        return res.json({
            authenticated: true,
            hasRefreshToken: Boolean(tokens.refresh_token),
            tokenFilePresent: oauthTokenRepository.tokenRowPresent(),
            userId: context.userId,
            workspaceId: context.workspaceId,
            inboxAccountId: context.inboxAccountId,
            user: {
                id: context.userId,
                email: context.email,
            },
        });
    });

    app.post("/auth/logout", (req, res) => {
        oauthTokenRepository.clearAll();
        logAudit("auth_logout");
        res.json({ message: "logged_out" });
    });

    app.get("/triage/overrides", (req, res) => {
        const active = requireActiveGoogleContext(res);
        if (!active) {
            return;
        }

        const items = triageOverrideRepository.listByUser(active.context.userId).map((entry) => ({
            id: entry.emailId,
            override: {
                done: entry.done,
                note: entry.note,
                tags: entry.tags,
                updatedAt: entry.updatedAt,
            },
        }));
        res.json({ message: "ok", items });
    });

    app.get("/team/inbox", (req, res) => {
        const active = requireActiveGoogleContext(res);
        if (!active) {
            return;
        }

        const items = triageOverrideRepository.listByUser(active.context.userId).map((entry) => ({
            emailId: entry.emailId,
            done: entry.done,
            note: entry.note,
            tags: entry.tags,
            updatedAt: entry.updatedAt,
        }));
        res.json({ message: "ok", items });
    });

    app.get("/admin/rules", (req, res) => {
        const active = requireActiveGoogleContext(res);
        if (!active) {
            return;
        }

        res.json({
            message: "ok",
            items: ruleConfigRepository.listAll(),
        });
    });

    app.post("/admin/rules", (req, res) => {
        const active = requireActiveGoogleContext(res);
        if (!active) {
            return;
        }

        const body = req.body as Partial<RuleConfig> | undefined;
        if (!body || typeof body !== "object") {
            return sendError(res, 400, "BAD_REQUEST", "Invalid rule payload");
        }

        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
        const description =
            typeof body.description === "string" && body.description.trim()
                ? body.description.trim()
                : "";
        const priority = body.priority;
        const category = typeof body.category === "string" ? body.category.trim() : "";
        const matchers = Array.isArray(body.matchers)
            ? body.matchers
                  .filter((matcher): matcher is string => typeof matcher === "string")
                  .map((matcher) => matcher.trim())
                  .filter(Boolean)
            : [];
        if (!name || !description || !category || !priority || matchers.length === 0) {
            return sendError(
                res,
                400,
                "BAD_REQUEST",
                "Rule requires name, description, priority, category, and at least one matcher"
            );
        }

        if (!["P0", "P1", "P2", "P3"].includes(priority)) {
            return sendError(res, 400, "BAD_REQUEST", "Invalid priority");
        }

        const item: RuleConfig = {
            id: crypto.randomUUID(),
            name,
            description,
            matchers,
            priority,
            category,
            enabled: body.enabled !== false,
        };

        ruleConfigRepository.create(item);
        res.status(201).json({ message: "ok", item });
    });

    app.get("/feature-flags", (req, res) => {
        res.json({ message: "ok", flags: featureFlagRepository.get() });
    });

    app.patch("/feature-flags/ai", (req, res) => {
        const body = req.body as { aiTriageEnabled?: boolean } | undefined;
        if (!body || typeof body.aiTriageEnabled !== "boolean") {
            return sendError(res, 400, "BAD_REQUEST", "aiTriageEnabled boolean is required");
        }

        const flags = featureFlagRepository.setAiEnabled(body.aiTriageEnabled);
        res.json({ message: "ok", flags });
    });

    app.put("/triage/overrides/:id", (req, res) => {
        const active = requireActiveGoogleContext(res);
        if (!active) {
            return;
        }

        const id = req.params.id;
        if (!id) {
            return sendError(res, 400, "BAD_REQUEST", "Missing email id");
        }

        const body = req.body as Partial<TriageOverride> | undefined;
        if (!body || typeof body !== "object") {
            return sendError(res, 400, "BAD_REQUEST", "Invalid override payload");
        }

        const done = typeof body.done === "boolean" ? body.done : false;
        const note = typeof body.note === "string" ? body.note.slice(0, 1000) : "";
        const tags = Array.isArray(body.tags)
            ? body.tags
                  .filter((tag): tag is string => typeof tag === "string")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0)
                  .slice(0, 10)
            : [];

        const override: TriageOverride = {
            done,
            note,
            tags,
            updatedAt: new Date().toISOString(),
        };

        triageOverrideRepository.upsert(active.context.userId, { emailId: id, ...override });
        res.json({ message: "ok", id, override });
    });

    app.get("/gmail/messages", async (req, res) => {
        try {
            const rawLimit = req.query.limit as string | undefined;
            const limitParse = parseLimit(rawLimit, { fallback: 10, min: 1, max: 100 });
            if (limitParse.error) {
                return sendError(res, 400, "BAD_REQUEST", "Invalid query parameter", limitParse.error);
            }
            const limit = limitParse.value;
            const pageToken = (req.query.pageToken as string | undefined) || undefined;
            if (req.query.pageToken !== undefined && typeof req.query.pageToken !== "string") {
                return sendError(
                    res,
                    400,
                    "BAD_REQUEST",
                    "Invalid query parameter",
                    "pageToken must be a string"
                );
            }

            const active = requireActiveGoogleContext(res);
            if (!active) {
                return;
            }

            const page = await listEmailMetasPage(active.tokens, limit, pageToken);
            res.json({
                message: "ok",
                items: page.items,
                nextPageToken: page.nextPageToken,
            });
        } catch (err: any) {
            if (err?.status === 401 || err?.code === 401) {
                return sendError(res, 401, "UNAUTHORIZED", "Not authenticated with Google OAuth");
            }
            return sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Failed to list messages");
        }
    });

    app.get("/gmail/messages/:id", async (req, res) => {
        try {
            const id = req.params.id;
            if (!id) {
                return sendError(res, 400, "BAD_REQUEST", "Missing message id");
            }

            const active = requireActiveGoogleContext(res);
            if (!active) {
                return;
            }

            const item = await getEmailDetail(active.tokens, id);
            res.json({ message: "ok", item });
        } catch (err: any) {
            if (err?.status === 401 || err?.code === 401) {
                return sendError(res, 401, "UNAUTHORIZED", "Not authenticated with Google OAuth");
            }
            if (err?.status === 404 || err?.code === 404) {
                return sendError(res, 404, "NOT_FOUND", "Message not found");
            }
            return sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Failed to fetch message detail");
        }
    });

    app.get("/triage", async (req, res) => {
        try {
            const rawLimit = req.query.limit as string | undefined;
            const limitParse = parseLimit(rawLimit, { fallback: 10, min: 1, max: 100 });
            if (limitParse.error) {
                return sendError(res, 400, "BAD_REQUEST", "Invalid query parameter", limitParse.error);
            }
            const limit = limitParse.value;
            const pageToken = (req.query.pageToken as string | undefined) || undefined;
            if (req.query.pageToken !== undefined && typeof req.query.pageToken !== "string") {
                return sendError(
                    res,
                    400,
                    "BAD_REQUEST",
                    "Invalid query parameter",
                    "pageToken must be a string"
                );
            }

            const active = requireActiveGoogleContext(res);
            if (!active) {
                return;
            }

            const page = await listEmailMetasPage(active.tokens, limit, pageToken);
            const overrides = triageOverrideRepository.listByUser(active.context.userId);
            const overrideMap = new Map(overrides.map((entry) => [entry.emailId, entry]));

            const items = page.items.map((e) => ({
                email: e,
                triage: triageEmailRules({
                    subject: e.subject,
                    from: e.from,
                    snippet: e.snippet,
                    date: e.date,
                }),
                ...(overrideMap.has(e.id)
                    ? {
                          override: {
                              done: overrideMap.get(e.id)!.done,
                              note: overrideMap.get(e.id)!.note,
                              tags: overrideMap.get(e.id)!.tags,
                              updatedAt: overrideMap.get(e.id)!.updatedAt,
                          },
                      }
                    : {}),
            }));

            return res.json({ message: "ok", items });
        } catch (err: any) {
            if (err?.status === 401 || err?.code === 401) {
                return sendError(res, 401, "UNAUTHORIZED", "Not authenticated with Google OAuth");
            }
            return sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Triage failed");
        }
    });

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err instanceof SyntaxError && "body" in err) {
            return sendError(res, 400, "BAD_REQUEST", "Invalid JSON body");
        }
        return next(err);
    });

    return app;
}

export function startServer() {
    const app = createApp();
    return app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

if (require.main === module) {
    startServer();
}
