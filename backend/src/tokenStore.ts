import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Credentials } from "google-auth-library";

export type GoogleTokens = Credentials;

const tokenPath = path.join(process.cwd(), "data", "token.json");
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;

type EncryptedTokenEnvelope = {
    v: 1;
    alg: "aes-256-gcm";
    iv: string;
    tag: string;
    data: string;
};

function deriveAesKey(secret: string): Buffer {
    return crypto.createHash("sha256").update(secret).digest();
}

function encryptTokenPayload(payload: string): EncryptedTokenEnvelope {
    if (!TOKEN_ENCRYPTION_KEY) {
        throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveAesKey(TOKEN_ENCRYPTION_KEY), iv);
    const encrypted = Buffer.concat([cipher.update(payload, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        v: 1,
        alg: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        data: encrypted.toString("base64"),
    };
}

function decryptTokenPayload(envelope: EncryptedTokenEnvelope): string {
    if (!TOKEN_ENCRYPTION_KEY) {
        throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        deriveAesKey(TOKEN_ENCRYPTION_KEY),
        Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
    ]);
    return decrypted.toString("utf-8");
}

function isEncryptedEnvelope(value: unknown): value is EncryptedTokenEnvelope {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<EncryptedTokenEnvelope>;
    return candidate.v === 1 && candidate.alg === "aes-256-gcm" && !!candidate.iv && !!candidate.tag && !!candidate.data;
}

export function tokenFilePresent() {
    return fs.existsSync(tokenPath);
}

export function loadTokens(): GoogleTokens | null {
    try {
        if (!fs.existsSync(tokenPath)) {
            return null;
        }

        const raw = fs.readFileSync(tokenPath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;

        if (isEncryptedEnvelope(parsed)) {
            const decryptedJson = decryptTokenPayload(parsed);
            return JSON.parse(decryptedJson) as GoogleTokens;
        }

        return parsed as GoogleTokens;
    } catch {
        return null;
    }
}

export function saveTokens(tokens: GoogleTokens): void {
    const dataDir = path.dirname(tokenPath);
    fs.mkdirSync(dataDir, { recursive: true });
    const payload = JSON.stringify(tokens, null, 2);

    if (TOKEN_ENCRYPTION_KEY) {
        const encrypted = encryptTokenPayload(payload);
        fs.writeFileSync(tokenPath, JSON.stringify(encrypted, null, 2), "utf-8");
        return;
    }

    fs.writeFileSync(tokenPath, payload, "utf-8");
}

export function clearTokens(): void {
    try {
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
    } catch {
        // Keep logout flow resilient even if token file is already locked or missing.
    }
}
