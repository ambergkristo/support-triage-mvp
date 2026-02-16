import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getAuthUrl, oAuth2Client, listEmailMetas } from "./gmail";
import { analyzeEmail } from "./ai";
import {
    clearTokens,
    loadTokens,
    saveTokens,
    tokenFilePresent,
    type GoogleTokens,
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

function mergeTokensForPersistence(nextTokens: GoogleTokens): GoogleTokens {
    const persisted = loadTokens();
    const existingRefreshToken =
        nextTokens.refresh_token ??
        oAuth2Client.credentials.refresh_token ??
        persisted?.refresh_token;

    return {
        ...oAuth2Client.credentials,
        ...nextTokens,
        ...(existingRefreshToken
            ? { refresh_token: existingRefreshToken }
            : {}),
    };
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
        const mergedTokens = mergeTokensForPersistence(tokens);
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

app.get("/triage", async (req, res) => {
    try {
        if (!hasGoogleOAuthCredentials()) {
            return res.status(401).json({ error: AUTH_ERROR });
        }

        const rawLimit = req.query.limit as string | undefined;
        const parsedLimit = rawLimit ? Number(rawLimit) : 10;
        const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;

        const emails = await listEmailMetas(limit);

        const items = await Promise.all(
            emails.map(async (e) => ({
                email: e,
                triage: await analyzeEmail({
                    subject: e.subject,
                    from: e.from,
                    snippet: e.snippet,
                }),
            }))
        );

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
