import express from "express";
import cors from "cors";
import { env } from "../infrastructure/config/env";
import { getAuthUrl, oAuth2Client, listEmailMetas, listEmailMetasPage, getEmailDetail } from "../gmail";
import { triageEmailRules } from "../triageRules";
import { mergeTokensForPersistence } from "../authTokenPersistence";
import {
    clearTokens,
    loadTokens,
    saveTokens,
    tokenFilePresent,
} from "../tokenStore";
import {
    createRuleConfig,
    getFeatureFlags,
    getOverride,
    listOverrides,
    listRuleConfigs,
    listTeamInbox,
    logActivity,
    saveMessageMeta,
    saveTriageResult,
    setAiTriageEnabled,
    upsertOverride,
    type RuleConfig,
    type TriageOverride,
} from "../infrastructure/db/opsStateRepository";
import { getDb } from "../infrastructure/db/database";

const app = express();
app.use(express.json());

const PORT = env.PORT;
const AUTH_ERROR = "Not authenticated with Google OAuth";
const FRONTEND_REDIRECT_URL = env.FRONTEND_REDIRECT_URL;
const CORS_ORIGIN = env.CORS_ORIGIN;
const TRIAGE_CACHE_TTL_MS = 30_000;

getDb();

type ApiErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "NOT_FOUND" | "INTERNAL_ERROR";

type TriageItem = {
    email: {
        id: string;
        threadId: string;
        snippet: string;
        subject: string;
        from: string;
        date: string;
    };
    triage: ReturnType<typeof triageEmailRules>;
    override?: TriageOverride;
};

const triageCache = new Map<string, { expiresAt: number; items: TriageItem[] }>();

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

function triageCacheKey(limit: number, pageToken?: string): string {
    return `${limit}:${pageToken ?? ""}`;
}

function clearTriageCache() {
    triageCache.clear();
}

function logAudit(event: string, fields: Record<string, unknown> = {}) {
    const payload = {
        ts: new Date().toISOString(),
        event,
        ...fields,
    };
    console.log(JSON.stringify(payload));
    logActivity(event, fields);
}

function hasGoogleOAuthCredentials() {
    const creds = oAuth2Client.credentials;
    return Boolean(creds?.access_token || creds?.refresh_token);
}

const persistedTokens = loadTokens();
if (persistedTokens) {
    oAuth2Client.setCredentials(persistedTokens);
}

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

        const { tokens } = await oAuth2Client.getToken(code);
        const mergedTokens = mergeTokensForPersistence({
            nextTokens: tokens,
            currentTokens: oAuth2Client.credentials,
            persistedTokens: loadTokens(),
        });
        oAuth2Client.setCredentials(mergedTokens);
        saveTokens(mergedTokens);
        clearTriageCache();

        const emails = await listEmailMetas(10);

        if (FRONTEND_REDIRECT_URL) {
            logAudit("auth_oauth_success", { redirectedToFrontend: true });
            return res.redirect(`${FRONTEND_REDIRECT_URL}?oauth=success`);
        }

        logAudit("auth_oauth_success", { redirectedToFrontend: false });
        res.json({ message: "OAuth successful", emails });
    } catch (err: any) {
        logAudit("auth_oauth_failed", { reason: err?.message ?? "unknown" });
        sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "OAuth failed");
    }
});

app.get("/auth/status", (req, res) => {
    const creds = oAuth2Client.credentials;
    res.json({
        authenticated: Boolean(creds?.access_token || creds?.refresh_token),
        hasRefreshToken: Boolean(creds?.refresh_token),
        tokenFilePresent: tokenFilePresent(),
    });
});

app.post("/auth/logout", (req, res) => {
    oAuth2Client.setCredentials({});
    clearTokens();
    clearTriageCache();
    logAudit("auth_logout");
    res.json({ message: "logged_out" });
});

app.get("/triage/overrides", (req, res) => {
    if (!hasGoogleOAuthCredentials()) {
        return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
    }

    res.json({ message: "ok", items: listOverrides() });
});

app.get("/team/inbox", (req, res) => {
    if (!hasGoogleOAuthCredentials()) {
        return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
    }

    res.json({ message: "ok", items: listTeamInbox() });
});

app.get("/admin/rules", (req, res) => {
    if (!hasGoogleOAuthCredentials()) {
        return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
    }

    res.json({
        message: "ok",
        items: listRuleConfigs(),
    });
});

app.post("/admin/rules", (req, res) => {
    if (!hasGoogleOAuthCredentials()) {
        return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
    }

    const body = req.body as Partial<RuleConfig> | undefined;
    if (!body || typeof body !== "object") {
        return sendError(res, 400, "BAD_REQUEST", "Invalid rule payload");
    }

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
    const description =
        typeof body.description === "string" && body.description.trim() ? body.description.trim() : "";
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
        id: `rule-${Date.now()}`,
        name,
        description,
        matchers,
        priority,
        category,
        enabled: body.enabled !== false,
    };

    createRuleConfig(item);
    res.status(201).json({ message: "ok", item });
});

app.get("/feature-flags", (req, res) => {
    res.json({ message: "ok", flags: getFeatureFlags() });
});

app.patch("/feature-flags/ai", (req, res) => {
    const body = req.body as { aiTriageEnabled?: boolean } | undefined;
    if (!body || typeof body.aiTriageEnabled !== "boolean") {
        return sendError(res, 400, "BAD_REQUEST", "aiTriageEnabled boolean is required");
    }

    const flags = setAiTriageEnabled(body.aiTriageEnabled);
    res.json({ message: "ok", flags });
});

app.put("/triage/overrides/:id", (req, res) => {
    if (!hasGoogleOAuthCredentials()) {
        return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
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

    const override = upsertOverride(id, { done, note, tags });
    clearTriageCache();
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
            return sendError(res, 400, "BAD_REQUEST", "Invalid query parameter", "pageToken must be a string");
        }

        if (!hasGoogleOAuthCredentials()) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }

        const page = await listEmailMetasPage(limit, pageToken);
        res.json({
            message: "ok",
            items: page.items,
            nextPageToken: page.nextPageToken,
        });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }
        sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Failed to list messages");
    }
});

app.get("/gmail/messages/:id", async (req, res) => {
    try {
        if (!hasGoogleOAuthCredentials()) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }

        const id = req.params.id;
        if (!id) {
            return sendError(res, 400, "BAD_REQUEST", "Missing message id");
        }

        const item = await getEmailDetail(id);
        res.json({ message: "ok", item });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }
        if (err?.status === 404 || err?.code === 404) {
            return sendError(res, 404, "NOT_FOUND", "Message not found");
        }
        sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Failed to fetch message detail");
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
            return sendError(res, 400, "BAD_REQUEST", "Invalid query parameter", "pageToken must be a string");
        }

        if (!hasGoogleOAuthCredentials()) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }

        const cacheKey = triageCacheKey(limit, pageToken);
        const now = Date.now();
        const cached = triageCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return res.json({ message: "ok", items: cached.items });
        }

        const page = await listEmailMetasPage(limit, pageToken);
        const emails = page.items;

        const items: TriageItem[] = emails.map((email) => {
            const triage = triageEmailRules({
                subject: email.subject,
                from: email.from,
                snippet: email.snippet,
                date: email.date,
            });
            saveMessageMeta(email);
            saveTriageResult(email.id, triage);

            const override = getOverride(email.id);
            if (override) {
                return { email, triage, override };
            }
            return { email, triage };
        });

        triageCache.set(cacheKey, {
            expiresAt: now + TRIAGE_CACHE_TTL_MS,
            items,
        });

        res.json({ message: "ok", items });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return sendError(res, 401, "UNAUTHORIZED", AUTH_ERROR);
        }
        sendError(res, 500, "INTERNAL_ERROR", err?.message ?? "Triage failed");
    }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
        return sendError(res, 400, "BAD_REQUEST", "Invalid JSON body");
    }
    return next(err);
});

export function startServer() {
    return app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
