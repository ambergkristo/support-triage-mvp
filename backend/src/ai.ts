import "dotenv/config";
import OpenAI from "openai";
import { z } from "zod";

const triageSchema = z
    .object({
        priority: z.enum(["P0", "P1", "P2", "P3"]),
        category: z.string(),
        summary: z.string(),
        action: z.string(),
        confidence: z.number().min(0).max(1),
    })
    .strict();

type EmailTriage = z.infer<typeof triageSchema>;

const FALLBACK_TRIAGE: EmailTriage = {
    priority: "P2",
    category: "unknown",
    summary: "LLM parsing failed",
    action: "manual_review",
    confidence: 0,
};

async function requestTriage(email: {
    subject: string;
    from: string;
    snippet: string;
}): Promise<EmailTriage> {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is missing from environment variables");
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content:
                    "Return strict JSON only with keys priority, category, summary, action, confidence. priority must be one of P0,P1,P2,P3. confidence must be a number between 0 and 1.",
            },
            {
                role: "user",
                content: `Triage this email:
Subject: ${email.subject}
From: ${email.from}
Snippet: ${email.snippet}`,
            },
        ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error("Empty OpenAI response");
    }

    const parsed = JSON.parse(content);
    return triageSchema.parse(parsed);
}

export async function analyzeEmail(email: {
    subject: string;
    from: string;
    snippet: string;
}): Promise<EmailTriage> {
    try {
        return await requestTriage(email);
    } catch (firstError) {
        try {
            return await requestTriage(email);
        } catch (secondError) {
            if (
                firstError instanceof SyntaxError ||
                secondError instanceof SyntaxError ||
                firstError instanceof z.ZodError ||
                secondError instanceof z.ZodError
            ) {
                return FALLBACK_TRIAGE;
            }
            throw secondError;
        }
    }
}
