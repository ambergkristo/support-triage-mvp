import { ChildProcess, spawn, spawnSync } from "child_process";
import path from "path";

type EnvOverrides = Record<string, string | undefined>;

const backendDir = path.join(process.cwd(), "backend");
const triageUrl = "http://localhost:3000/triage";

function startServer(envOverrides: EnvOverrides): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({
            ...process.env,
            ...envOverrides,
        })) {
            if (typeof value === "string") {
                env[key] = value;
            }
        }

        const child = spawn(
            "cmd.exe",
            ["/c", "npm run dev"],
            {
                cwd: backendDir,
                env,
                stdio: ["ignore", "pipe", "pipe"],
            }
        );

        const timeout = setTimeout(() => {
            stopServer(child);
            reject(new Error("Timed out waiting for backend startup."));
        }, 20000);

        const onData = (data: Buffer) => {
            const text = data.toString();
            if (text.includes("Server running on http://localhost:3000")) {
                clearTimeout(timeout);
                resolve(child);
            }
        };

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.on("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`Backend exited before ready (code ${code ?? "null"}).`));
        });
    });
}

function stopServer(child: ChildProcess) {
    if (!child.pid || child.exitCode !== null) return;
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
    });
}

async function getTriageResponse() {
    const response = await fetch(triageUrl);
    const body = await response.json();
    return { status: response.status, body };
}

async function run() {
    let server: ChildProcess | undefined;

    try {
        server = await startServer({ OPENAI_API_KEY: "smoke-test-key" });
        const unauthorized = await getTriageResponse();
        if (
            unauthorized.status !== 401 ||
            typeof unauthorized.body?.error !== "string"
        ) {
            throw new Error(
                `Expected 401 JSON for missing OAuth credentials, got ${unauthorized.status} ${JSON.stringify(unauthorized.body)}`
            );
        }
        console.log("PASS: GET /triage without OAuth credentials returns 401 JSON.");
    } finally {
        if (server) stopServer(server);
    }

    try {
        server = await startServer({ OPENAI_API_KEY: "" });
        const missingKey = await getTriageResponse();
        if (
            missingKey.status !== 500 ||
            typeof missingKey.body?.error !== "string" ||
            !missingKey.body.error.includes("OPENAI_API_KEY")
        ) {
            throw new Error(
                `Expected 500 JSON for missing OPENAI_API_KEY, got ${missingKey.status} ${JSON.stringify(missingKey.body)}`
            );
        }
        console.log("PASS: Missing OPENAI_API_KEY returns 500 JSON with clear message.");
    } finally {
        if (server) stopServer(server);
    }
}

run().catch((err) => {
    console.error("SMOKE FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
});
