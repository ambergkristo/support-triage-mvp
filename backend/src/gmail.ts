import { google } from "googleapis";
import fs from "fs";
import path from "path";
import type { gmail_v1 } from "googleapis";

const credentialsPath = path.join(process.cwd(), "credentials.json");
const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

const { client_secret, client_id, redirect_uris } = credentials.web;

export const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
);

export const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export type EmailMeta = {
    id: string;
    threadId: string;
    snippet: string;
    subject: string;
    from: string;
    date: string;
};

export type EmailMetaPage = {
    items: EmailMeta[];
    nextPageToken: string | null;
};

export type EmailDetail = EmailMeta & {
    plainText: string;
    payload: gmail_v1.Schema$MessagePart | undefined;
};

export function getAuthUrl() {
    return oAuth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });
}

function getHeaderValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(input: string): string {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf-8");
}

export function extractPlainTextFromPayload(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return "";

    if (payload.mimeType === "text/plain" && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    for (const part of payload.parts ?? []) {
        const nested = extractPlainTextFromPayload(part);
        if (nested.trim().length > 0) {
            return nested;
        }
    }

    if (payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    return "";
}

export async function listEmailMetasPage(maxResults: number = 10, pageToken?: string): Promise<EmailMetaPage> {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const list = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        pageToken: pageToken || undefined,
    });

    const ids = list.data.messages ?? [];
    if (ids.length === 0) {
        return { items: [], nextPageToken: list.data.nextPageToken ?? null };
    }

    const items = await Promise.all(
        ids.map(async (m) => {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: m.id!,
                format: "metadata",
                metadataHeaders: ["Subject", "From", "Date"],
            });

            const headers = msg.data.payload?.headers ?? [];

            return {
                id: msg.data.id ?? "",
                threadId: msg.data.threadId ?? "",
                snippet: msg.data.snippet ?? "",
                subject: getHeaderValue(headers, "Subject"),
                from: getHeaderValue(headers, "From"),
                date: getHeaderValue(headers, "Date"),
            };
        })
    );

    return {
        items,
        nextPageToken: list.data.nextPageToken ?? null,
    };
}

export async function listEmailMetas(maxResults: number = 10): Promise<EmailMeta[]> {
    const page = await listEmailMetasPage(maxResults);
    return page.items;
}

export async function getEmailDetail(id: string): Promise<EmailDetail> {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
    });

    const headers = msg.data.payload?.headers;
    return {
        id: msg.data.id ?? id,
        threadId: msg.data.threadId ?? "",
        snippet: msg.data.snippet ?? "",
        subject: getHeaderValue(headers, "Subject"),
        from: getHeaderValue(headers, "From"),
        date: getHeaderValue(headers, "Date"),
        plainText: extractPlainTextFromPayload(msg.data.payload),
        payload: msg.data.payload,
    };
}
