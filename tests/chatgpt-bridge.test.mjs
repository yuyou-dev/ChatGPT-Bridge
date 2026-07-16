import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRegenerationQueue,
  imageDimensions,
  inspectChatGPTSession,
  parseRatio,
  ratioReport,
  saveImagesFromPageAssets,
  slugify,
  validateSavedImages
} from "../plugins/chatgpt-bridge/scripts/chatgpt-bridge.mjs";

test("slugify produces portable names", () => {
  assert.equal(slugify("My Image Run"), "my-image-run");
  assert.equal(slugify("../../outside"), "outside");
});

test("ratio validation reports mismatches", () => {
  assert.equal(parseRatio("3:4"), 0.75);
  assert.equal(ratioReport({ width: 1086, height: 1448 }, "3:4").ok, true);
  assert.equal(ratioReport({ width: 1024, height: 1536 }, "3:4").ok, false);
});

test("PNG dimensions are read from bytes", () => {
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(imageDimensions(png), { format: "png", width: 640, height: 480 });
});

test("validation builds a regeneration queue", () => {
  const saved = [{ file: "one.png", jobId: "one", sha256: "a", dimensions: { width: 1024, height: 1536 }, requestedRatio: "3:4" }];
  const jobs = [{ jobId: "one" }, { jobId: "two", promptPath: "prompts/two.txt" }];
  const validation = validateSavedImages(saved, { expectedCount: 2, requestedRatio: "3:4", jobs });
  const queue = buildRegenerationQueue(saved, validation, { requestedRatio: "3:4", jobs });
  assert.equal(validation.countOk, false);
  assert.deepEqual(validation.missingJobIds, ["two"]);
  assert.equal(queue.some((item) => item.reason === "missing output"), true);
  assert.equal(queue.some((item) => item.reason === "ratio mismatch"), true);
});

test("session inspection recognizes ready, signed-out, and challenge states", async () => {
  const ready = await inspectChatGPTSession(fakeTab("https://chatgpt.com/", { hasComposer: true, controls: "", mainText: "", title: "ChatGPT" }));
  const signedOut = await inspectChatGPTSession(fakeTab("https://chatgpt.com/auth/login", { hasComposer: false, controls: "Log in\nSign up", mainText: "", title: "Log in" }));
  const challenge = await inspectChatGPTSession(fakeTab("https://chatgpt.com/", { hasComposer: false, controls: "", mainText: "Verify you are human", title: "Security check" }));
  assert.equal(ready.status, "ready");
  assert.equal(signedOut.status, "signed_out");
  assert.equal(challenge.status, "challenge");
  assert.equal(challenge.requiresUserAction, true);
});

test("exports cannot escape outDir and manifests are private by default", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-test-"));
  const outDir = path.join(temporary, "output");
  const source = path.join(temporary, "source.png");
  const absolutePromptA = path.join(path.parse(temporary).root, "private", "prompts", "one.txt");
  const absolutePromptB = path.join(path.parse(temporary).root, "other", "prompts", "missing.txt");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.writeUInt32BE(100, 16);
  png.writeUInt32BE(100, 20);
  await writeFile(source, png);

  const imageUrl = ["https://chatgpt.com", "backend-api", "files", "temporary-secret"].join("/");
  const tab = {
    url: async () => "https://chatgpt.com/?conversation=private-test-value",
    capabilities: {
      get: async () => ({
        list: async () => ({ id: "inventory", assets: [{ id: "asset", kind: "image", url: imageUrl }] }),
        bundle: async () => ({ assets: [{ id: "asset", path: source, contentType: "image/png", name: "source.png" }], failures: [] })
      })
    },
    playwright: {
      evaluate: async () => undefined,
      waitForTimeout: async () => undefined
    }
  };

  try {
    const result = await saveImagesFromPageAssets(tab, [{ src: imageUrl, width: 100, height: 100, alt: "result" }], {
      outDir,
      prefix: "../../unsafe-prefix",
      fileNameTemplate: "../../outside",
      prompt: "private prompt",
      requestedRatio: "3:4",
      expectedCount: 2,
      jobs: [
        { jobId: "one", promptPath: absolutePromptA },
        { jobId: "missing", promptPath: absolutePromptB }
      ]
    });
    assert.equal(path.dirname(result.files[0].file), outDir);
    assert.equal(result.files[0].filename, "outside.png");
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.prompt.startsWith("[omitted"), true);
    assert.equal(manifest.promptSha256, "");
    assert.equal(manifest.chatUrl, "https://chatgpt.com/");
    assert.equal(manifest.outDir, ".");
    assert.equal(path.isAbsolute(manifest.files[0].file), false);
    assert.equal(manifest.files[0].sourceUrl.startsWith("[redacted"), true);
    assert.equal(JSON.stringify(manifest).includes(temporary), false);
    assert.equal(JSON.stringify(manifest).includes(absolutePromptA), false);
    assert.equal(JSON.stringify(manifest).includes(absolutePromptB), false);
    assert.equal(path.isAbsolute(manifest.validation.ratioMismatches[0].file), false);
    assert.equal(manifest.regenerationQueue.some((item) => item.promptPath === "missing.txt"), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("exports refuse pre-existing symbolic-link targets", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "chatgpt-bridge-symlink-test-"));
  const outDir = path.join(temporary, "output");
  const source = path.join(temporary, "source.png");
  const victim = path.join(temporary, "victim.txt");
  const imageUrl = ["https://chatgpt.com", "backend-api", "files", "temporary-test-value"].join("/");
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.writeUInt32BE(100, 16);
  png.writeUInt32BE(100, 20);
  await writeFile(source, png);
  await writeFile(victim, "do not overwrite");
  await mkdir(outDir, { recursive: true });
  await symlink(victim, path.join(outDir, "outside.png"));

  const tab = {
    url: async () => "https://chatgpt.com/",
    capabilities: {
      get: async () => ({
        list: async () => ({ id: "inventory", assets: [{ id: "asset", kind: "image", url: imageUrl }] }),
        bundle: async () => ({ assets: [{ id: "asset", path: source, contentType: "image/png", name: "source.png" }], failures: [] })
      })
    },
    playwright: { evaluate: async () => undefined, waitForTimeout: async () => undefined }
  };

  try {
    await assert.rejects(
      saveImagesFromPageAssets(tab, [{ src: imageUrl, width: 100, height: 100, alt: "result" }], {
        outDir,
        fileNameTemplate: "outside"
      }),
      /symbolic link/i
    );
    assert.equal(await readFile(victim, "utf8"), "do not overwrite");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function fakeTab(url, page) {
  return {
    url: async () => url,
    playwright: {
      evaluate: async () => page
    }
  };
}
