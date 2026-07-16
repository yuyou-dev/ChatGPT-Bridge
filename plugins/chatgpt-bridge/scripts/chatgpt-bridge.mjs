import { lstat, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export function slugify(value, fallback = "chatgpt-bridge-run") {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

export function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  if (buffer.length >= 24 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return {
      format: "png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (buffer.length >= 10 && buffer.subarray(0, 3).toString("hex") === "ffd8ff") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        return {
          format: "jpeg",
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }
      offset += 2 + length;
    }
  }

  if (buffer.length >= 30 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        format: "webp",
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return {
        format: "webp",
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      return {
        format: "webp",
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      };
    }
  }

  return {
    format: "unknown",
    width: null,
    height: null
  };
}

export function checksumSha256(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }
  return createHash("sha256").update(buffer).digest("hex");
}

export function parseRatio(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;

  const text = String(value).trim().toLowerCase();
  const pair = text.match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
  if (pair) {
    const width = Number(pair[1]);
    const height = Number(pair[2]);
    if (width > 0 && height > 0) return width / height;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function ratioReport(dimensions, requestedRatio) {
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (!width || !height) {
    return {
      actual: null,
      requested: requestedRatio || "",
      requestedNumeric: parseRatio(requestedRatio),
      delta: null,
      ok: null
    };
  }

  const actual = width / height;
  const requestedNumeric = parseRatio(requestedRatio);
  const delta = requestedNumeric == null ? null : Math.abs(actual - requestedNumeric);

  return {
    actual: Number(actual.toFixed(6)),
    requested: requestedRatio || "",
    requestedNumeric,
    delta: delta == null ? null : Number(delta.toFixed(6)),
    ok: delta == null ? null : delta <= 0.02
  };
}

export function validateSavedImages(saved, options = {}) {
  const {
    expectedCount = saved.length,
    requestedRatio = "",
    jobs = [],
    contentReviewStatus = "Needs Review"
  } = options;

  const checksums = new Map();
  for (const file of saved) {
    if (!file.sha256) continue;
    checksums.set(file.sha256, (checksums.get(file.sha256) || 0) + 1);
  }

  const duplicateChecksums = [...checksums.entries()]
    .filter(([, count]) => count > 1)
    .map(([sha256, count]) => ({ sha256, count }));

  const missingJobIds = jobs
    .map((job) => job?.jobId || job?.job_id)
    .filter(Boolean)
    .filter((jobId) => !saved.some((file) => file.jobId === jobId));

  const ratioMismatches = saved
    .filter((file) => {
      const report = file.ratio || ratioReport(file.dimensions, file.requestedRatio || requestedRatio);
      return report.ok === false;
    })
    .map((file) => ({
      file: file.file,
      jobId: file.jobId || "",
      requestedRatio: file.requestedRatio || requestedRatio || "",
      actualRatio: file.ratio?.actual || ratioReport(file.dimensions, file.requestedRatio || requestedRatio).actual
    }));

  return {
    expectedCount,
    savedCount: saved.length,
    missingCount: Math.max(0, expectedCount - saved.length),
    countOk: saved.length === expectedCount,
    duplicateChecksums,
    missingJobIds,
    ratioMismatches,
    contentReviewStatus,
    reviewStatus: contentReviewStatus
  };
}

export function buildRegenerationQueue(saved, validation = {}, options = {}) {
  const { requestedRatio = "" } = options;
  const queue = [];

  for (const jobId of validation.missingJobIds || []) {
    const job = (options.jobs || []).find((item) => (item?.jobId || item?.job_id) === jobId) || {};
    queue.push({
      jobId,
      reason: "missing output",
      promptPath: job.promptPath || job.prompt_path || ""
    });
  }

  for (const item of validation.ratioMismatches || []) {
    queue.push({
      jobId: item.jobId || "",
      file: item.file,
      reason: "ratio mismatch",
      requestedRatio: item.requestedRatio || requestedRatio || "",
      actualRatio: item.actualRatio
    });
  }

  for (const item of validation.duplicateChecksums || []) {
    queue.push({
      reason: "duplicate checksum",
      sha256: item.sha256,
      count: item.count
    });
  }

  for (const file of saved) {
    if (!file.needsRegeneration) continue;
    queue.push({
      jobId: file.jobId || "",
      file: file.file,
      reason: file.regenerationReason || "content review requested",
      promptPath: file.promptPath || ""
    });
  }

  return queue;
}

export async function inspectChatGPTSession(tab) {
  if (!tab?.playwright?.evaluate || typeof tab.url !== "function") {
    throw new Error("inspectChatGPTSession requires an in-app browser tab");
  }

  const [currentUrl, page] = await Promise.all([
    tab.url(),
    tab.playwright.evaluate(() => {
      const composer = document.querySelector(
        "#prompt-textarea, textarea[data-testid*='prompt'], textarea[placeholder], [contenteditable='true'][data-testid*='composer'], main [contenteditable='true']"
      );
      const controls = [...document.querySelectorAll("button, a, [role='button']")]
        .map((node) => `${node.innerText || ""} ${node.getAttribute("aria-label") || ""}`.trim())
        .filter(Boolean)
        .slice(0, 250)
        .join("\n");
      const mainText = (document.querySelector("main")?.innerText || document.body?.innerText || "")
        .slice(0, 3000);
      return {
        hasComposer: Boolean(composer),
        controls,
        mainText,
        title: document.title || ""
      };
    })
  ]);

  const evidence = `${page.title}\n${page.controls}\n${page.mainText}`;
  const challenge = /verify you are human|captcha|checking your browser|security check|安全验证|人机验证|验证码|cloudflare/i.test(evidence);
  const authUrl = /(^|\.)auth\.openai\.com|\/auth\/(login|signup)|\/login(?:[/?#]|$)/i.test(currentUrl);
  const loginControl = /(^|\n)(log in|sign in|登录|登入)(\n|$)|sign up|注册/i.test(page.controls);

  let status = "unknown";
  if (challenge) {
    status = "challenge";
  } else if (page.hasComposer && /chatgpt\.com/i.test(currentUrl)) {
    status = "ready";
  } else if (authUrl || loginControl) {
    status = "signed_out";
  }

  return {
    status,
    ready: status === "ready",
    requiresUserAction: status === "signed_out" || status === "challenge",
    currentUrl: safeSessionLocation(currentUrl),
    hasComposer: page.hasComposer,
    guidance: sessionGuidance(status)
  };
}

function safeSessionLocation(value) {
  try {
    const url = new URL(value);
    if (/\/auth\//i.test(url.pathname)) return `${url.origin}/auth/`;
    return `${url.origin}/`;
  } catch {
    return "https://chatgpt.com/";
  }
}

function sessionGuidance(status) {
  if (status === "ready") {
    return "ChatGPT is ready in the Codex in-app browser.";
  }
  if (status === "challenge") {
    return "Complete the sign-in, CAPTCHA, passkey, or verification step yourself in the in-app browser. Never send credentials or one-time codes to Codex.";
  }
  if (status === "signed_out") {
    return "Sign in to your own ChatGPT account in the in-app browser, complete any verification there, then tell Codex that sign-in is complete.";
  }
  return "The ChatGPT session could not be confirmed. Open https://chatgpt.com/ in the in-app browser and check that the message composer is visible.";
}

export async function collectGeneratedImages(tab, options = {}) {
  const {
    minWidth = 500,
    minHeight = 500,
    newest = 1,
    excludeSizes = [],
    excludeSrcs = []
  } = options;

  const images = await tab.playwright.evaluate(
    ({ minWidth, minHeight, newest, excludeSizes, excludeSrcs }) => {
      const blockedSrcs = new Set(excludeSrcs);
      const raw = [...document.images].map((img, index) => ({
        index,
        alt: img.alt || "",
        src: img.currentSrc || img.src || "",
        width: img.naturalWidth,
        height: img.naturalHeight,
        complete: img.complete,
        visible: (() => {
          const rect = img.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })()
      }));

      const unique = [];
      const seen = new Set();
      for (const image of raw) {
        if (!image.src || !image.complete) continue;
        if (blockedSrcs.has(image.src)) continue;
        if (image.width < minWidth || image.height < minHeight) continue;
        if (excludeSizes.some((size) => image.width === size.width && image.height === size.height)) continue;
        if (seen.has(image.src)) continue;
        seen.add(image.src);
        unique.push(image);
      }

      return unique.slice(-newest);
    },
    { minWidth, minHeight, newest, excludeSizes, excludeSrcs }
  );

  return images;
}

export async function snapshotGeneratedImages(tab, options = {}) {
  const {
    minWidth = 500,
    minHeight = 500,
    excludeSizes = []
  } = options;

  return collectGeneratedImages(tab, {
    minWidth,
    minHeight,
    newest: Number.MAX_SAFE_INTEGER,
    excludeSizes
  });
}

export async function isChatGPTGenerating(tab) {
  const text = await tab.playwright.evaluate(() => {
    const controls = [...document.querySelectorAll("button,[role='button'],[role='status'],[aria-live]")]
      .map((node) => node.innerText || node.getAttribute("aria-label") || "")
      .join("\n");
    return controls.slice(-12000);
  });

  return /stop generating|stop streaming|stop responding|stop answer|停止生成|停止回答|正在生成|generating image|creating image|image is being generated/i.test(text);
}

export async function waitForGeneratedImages(tab, options = {}) {
  const {
    expectedCount = 1,
    beforeImages = [],
    minWidth = 500,
    minHeight = 500,
    excludeSizes = [],
    excludeSrcs = [],
    timeoutMs = 300000,
    pollMs = 3000,
    settleMs = 2500
  } = options;

  const startMs = Date.now();
  const blockedSrcs = [
    ...excludeSrcs,
    ...beforeImages.map((image) => image?.src).filter(Boolean)
  ];
  let latest = [];
  let lastBusy = false;

  while (Date.now() - startMs <= timeoutMs) {
    latest = await collectGeneratedImages(tab, {
      minWidth,
      minHeight,
      newest: Number.MAX_SAFE_INTEGER,
      excludeSizes,
      excludeSrcs: blockedSrcs
    });
    lastBusy = await isChatGPTGenerating(tab);

    if (latest.length >= expectedCount && !lastBusy) {
      if (settleMs > 0) {
        await tab.playwright.waitForTimeout(settleMs);
        latest = await collectGeneratedImages(tab, {
          minWidth,
          minHeight,
          newest: Number.MAX_SAFE_INTEGER,
          excludeSizes,
          excludeSrcs: blockedSrcs
        });
      }
      break;
    }

    await tab.playwright.waitForTimeout(pollMs);
  }

  const waitedMs = Date.now() - startMs;
  const complete = latest.length >= expectedCount && !lastBusy;
  const result = {
    expectedCount,
    freshCount: latest.length,
    complete,
    partial: !complete && latest.length > 0,
    timedOut: !complete && waitedMs >= timeoutMs,
    waitedMs,
    chatgptStillGenerating: lastBusy,
    images: latest.slice(-expectedCount),
    allFreshImages: latest,
    recoveryHint: latest.length === 0 && !lastBusy
      ? "ChatGPT may have returned text instead of images. Ask it to generate images now and not reply with advice, JSON, or an outline."
      : ""
  };
  Object.defineProperty(result, "toJSON", {
    enumerable: false,
    value() {
      return {
        expectedCount: result.expectedCount,
        freshCount: result.freshCount,
        complete: result.complete,
        partial: result.partial,
        timedOut: result.timedOut,
        waitedMs: result.waitedMs,
        chatgptStillGenerating: result.chatgptStillGenerating,
        images: result.images.map(redactDomImage),
        allFreshImages: result.allFreshImages.map(redactDomImage),
        recoveryHint: result.recoveryHint
      };
    }
  });
  return result;
}

export async function saveImagesFromPageAssets(tab, images, options = {}) {
  const {
    outDir,
    prefix = "chatgpt-image",
    prompt = "",
    chatUrl = "",
    notes = "",
    referenceFiles = [],
    includeSourceUrl = false,
    campaignId = "",
    jobs = [],
    expectedCount = images.length,
    requestedRatio = "",
    status = "Exported",
    reviewStatus = "Needs Review",
    contentReviewStatus = reviewStatus,
    delivery = {},
    includePrompt = false,
    includePromptHash = false,
    includeChatUrl = false,
    includeNotes = false,
    includeAbsolutePaths = false,
    manifestPath: explicitManifestPath = "",
    appendManifest = false,
    upsertByJobId = true,
    fileNameTemplate = "",
    assetResolveRetries = 2,
    assetResolveWaitMs = 1500
  } = options;

  if (!outDir) {
    throw new Error("saveImagesFromPageAssets requires options.outDir");
  }
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("saveImagesFromPageAssets requires at least one image");
  }

  await mkdir(outDir, { recursive: true });

  const capability = await tab.capabilities.get("pageAssets");
  if (!capability?.list || !capability?.bundle) {
    throw new Error("The Codex in-app browser pageAssets capability is unavailable. Install or enable the Browser capability, then retry in a new Codex task.");
  }
  const { inventory, targets } = await resolveImageAssetTargets(tab, capability, images, {
    retries: assetResolveRetries,
    waitMs: assetResolveWaitMs
  });

  const bundle = await capability.bundle({
    inventoryId: inventory.id,
    assetIds: targets.map(({ asset }) => asset.id)
  });

  if (bundle.failures.length > 0) {
    throw new Error(`Failed to export ${bundle.failures.length} image asset(s): ${JSON.stringify(bundle.failures)}`);
  }

  const saved = [];
  for (let index = 0; index < targets.length; index += 1) {
    const { image, asset } = targets[index];
    const job = jobs[index] || {};
    const exported = bundle.assets.find((item) => item.id === asset.id) || bundle.assets[index];
    const extension = extensionForAsset(exported);
    const jobId = job.jobId || job.job_id || "";
    const filenamePrefix = jobId ? slugify(jobId, prefix) : slugify(prefix, "chatgpt-image");
    const filename = renderFileName(fileNameTemplate, {
      prefix,
      filenamePrefix,
      index: index + 1,
      jobId,
      extension
    });
    const filePath = safeOutputPath(outDir, filename);
    await writeFileWithoutFollowingSymlinks(filePath, await readFile(exported.path));
    const fileStat = await stat(filePath);
    const bytes = await readFile(filePath);
    const dimensions = imageDimensions(bytes);
    const fileRequestedRatio = job.requestedRatio || job.requested_ratio || requestedRatio;
    saved.push({
      index: index + 1,
      campaignId: job.campaignId || job.campaign_id || campaignId,
      jobId,
      sourceId: job.sourceId || job.source_id || "",
      slot: job.slot || "",
      status: job.status || status,
      reviewStatus: job.reviewStatus || job.review_status || reviewStatus,
      contentReviewStatus: job.contentReviewStatus || job.content_review_status || contentReviewStatus,
      textLegibility: job.textLegibility || job.text_legibility || "Not Reviewed",
      forbiddenTermsFound: job.forbiddenTermsFound || job.forbidden_terms_found || [],
      unexpectedEnglishLabels: job.unexpectedEnglishLabels || job.unexpected_english_labels || [],
      businessInstructionClear: job.businessInstructionClear ?? job.business_instruction_clear ?? null,
      needsRegeneration: job.needsRegeneration ?? job.needs_regeneration ?? false,
      regenerationReason: job.regenerationReason || job.regeneration_reason || "",
      promptPath: job.promptPath || job.prompt_path || "",
      requestedRatio: fileRequestedRatio || "",
      file: filePath,
      filename,
      bytes: fileStat.size,
      sha256: checksumSha256(bytes),
      contentType: exported.contentType,
      dimensions,
      actualWidth: dimensions.width,
      actualHeight: dimensions.height,
      actual_width: dimensions.width,
      actual_height: dimensions.height,
      ratio: ratioReport(dimensions, fileRequestedRatio),
      domNaturalSize: {
        width: image.width,
        height: image.height
      },
      alt: image.alt,
      sourceUrl: includeSourceUrl && process.env.CHATGPT_BRIDGE_INCLUDE_SOURCE_URLS === "1"
        ? image.src
        : "[redacted temporary ChatGPT asset URL]"
    });
  }

  const manifestFiles = saved.map((file) => ({
    ...file,
    file: includeAbsolutePaths ? file.file : path.relative(outDir, file.file) || file.filename,
    promptPath: includeAbsolutePaths || !file.promptPath
      ? file.promptPath
      : path.basename(file.promptPath)
  }));
  const portableJobs = jobs.map((job) => ({
    ...job,
    promptPath: includeAbsolutePaths || !(job.promptPath || job.prompt_path)
      ? (job.promptPath || job.prompt_path || "")
      : path.basename(job.promptPath || job.prompt_path)
  }));
  const validation = validateSavedImages(manifestFiles, {
    expectedCount,
    requestedRatio,
    jobs: portableJobs,
    contentReviewStatus
  });
  const regenerationQueue = buildRegenerationQueue(manifestFiles, validation, {
    requestedRatio,
    jobs: portableJobs
  });
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    campaignId,
    prompt: includePrompt ? prompt : "[omitted; pass includePrompt: true to persist]",
    promptSha256: includePromptHash && prompt ? checksumSha256(Buffer.from(prompt)) : "",
    chatUrl: includeChatUrl ? chatUrl : "https://chatgpt.com/",
    notes: includeNotes ? notes : "",
    referenceFiles: referenceFiles.map((file) => includeAbsolutePaths ? file : path.basename(file)),
    requestedRatio,
    outDir: includeAbsolutePaths ? outDir : ".",
    expectedCount,
    count: saved.length,
    counts: {
      expected: expectedCount,
      saved: saved.length,
      missing: validation.missingCount
    },
    status,
    reviewStatus,
    contentReviewStatus,
    validation,
    regenerationQueue,
    delivery,
    files: manifestFiles
  };

  const manifestPath = explicitManifestPath || path.join(outDir, "manifest.json");
  const finalManifest = appendManifest
    ? await mergeManifestFile(manifestPath, manifest, { upsertByJobId })
    : manifest;
  await writeFile(manifestPath, JSON.stringify(finalManifest, null, 2));

  return {
    outDir,
    manifestPath,
    count: saved.length,
    files: saved,
    validation,
    regenerationQueue
  };
}

async function resolveImageAssetTargets(tab, capability, images, options = {}) {
  const { retries = 2, waitMs = 1500 } = options;
  let inventory = null;
  let targets = [];
  let missing = [];

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    inventory = await capability.list();
    targets = [];
    missing = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const asset = inventory.assets.find((item) => item.kind === "image" && item.url === image.src);
      if (asset) {
        targets.push({ image, asset });
      } else {
        missing.push({ index, image });
      }
    }

    if (missing.length === 0) {
      return { inventory, targets };
    }

    await scrollImagesIntoView(tab, missing.map((item) => item.image));
    if (waitMs > 0) {
      await tab.playwright.waitForTimeout(waitMs);
    }
  }

  const summary = missing.map(({ index, image }) => ({
    index: index + 1,
    width: image.width,
    height: image.height,
    alt: image.alt || "",
    srcHash: checksumSha256(Buffer.from(image.src || "")).slice(0, 16)
  }));
  throw new Error(`Image asset(s) visible in DOM but missing from pageAssets inventory after retries: ${JSON.stringify(summary)}`);
}

async function scrollImagesIntoView(tab, images) {
  const srcs = images.map((image) => image?.src).filter(Boolean);
  if (srcs.length === 0) return;
  await tab.playwright.evaluate(({ srcs }) => {
    const wanted = new Set(srcs);
    for (const img of document.images) {
      const src = img.currentSrc || img.src || "";
      if (wanted.has(src)) {
        img.scrollIntoView({ block: "center", inline: "center" });
      }
    }
  }, { srcs });
}

function renderFileName(template, values) {
  const { prefix, filenamePrefix, index, jobId, extension } = values;
  if (!template) {
    return sanitizeFileName(`${filenamePrefix}-${String(index).padStart(2, "0")}${extension}`, extension);
  }
  const rendered = template
    .replaceAll("{prefix}", slugify(prefix))
    .replaceAll("{filenamePrefix}", slugify(filenamePrefix))
    .replaceAll("{index}", String(index))
    .replaceAll("{index2}", String(index).padStart(2, "0"))
    .replaceAll("{jobId}", slugify(jobId, filenamePrefix))
    .replaceAll("{extension}", extension.replace(/^\./, ""));
  return sanitizeFileName(rendered.endsWith(extension) ? rendered : `${rendered}${extension}`, extension);
}

function sanitizeFileName(value, extension) {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const stem = String(value || "")
    .replaceAll("\\", "-")
    .replaceAll("/", "-")
    .replace(/\.{2,}/g, "-")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const withoutDuplicateExtension = stem.toLowerCase().endsWith(ext.toLowerCase())
    ? stem.slice(0, -ext.length)
    : stem;
  const safeStem = slugify(withoutDuplicateExtension, "chatgpt-image").slice(0, 180);
  return `${safeStem}${ext}`;
}

function safeOutputPath(outDir, filename) {
  const root = path.resolve(outDir);
  const resolved = path.resolve(root, filename);
  if (resolved !== path.join(root, path.basename(filename)) || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to write outside output directory: ${filename}`);
  }
  return resolved;
}

async function writeFileWithoutFollowingSymlinks(filePath, bytes) {
  try {
    const current = await lstat(filePath);
    if (current.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${path.basename(filePath)}`);
    }
    if (!current.isFile()) {
      throw new Error(`Refusing to replace non-file output target: ${path.basename(filePath)}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const flags = fsConstants.O_WRONLY
    | fsConstants.O_CREAT
    | fsConstants.O_TRUNC
    | (fsConstants.O_NOFOLLOW || 0);
  let handle;
  try {
    handle = await open(filePath, flags, 0o600);
    await handle.writeFile(bytes);
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error(`Refusing to write through symbolic link: ${path.basename(filePath)}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function redactDomImage(image) {
  return {
    index: image?.index,
    alt: image?.alt || "",
    width: image?.width || null,
    height: image?.height || null,
    complete: Boolean(image?.complete),
    visible: Boolean(image?.visible),
    src: image?.src ? `[redacted:${checksumSha256(Buffer.from(image.src)).slice(0, 16)}]` : ""
  };
}

async function mergeManifestFile(manifestPath, next, options = {}) {
  const { upsertByJobId = true } = options;
  const existing = await readJsonIfExists(manifestPath);
  if (!existing) return next;

  const files = [...(existing.files || [])];
  for (const file of next.files || []) {
    const key = upsertByJobId && file.jobId ? file.jobId : file.file;
    const index = files.findIndex((item) => (upsertByJobId && file.jobId ? item.jobId === key : item.file === key));
    if (index >= 0) {
      files[index] = file;
    } else {
      files.push(file);
    }
  }

  const expectedCount = Math.max(existing.expectedCount || 0, next.expectedCount || 0, files.length);
  const validation = validateSavedImages(files, {
    expectedCount,
    requestedRatio: next.requestedRatio || existing.requestedRatio || "",
    jobs: [...(existing.jobs || []), ...(next.jobs || [])],
    contentReviewStatus: next.contentReviewStatus || existing.contentReviewStatus || "Needs Review"
  });
  const regenerationQueue = buildRegenerationQueue(files, validation, {
    requestedRatio: next.requestedRatio || existing.requestedRatio || ""
  });

  return {
    ...existing,
    ...next,
    generatedAt: existing.generatedAt,
    updatedAt: new Date().toISOString(),
    expectedCount,
    count: files.length,
    counts: {
      expected: expectedCount,
      saved: files.length,
      missing: validation.missingCount
    },
    validation,
    regenerationQueue,
    files
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function extensionForAsset(asset) {
  const contentType = String(asset.contentType || "").toLowerCase();
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";

  const fromName = path.extname(asset.name || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;

  return ".png";
}
