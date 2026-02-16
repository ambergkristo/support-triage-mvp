import { google } from "googleapis";
import fs from "fs";
import path from "path";

const credentialsPath = path.join(process.cwd(), "credentials.json");
const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

const { client_secret, client_id, redirect_uris } = credentials.web;

export const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
);

export const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function getAuthUrl() {
    return oAuth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });
}

export async function listEmailMetas(maxResults: number = 10) {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const list = await gmail.users.messages.list({
        userId: "me",
        maxResults,
    });

    const ids = list.data.messages ?? [];
    if (ids.length === 0) return [];

    const metas = await Promise.all(
        ids.map(async (m) => {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: m.id!,
                format: "metadata",
                metadataHeaders: ["Subject", "From", "Date"],
            });

            const headers = msg.data.payload?.headers ?? [];
            const getHeader = (name: string) =>
                headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
                    ?.value ?? "";

            return {
                id: msg.data.id ?? "",
                threadId: msg.data.threadId ?? "",
                snippet: msg.data.snippet ?? "",
                subject: getHeader("Subject"),
                from: getHeader("From"),
                date: getHeader("Date"),
            };
        })
    );

    return metas;
}