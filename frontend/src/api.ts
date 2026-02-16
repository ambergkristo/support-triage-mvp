import type { EmailMessage } from "./types";

const API_BASE_URL = "http://localhost:3000";

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchMessages(): Promise<EmailMessage[]> {
  const res = await fetch(`${API_BASE_URL}/gmail/messages`);
  const data = await parseJson<{ messages?: EmailMessage[]; emails?: EmailMessage[] }>(res);
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.emails)) return data.emails;
  return [];
}

export async function triageMessage(message: EmailMessage) {
  const res = await fetch(`${API_BASE_URL}/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return parseJson<{ result?: unknown; results?: unknown }>(res);
}

export function getGoogleAuthUrl() {
  return `${API_BASE_URL}/auth/google`;
}
