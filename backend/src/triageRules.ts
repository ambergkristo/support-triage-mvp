export type EmailForTriage = {
    from: string;
    subject: string;
    snippet: string;
    date: string;
};

export type TriageResult = {
    priority: "P0" | "P1" | "P2" | "P3";
    category: string;
    summary: string;
    action: string;
    confidence: number;
};

type RuleMatch = {
    keywords: string[];
    result: TriageResult;
};

const RULES: RuleMatch[] = [
    {
        keywords: [
            "verification code",
            "2fa",
            "security alert",
            "suspicious",
            "password reset",
        ],
        result: {
            priority: "P0",
            category: "security",
            summary: "Security-related email. Review immediately.",
            action: "Open and verify account activity.",
            confidence: 0.9,
        },
    },
    {
        keywords: [
            "invoice",
            "receipt",
            "payment failed",
            "subscription canceled",
            "charge",
            "billing",
        ],
        result: {
            priority: "P1",
            category: "billing",
            summary: "Billing-related email needs prompt review.",
            action: "Check billing details and resolve any payment issues.",
            confidence: 0.8,
        },
    },
    {
        keywords: ["job alert", "newsletter", "unsubscribe", "digest", "no-reply"],
        result: {
            priority: "P3",
            category: "low",
            summary: "Low-priority informational or promotional email.",
            action: "Read later, archive, or unsubscribe if not needed.",
            confidence: 0.7,
        },
    },
];

const DEFAULT_TRIAGE: TriageResult = {
    priority: "P2",
    category: "general",
    summary: "General email requiring normal attention.",
    action: "Review and respond as appropriate.",
    confidence: 0.6,
};

export function triageEmailRules(email: EmailForTriage): TriageResult {
    const haystack = `${email.subject} ${email.snippet}`.toLowerCase();

    for (const rule of RULES) {
        if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
            return rule.result;
        }
    }

    return DEFAULT_TRIAGE;
}
