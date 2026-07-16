import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "chatgpt-bridge");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");

const required = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ".agents/plugins/marketplace.json",
  "plugins/chatgpt-bridge/.codex-plugin/plugin.json",
  "plugins/chatgpt-bridge/skills/chatgpt-image-generator/SKILL.md",
  "plugins/chatgpt-bridge/scripts/chatgpt-bridge.mjs"
];

for (const relative of required) {
  await access(path.join(root, relative));
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
const errors = [];

if (manifest.name !== "chatgpt-bridge") errors.push("plugin name must be chatgpt-bridge");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version || "")) {
  errors.push("plugin version must use SemVer");
}
if (manifest.interface?.displayName !== "ChatGPT Bridge") errors.push("displayName must be ChatGPT Bridge");
if (manifest.license !== "MIT") errors.push("plugin license must be MIT");
if (marketplace.name !== "chatgpt-bridge") errors.push("marketplace name must be chatgpt-bridge");
const entry = marketplace.plugins?.find((plugin) => plugin.name === "chatgpt-bridge");
if (!entry) errors.push("marketplace entry is missing");
if (entry?.source?.path !== "./plugins/chatgpt-bridge") errors.push("marketplace source path is invalid");

const publicFiles = await walk(root, new Set([".git", "dist", "node_modules"]));
const forbidden = [
  /\/Users\/[^/\s]+/,
  /\/home\/[^/\s]+/,
  /[A-Za-z]:\\Users\\[^\\\s]+/,
  /gho_[A-Za-z0-9_]+/,
  /github_pat_[A-Za-z0-9_]{16,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /chatgpt\.com\/(?:c|share)\/[A-Za-z0-9-]+/,
  /https:\/\/chatgpt\.com\/backend-api\/files\//,
  /(?:session|auth)[_-]?token\s*[:=]\s*["'][^"']+/i
];
for (const file of publicFiles) {
  if (!/\.(?:md|json|mjs|js|yml|yaml|txt|svg)$/.test(file)) continue;
  const content = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) errors.push(`forbidden public data in ${path.relative(root, file)}: ${pattern}`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ChatGPT Bridge ${manifest.version} (${publicFiles.length} files scanned).`);

async function walk(directory, ignored) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full, ignored));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}
