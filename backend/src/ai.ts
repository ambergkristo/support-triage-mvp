import "dotenv/config";
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing from environment variables");
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeEmail(email: {
    subject: string;
    from: string;
    snippet: string;
}) {
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content:
                    "You are an assistant that classifies emails into categories: job, personal, marketing, spam.",
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

    return response.choices[0].message.content;
}