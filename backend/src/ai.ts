import "dotenv/config";
import OpenAI from "openai";
import { z } from "zod";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing from environment variables");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const triageResultSchema = z.object({
    priority: z.enum(["urgent", "normal", "low"]),
    category: z.enum(["work", "personal", "finance", "security", "spam", "other"]),
    action: z.enum(["reply", "read_later", "archive", "ignore"]),
    summary: z.string(),
    draftReply: z.string().nullable(),
});

export type TriageResult = z.infer<typeof triageResultSchema>;

export async function analyzeEmail(email: {
    subject: string;
    from: string;
    snippet: string;
}): Promise<TriageResult> {
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "triage_result",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        priority: { type: "string", enum: ["urgent", "normal", "low"] },
                        category: {
                            type: "string",
                            enum: [
                                "work",
                                "personal",
                                "finance",
                                "security",
                                "spam",
                                "other",
                            ],
                        },
                        action: {
                            type: "string",
                            enum: ["reply", "read_later", "archive", "ignore"],
                        },
                        summary: { type: "string" },
                        draftReply: { type: ["string", "null"] },
                    },
                    required: ["priority", "category", "action", "summary", "draftReply"],
                },
            },
        },
        messages: [
            {
                role: "system",
                content:
                    "You are an email triage assistant. Return valid JSON only and follow the schema exactly. Keep summary concise. draftReply must be null unless action is reply.",
            },
            {
                role: "user",
                content: `Analyze this email:
Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.snippet}`,
            },
        ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
        throw new Error("Model returned an empty response");
    }

    const parsed = JSON.parse(raw);
    return triageResultSchema.parse(parsed);
}
