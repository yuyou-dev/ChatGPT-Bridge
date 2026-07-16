import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "chatgpt-bridge");
const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const version = manifest.version.split("+")[0];
const dist = path.join(root, "dist");
const stage = path.join(dist, ".stage");

await rm(dist, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const pluginStage = path.join(stage, "chatgpt-bridge");
await cp(pluginRoot, pluginStage, { recursive: true });
zipDirectory(pluginStage, path.join(dist, `chatgpt-bridge-plugin-v${version}.zip`));

const marketplaceStage = path.join(stage, `ChatGPT-Bridge-v${version}`);
await mkdir(marketplaceStage, { recursive: true });
for (const relative of [".agents", "plugins", "README.md", "README.zh-CN.md", "LICENSE", "CHANGELOG.md"]) {
  await cp(path.join(root, relative), path.join(marketplaceStage, relative), { recursive: true });
}
zipDirectory(marketplaceStage, path.join(dist, `chatgpt-bridge-marketplace-v${version}.zip`));

await rm(stage, { recursive: true, force: true });
console.log(`Created release packages in ${dist}`);

function zipDirectory(directory, output) {
  const result = spawnSync("zip", ["-q", "-r", output, path.basename(directory)], {
    cwd: path.dirname(directory),
    stdio: "inherit"
  });
  if (result.status !== 0) throw new Error(`zip failed for ${directory}`);
}
