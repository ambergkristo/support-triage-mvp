import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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

app.post("/triage", async (req, res) => {
    try {
        const emails = await listEmailMetas(10);

        const results = await Promise.all(
            emails.map(async (e) => ({
                ...e,
                analysis: await analyzeEmail({
                    subject: e.subject,
                    from: e.from,
                    snippet: e.snippet,
                }),
            }))
        );

        res.json({ results });
    } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Triage failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
