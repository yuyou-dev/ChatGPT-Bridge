import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyChatGPTConversationMode } from "../plugins/chatgpt-bridge/scripts/chatgpt-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(root, "benchmarks", "temporary-chat-routing.json"), "utf8"));
const results = fixture.cases.map((item) => {
  const decision = classifyChatGPTConversationMode(item.task);
  return {
    id: item.id,
    expectedAction: item.expectedAction,
    actualAction: decision.action,
    mode: decision.mode,
    pass: decision.action === item.expectedAction
      && (!item.expectedMode || decision.mode === item.expectedMode),
    reasonCodes: decision.reasonCodes
  };
});
const passed = results.filter((item) => item.pass).length;
const report = {
  schemaVersion: fixture.schemaVersion,
  total: results.length,
  passed,
  failed: results.length - passed,
  accuracy: results.length ? passed / results.length : 0,
  results
};
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
