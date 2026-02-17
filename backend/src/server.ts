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
        if (!code) return res.status(400).json({ error: "Missing code" });

        const { tokens } = await oAuth2Client.getToken(code);
        const mergedTokens = mergeTokensForPersistence({
            nextTokens: tokens,
            currentTokens: oAuth2Client.credentials,
            persistedTokens: loadTokens(),
        });
        oAuth2Client.setCredentials(mergedTokens);
        saveTokens(mergedTokens);

        const emails = await listEmailMetas(10);

        res.json({ message: "OAuth successful", emails });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "OAuth failed" });
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
    res.json({ message: "logged_out" });
});

app.get("/gmail/messages", async (req, res) => {
    try {
        if (!hasGoogleOAuthCredentials()) {
            return res.status(401).json({ error: AUTH_ERROR });
        }

        const rawLimit = req.query.limit as string | undefined;
        const parsedLimit = rawLimit ? Number(rawLimit) : 10;
        const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100 ? parsedLimit : 10;
        const pageToken = (req.query.pageToken as string | undefined) || undefined;

        const page = await listEmailMetasPage(limit, pageToken);
        res.json({
            message: "ok",
            items: page.items,
            nextPageToken: page.nextPageToken,
        });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return res.status(401).json({ error: AUTH_ERROR });
        }
        res.status(500).json({ error: err?.message ?? "Failed to list messages" });
    }
});

app.get("/gmail/messages/:id", async (req, res) => {
    try {
        if (!hasGoogleOAuthCredentials()) {
            return res.status(401).json({ error: AUTH_ERROR });
        }

        const id = req.params.id;
        if (!id) {
            return res.status(400).json({ error: "Missing message id" });
        }

        const item = await getEmailDetail(id);
        res.json({ message: "ok", item });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return res.status(401).json({ error: AUTH_ERROR });
        }
        if (err?.status === 404 || err?.code === 404) {
            return res.status(404).json({ error: "Message not found" });
        }
        res.status(500).json({ error: err?.message ?? "Failed to fetch message detail" });
    }
});

app.get("/triage", async (req, res) => {
    try {
        if (!hasGoogleOAuthCredentials()) {
            return res.status(401).json({ error: AUTH_ERROR });
        }

        const rawLimit = req.query.limit as string | undefined;
        const parsedLimit = rawLimit ? Number(rawLimit) : 10;
        const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;

        const emails = await listEmailMetas(limit);

        const items = emails.map((e) => ({
            email: e,
            triage: triageEmailRules({
                subject: e.subject,
                from: e.from,
                snippet: e.snippet,
                date: e.date,
            }),
        }));

        res.json({ message: "ok", items });
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 401) {
            return res.status(401).json({ error: AUTH_ERROR });
        }
        res.status(500).json({ error: err?.message ?? "Triage failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
