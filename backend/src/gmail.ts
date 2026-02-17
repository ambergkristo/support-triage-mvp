import { google } from "googleapis";
import fs from "fs";
import path from "path";
import type { gmail_v1 } from "googleapis";
import type { Credentials } from "google-auth-library";

type WebCredentials = {
    client_secret: string;
    client_id: string;
    redirect_uris: string[];
};

function loadWebCredentials(): WebCredentials {
    const realPath = path.join(process.cwd(), "credentials.json");
    const examplePath = path.join(process.cwd(), "credentials.example.json");
    const filePath = fs.existsSync(realPath) ? realPath : examplePath;
    if (!fs.existsSync(filePath)) {
        throw new Error("Missing OAuth credentials file (credentials.json)");
    }
    const credentials = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return credentials.web as WebCredentials;
}

function createOAuth2Client() {
    const { client_secret, client_id, redirect_uris } = loadWebCredentials();
    return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

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
    const oAuth2Client = createOAuth2Client();
    return oAuth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });
}

export async function exchangeCodeForTokens(code: string): Promise<Credentials> {
    const oAuth2Client = createOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    return tokens;
}

export async function getGoogleUserEmail(tokens: Credentials): Promise<string> {
    const oAuth2Client = createOAuth2Client();
    oAuth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oAuth2Client });
    const profile = await oauth2.userinfo.get();
    return profile.data.email ?? "";
}

function createGmailClient(tokens: Credentials) {
    const oAuth2Client = createOAuth2Client();
    oAuth2Client.setCredentials(tokens);
    return google.gmail({ version: "v1", auth: oAuth2Client });
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

    const parts = payload.parts ?? [];
    for (const part of parts) {
        if (part.mimeType !== "text/plain") {
            continue;
        }
        const nested = extractPlainTextFromPayload(part);
        if (nested.trim().length > 0) {
            return nested;
        }
    }

    for (const part of parts) {
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

export async function listEmailMetasPage(
    tokens: Credentials,
    maxResults: number = 10,
    pageToken?: string
): Promise<EmailMetaPage> {
    const gmail = createGmailClient(tokens);

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
    throw new Error(`Deprecated call listEmailMetas(${maxResults})`);
}

export async function listEmailMetasForUser(tokens: Credentials, maxResults: number = 10): Promise<EmailMeta[]> {
    const page = await listEmailMetasPage(tokens, maxResults);
    return page.items;
}

export async function getEmailDetail(tokens: Credentials, id: string): Promise<EmailDetail> {
    const gmail = createGmailClient(tokens);
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
