const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const unauthenticatedMode = String(process.env.SMOKE_EXPECT_UNAUTH ?? "false").toLowerCase() === "true";
const quotaText = "You exceeded your current quota";

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}

function pass(message) {
    console.log(`PASS: ${message}`);
}

async function request(pathname) {
    const response = await fetch(`${baseUrl}${pathname}`);
    const body = await response.text();
    return { status: response.status, body };
}

function hasAuthStatusShape(payload) {
    return (
        typeof payload === "object" &&
        payload !== null &&
        "authenticated" in payload &&
        "hasRefreshToken" in payload &&
        "tokenFilePresent" in payload
    );
}

try {
    console.log(`Smoke base URL: ${baseUrl}`);
    console.log(`Smoke mode: ${unauthenticatedMode ? "unauthenticated" : "auto"}`);

    const health = await request("/health");
    if (health.status !== 200) {
        fail(`/health expected 200, got ${health.status}`);
    }
    pass("/health returned 200");

    const status = await request("/auth/status");
    if (status.status !== 200) {
        fail(`/auth/status expected 200, got ${status.status}`);
    }

    let authPayload;
    try {
        authPayload = JSON.parse(status.body);
    } catch {
        fail("/auth/status did not return valid JSON");
    }

    if (!hasAuthStatusShape(authPayload)) {
        fail("/auth/status JSON missing expected keys");
    }
    pass("/auth/status returned expected keys");

    const triage = await request("/triage?limit=1");
    if (!(triage.status === 401 || triage.status === 200)) {
        fail(`/triage?limit=1 expected 401 or 200, got ${triage.status}`);
    }

    if (unauthenticatedMode && triage.status !== 401) {
        fail("/triage expected 401 in unauthenticated mode");
    }

    if (triage.body.toLowerCase().includes(quotaText.toLowerCase())) {
        fail("triage response contains OpenAI quota text");
    }
    pass(`/triage returned ${triage.status} and no quota text`);

    console.log("SMOKE PASS");
} catch (err) {
    fail(err instanceof Error ? err.message : String(err));
}
