import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z, ZodError } from "zod";
import {
    getAuthUrl,
    oAuth2Client,
    listEmailMetas,
    getEmail,
    hasOAuthTokens,
    setOAuthTokens,
} from "./gmail";
import { analyzeEmail } from "./ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);

app.get("/", (req, res) => {
    res.json({ status: "API running" });
});

app.get("/auth/google", (req, res) => {
    res.redirect(getAuthUrl());
});

app.get("/oauth2callback", async (req, res) => {
    try {
        const code = req.query.code as string | undefined;
        if (!code) return res.status(400).json({ error: "Missing code" });

        const { tokens } = await oAuth2Client.getToken(code);
        setOAuthTokens(tokens);

        const emails = await listEmailMetas(10);

        res.json({ message: "OAuth successful", emails });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "OAuth failed" });
    }
});

app.get("/gmail/messages", async (req, res) => {
    if (!hasOAuthTokens()) {
        return res.status(401).json({
            error: "Unauthorized",
            details: "Google OAuth tokens missing. Complete /auth/google first.",
        });
    }

    const limitParam = req.query.limit as string | undefined;
    const parsed = Number(limitParam ?? 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 10;

    try {
        const messages = await listEmailMetas(limit);
        return res.status(200).json({ messages });
    } catch (err: any) {
        return res.status(500).json({
            error: "Failed to fetch Gmail messages",
            details: err?.message ?? "Unknown error",
        });
    }
});

app.get("/gmail/messages/:id", async (req, res) => {
    if (!hasOAuthTokens()) {
        return res.status(401).json({
            error: "Unauthorized",
            details: "Google OAuth tokens missing. Complete /auth/google first.",
        });
    }

    try {
        const message = await getEmail(req.params.id);
        return res.status(200).json({ message });
    } catch (err: any) {
        if (err?.code === 404) {
            return res.status(404).json({
                error: "Not Found",
                details: "No Gmail message found for the provided id.",
            });
        }

        if (err?.code === 401 || err?.code === 403) {
            return res.status(401).json({
                error: "Unauthorized",
                details: "Gmail access denied. Re-authenticate with /auth/google.",
            });
        }

        return res.status(500).json({
            error: "Failed to fetch Gmail message",
            details: err?.message ?? "Unknown error",
        });
    }
});

app.post("/triage", async (req, res) => {
    const triageInputSchema = z.union([
        z
            .object({
                messageId: z.string().min(1),
            })
            .strict(),
        z
            .object({
                subject: z.string().min(1),
                from: z.string().min(1),
                snippet: z.string().min(1),
            })
            .strict(),
    ]);

    try {
        const payload = triageInputSchema.parse(req.body);

        if ("messageId" in payload) {
            if (!hasOAuthTokens()) {
                return res.status(401).json({
                    error: "Unauthorized",
                    details: "Google OAuth token missing. Complete /auth/google first.",
                });
            }

            try {
                const email = await getEmail(payload.messageId);
                const analysis = await analyzeEmail({
                    subject: email.headers.Subject ?? "",
                    from: email.headers.From ?? "",
                    snippet: email.snippet,
                });

                return res.status(200).json({ email, analysis });
            } catch (err: any) {
                if (err?.code === 404) {
                    return res.status(404).json({
                        error: "Not Found",
                        details: "No Gmail message found for the provided messageId.",
                    });
                }
                if (err?.code === 401 || err?.code === 403) {
                    return res.status(401).json({
                        error: "Unauthorized",
                        details: "Gmail access denied. Re-authenticate with /auth/google.",
                    });
                }
                throw err;
            }
        }

        const analysis = await analyzeEmail(payload);
        return res.status(200).json({ analysis });
    } catch (err: unknown) {
        if (err instanceof ZodError) {
            return res.status(400).json({
                error: "Invalid request body",
                details: err.issues,
            });
        }

        if (err instanceof SyntaxError) {
            return res.status(502).json({
                error: "Bad AI response",
                details: "Model returned invalid JSON.",
            });
        }

        if (err instanceof Error) {
            return res.status(500).json({
                error: "Triage failed",
                details: err.message,
            });
        }

        return res.status(500).json({ error: "Triage failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
