import "dotenv/config";
import OpenAI from "openai";
import { z } from "zod";

const TRIAGE_CATEGORIES = [
    "vip",
    "hr",
    "job",
    "billing",
    "support",
    "marketing",
    "social",
    "security",
    "personal",
    "unknown",
] as const;

const TRIAGE_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

const triageSchema = z.object({
    category: z.enum(TRIAGE_CATEGORIES),
    priority: z.enum(TRIAGE_PRIORITIES),
    rationale: z.string(),
    suggested_action: z.string(),
    confidence: z.number().min(0).max(1),
});

export type EmailTriage = z.infer<typeof triageSchema>;

let openai: OpenAI | null = null;

function getOpenAIClient() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(
            "OPENAI_API_KEY missing. Add OPENAI_API_KEY to backend/.env."
        );
    }

    if (!openai) {
        openai = new OpenAI({ apiKey });
    }

    return openai;
}

const fallbackTriage: EmailTriage = {
    category: "unknown",
    priority: "p3",
    rationale: "Model output was invalid after retry.",
    suggested_action: "manual_review",
    confidence: 0,
};

export async function analyzeEmail(email: {
    subject: string;
    from: string;
    snippet: string;
}): Promise<EmailTriage> {
    const client = getOpenAIClient();

    for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "email_triage",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            category: { type: "string", enum: [...TRIAGE_CATEGORIES] },
                            priority: { type: "string", enum: [...TRIAGE_PRIORITIES] },
                            rationale: { type: "string" },
                            suggested_action: { type: "string" },
                            confidence: { type: "number", minimum: 0, maximum: 1 },
                        },
                        required: [
                            "category",
                            "priority",
                            "rationale",
                            "suggested_action",
                            "confidence",
                        ],
                    },
                },
            },
            messages: [
                {
                    role: "system",
                    content:
                        "Classify the email into one category and priority. Return JSON only that matches the schema exactly.",
                },
                {
                    role: "user",
                    content: `Classify this email:
Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.snippet}`,
                },
            ],
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            if (attempt === 2) return fallbackTriage;
            continue;
        }

        try {
            const parsed = JSON.parse(content);
            return triageSchema.parse(parsed);
        } catch {
            if (attempt === 2) {
                return fallbackTriage;
            }
        }
    }

    return fallbackTriage;
}
