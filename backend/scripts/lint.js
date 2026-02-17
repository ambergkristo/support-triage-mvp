const fs = require("fs");
const path = require("path");

function listFilesRecursive(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFilesRecursive(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src");
const files = listFilesRecursive(srcDir).filter((filePath) => /\.(ts|js|json|mjs)$/i.test(filePath));

for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    assert(!content.toLowerCase().includes("openai"), `Forbidden 'openai' reference found in ${file}`);
}

console.log("LINT PASS");
