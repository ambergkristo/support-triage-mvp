import crypto from "crypto";
import type { Credentials } from "google-auth-library";

type EncryptedEnvelope = {
    v: 1;
    alg: "aes-256-gcm";
    iv: string;
    tag: string;
    data: string;
};

function deriveAesKey(secret: string): Buffer {
    return crypto.createHash("sha256").update(secret).digest();
}

function encryptionKey(): string {
    return process.env.TOKEN_ENCRYPTION_KEY || "local-dev-token-encryption-key";
}

export function encryptOAuthTokens(tokens: Credentials): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", deriveAesKey(encryptionKey()), iv);
    const payload = JSON.stringify(tokens);
    const encrypted = Buffer.concat([cipher.update(payload, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope: EncryptedEnvelope = {
        v: 1,
        alg: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        data: encrypted.toString("base64"),
    };
    return JSON.stringify(envelope);
}

export function decryptOAuthTokens(encryptedPayload: string): Credentials {
    const parsed = JSON.parse(encryptedPayload) as EncryptedEnvelope;
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        deriveAesKey(encryptionKey()),
        Buffer.from(parsed.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parsed.data, "base64")),
        decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf-8")) as Credentials;
}
