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

type CategoryProfile = {
    priority: "P0" | "P1" | "P2" | "P3";
    category: string;
    summary: string;
    action: string;
};

type ScoreKey =
    | "security"
    | "billing"
    | "operations"
    | "jobs"
    | "learning"
    | "low"
    | "general";

type DomainRule = {
    domains: string[];
    scoreKey: ScoreKey;
    weight: number;
};

type KeywordRule = {
    keywords: string[];
    scoreKey: ScoreKey;
    weight: number;
};

const CATEGORY_PROFILES: Record<ScoreKey, CategoryProfile> = {
    security: {
        priority: "P0",
        category: "security",
        summary: "Security-related email. Review immediately.",
        action: "Open and verify account activity.",
    },
    billing: {
        priority: "P1",
        category: "billing",
        summary: "Billing-related email needs prompt review.",
        action: "Check charges, invoice, and payment status.",
    },
    operations: {
        priority: "P1",
        category: "operations",
        summary: "Operational alert likely requiring quick action.",
        action: "Review logs or system status and resolve failures.",
    },
    jobs: {
        priority: "P2",
        category: "career",
        summary: "Career-related email requiring normal follow-up.",
        action: "Review opportunity details and respond if relevant.",
    },
    learning: {
        priority: "P2",
        category: "learning",
        summary: "Learning content or course update.",
        action: "Schedule review when available.",
    },
    low: {
        priority: "P3",
        category: "low",
        summary: "Low-priority informational or promotional email.",
        action: "Archive, unsubscribe, or read later.",
    },
    general: {
        priority: "P2",
        category: "general",
        summary: "General email requiring normal attention.",
        action: "Review and respond as appropriate.",
    },
};

const DOMAIN_RULES: DomainRule[] = [
    {
        domains: ["github.com"],
        scoreKey: "operations",
        weight: 0.45,
    },
    {
        domains: ["linkedin.com", "cvkeskus.ee", "cv.ee"],
        scoreKey: "jobs",
        weight: 0.4,
    },
    {
        domains: ["coursera.org", "udemy.com"],
        scoreKey: "learning",
        weight: 0.35,
    },
];

const KEYWORD_RULES: KeywordRule[] = [
    {
        keywords: ["verification code", "verify", "2fa", "security alert", "suspicious", "password reset"],
        scoreKey: "security",
        weight: 0.5,
    },
    {
        keywords: ["invoice", "receipt", "payment failed", "subscription canceled", "charge", "billing"],
        scoreKey: "billing",
        weight: 0.45,
    },
    {
        keywords: ["ci failed", "build failed", "incident", "outage", "failing checks"],
        scoreKey: "operations",
        weight: 0.45,
    },
    {
        keywords: ["job alert", "interview", "application", "bonus", "offer"],
        scoreKey: "jobs",
        weight: 0.35,
    },
    {
        keywords: ["course", "learning path", "assignment due", "certificate"],
        scoreKey: "learning",
        weight: 0.3,
    },
    {
        keywords: ["newsletter", "unsubscribe", "digest", "no-reply"],
        scoreKey: "low",
        weight: 0.35,
    },
];

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function extractDomain(from: string): string {
    const lower = from.toLowerCase();
    const emailMatch = lower.match(/<([^>]+)>/)?.[1] ?? lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0];
    if (!emailMatch) return "";
    return emailMatch.split("@")[1] ?? "";
}

function applyRecencyBoost(date: string, currentScore: number, scoreKey: ScoreKey): number {
    const parsedDate = Date.parse(date);
    if (Number.isNaN(parsedDate)) return currentScore;

    const ageHours = (Date.now() - parsedDate) / (1000 * 60 * 60);
    if (ageHours > 48 || ageHours < 0) return currentScore;

    if (scoreKey === "security" || scoreKey === "billing" || scoreKey === "operations") {
        return currentScore + 0.12;
    }

    if (scoreKey === "jobs" || scoreKey === "learning") {
        return currentScore + 0.08;
    }

    return currentScore + 0.04;
}

export function triageEmailRules(email: EmailForTriage): TriageResult {
    const text = `${email.subject} ${email.snippet}`.toLowerCase();
    const domain = extractDomain(email.from);
    const scores: Record<ScoreKey, number> = {
        security: 0,
        billing: 0,
        operations: 0,
        jobs: 0,
        learning: 0,
        low: 0,
        general: 0.25,
    };

    let signalCount = 0;

    for (const rule of DOMAIN_RULES) {
        if (rule.domains.some((knownDomain) => domain.endsWith(knownDomain))) {
            scores[rule.scoreKey] += rule.weight;
            signalCount += 1;
        }
    }

    for (const rule of KEYWORD_RULES) {
        const matches = rule.keywords.filter((keyword) => text.includes(keyword));
        if (matches.length > 0) {
            scores[rule.scoreKey] += rule.weight + Math.min(0.15, (matches.length - 1) * 0.05);
            signalCount += matches.length;
        }
    }

    const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<[ScoreKey, number]>;
    const topKey = sortedScores[0][0];
    const secondScore = sortedScores[1][1];
    const topScoreWithRecency = applyRecencyBoost(email.date, sortedScores[0][1], topKey);

    const confidence = clamp(
        0.55 + Math.min(signalCount, 5) * 0.05 + Math.max(0, topScoreWithRecency - secondScore) * 0.25,
        0.6,
        0.98
    );

    const profile = CATEGORY_PROFILES[topKey];
    return {
        priority: profile.priority,
        category: profile.category,
        summary: profile.summary,
        action: profile.action,
        confidence: Number(confidence.toFixed(2)),
    };
}
