import "dotenv/config";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import type { Credentials } from "google-auth-library";

export const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const tokenFilePath = path.join(process.cwd(), ".data", "token.json");

const clientId = requireEnv("GOOGLE_CLIENT_ID");
const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

export const oAuth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
);

loadTokensOnStartup();

export function getAuthUrl() {
    return oAuth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });
}

export function hasOAuthTokens() {
    const { access_token, refresh_token } = oAuth2Client.credentials;
    return Boolean(access_token || refresh_token);
}

export function setOAuthTokens(tokens: Credentials) {
    oAuth2Client.setCredentials(tokens);
    saveTokens(tokens);
}

export async function listEmailMetas(limit: number = 10) {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: limit,
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
            const getHeader = createHeaderGetter(msg.data.payload?.headers ?? []);

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

function createHeaderGetter(
    headers: Array<{ name?: string | null; value?: string | null }>
) {
    return (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
        "";
}

export async function getEmail(messageId: string) {
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const msg = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
    });

    const headers = msg.data.payload?.headers ?? [];
    const plainTextBody = extractPlainTextBody(msg.data.payload);

    return {
        id: msg.data.id ?? messageId,
        threadId: msg.data.threadId ?? "",
        snippet: msg.data.snippet ?? "",
        headers: Object.fromEntries(
            headers
                .filter((h): h is { name: string; value: string } =>
                    Boolean(h.name && h.value)
                )
                .map((h) => [h.name, h.value])
        ),
        plainTextBody,
    };
}

function requireEnv(name: string) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function loadTokensOnStartup() {
    if (!fs.existsSync(tokenFilePath)) {
        return;
    }

    const raw = fs.readFileSync(tokenFilePath, "utf-8");
    const tokens = JSON.parse(raw) as Credentials;
    oAuth2Client.setCredentials(tokens);
}

function saveTokens(tokens: Credentials) {
    fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true });
    fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2), "utf-8");
}

function extractPlainTextBody(
    payload: { body?: { data?: string | null } | null; parts?: any[] | null } | null | undefined
): string | undefined {
    if (!payload) return undefined;

    if (payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    const data = findTextPlainPart(payload.parts ?? []);
    if (!data) return undefined;

    return decodeBase64Url(data);
}

function findTextPlainPart(parts: any[]): string | undefined {
    for (const part of parts) {
        if (part?.mimeType === "text/plain" && part?.body?.data) {
            return part.body.data;
        }
        if (part?.parts?.length) {
            const nested = findTextPlainPart(part.parts);
            if (nested) return nested;
        }
    }

    return undefined;
}

function decodeBase64Url(data: string) {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf-8"
    );
}
