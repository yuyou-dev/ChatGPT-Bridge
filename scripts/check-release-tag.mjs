import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "plugins", "chatgpt-bridge", ".codex-plugin", "plugin.json"), "utf8"));
const expected = `v${manifest.version.split("+")[0]}`;
const actual = process.argv[2] || process.env.GITHUB_REF_NAME || "";

if (actual !== expected) {
  console.error(`Release tag ${actual || "<missing>"} does not match plugin version ${expected}.`);
  process.exit(1);
}

console.log(`Release tag matches plugin version: ${expected}`);
