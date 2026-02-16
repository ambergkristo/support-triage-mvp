import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { getAuthUrl, oAuth2Client, listEmailMetas } from "./gmail";
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
        oAuth2Client.setCredentials(tokens);

        const emails = await listEmailMetas(10);

        res.json({ message: "OAuth successful", emails });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "OAuth failed" });
    }
});

app.get("/triage", async (req, res) => {
    const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(50).default(10),
    });

    try {
        const hasOAuthCredentials =
            Object.keys(oAuth2Client.credentials ?? {}).length > 0;
        if (!hasOAuthCredentials) {
            return res.status(401).json({
                error: "OAuth not completed. Authenticate via /auth/google first.",
            });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "OPENAI_API_KEY missing" });
        }

        const { limit } = querySchema.parse(req.query);
        const emails = await listEmailMetas(limit);

        const results = await Promise.all(
            emails.map(async (e) => ({
                id: e.id,
                threadId: e.threadId,
                subject: e.subject,
                from: e.from,
                date: e.date,
                snippet: e.snippet,
                triage: await analyzeEmail({
                    subject: e.subject,
                    from: e.from,
                    snippet: e.snippet,
                }),
            }))
        );

        return res.json({ results });
    } catch (err: any) {
        if (err?.name === "ZodError") {
            return res.status(400).json({ error: "Invalid limit query parameter" });
        }

        if (err?.message === "OPENAI_API_KEY missing") {
            return res.status(500).json({ error: "OPENAI_API_KEY missing" });
        }

        return res.status(500).json({ error: err?.message ?? "Triage failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
