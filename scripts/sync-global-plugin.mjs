import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "plugins", "chatgpt-bridge");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const target = path.resolve(targetArg ? targetArg.slice("--target=".length) : path.join(os.homedir(), "plugins", "chatgpt-bridge"));

if (path.basename(target) !== "chatgpt-bridge") {
  throw new Error(`Refusing to sync to unexpected target: ${target}`);
}

await stat(source);
await mkdir(path.dirname(target), { recursive: true });
const temporary = path.join(path.dirname(target), `.chatgpt-bridge.sync-${process.pid}`);
const backup = path.join(path.dirname(target), `.chatgpt-bridge.backup-${process.pid}`);
await rm(temporary, { recursive: true, force: true });
await rm(backup, { recursive: true, force: true });
await cp(source, temporary, { recursive: true });

let hadExisting = false;
try {
  await rename(target, backup);
  hadExisting = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

try {
  await rename(temporary, target);
  if (hadExisting) await rm(backup, { recursive: true, force: true });
} catch (error) {
  if (hadExisting) await rename(backup, target);
  throw error;
}

console.log(`Synced ${source} -> ${target}`);
