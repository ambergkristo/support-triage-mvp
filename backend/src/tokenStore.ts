import fs from "fs";
import path from "path";
import type { Credentials } from "google-auth-library";

export type GoogleTokens = Credentials;

const tokenPath = path.join(process.cwd(), "data", "token.json");

export function tokenFilePresent() {
    return fs.existsSync(tokenPath);
}

export function loadTokens(): GoogleTokens | null {
    try {
        if (!fs.existsSync(tokenPath)) {
            return null;
        }

        const raw = fs.readFileSync(tokenPath, "utf-8");
        const parsed = JSON.parse(raw) as GoogleTokens;
        return parsed;
    } catch {
        return null;
    }
}

export function saveTokens(tokens: GoogleTokens): void {
    const dataDir = path.dirname(tokenPath);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
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
