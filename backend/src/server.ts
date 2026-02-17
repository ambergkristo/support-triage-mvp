import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getAuthUrl, oAuth2Client, listEmailMetas, listEmailMetasPage, getEmailDetail } from "./gmail";
import { triageEmailRules } from "./triageRules";
import { mergeTokensForPersistence } from "./authTokenPersistence";
import {
    clearTokens,
    loadTokens,
    saveTokens,
    tokenFilePresent,
} from "./tokenStore";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_ERROR = "Not authenticated with Google OAuth";
const TRIAGE_CACHE_TTL_MS = 30_000;

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
};

const triageCache = new Map<string, { expiresAt: number; items: TriageItem[] }>();

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

        res.json({ message: "OAuth successful", emails });
    } catch (err: any) {
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
    res.json({ message: "logged_out" });
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

        const items = emails.map((e) => ({
            email: e,
            triage: triageEmailRules({
                subject: e.subject,
                from: e.from,
                snippet: e.snippet,
                date: e.date,
            }),
        }));
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
