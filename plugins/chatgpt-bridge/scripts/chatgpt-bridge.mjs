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

const TEMPORARY_REQUEST = /临时对话|临时聊天|临时(?:任务|把|将|处理|改写|总结|翻译)|一次性|随手|快速|小任务|用完即走|不保留(?:上下文|历史)|temporary chat|one[- ]?off|quick task|do not retain/i;
const PERSISTENT_REQUEST = /继续(?:这个|上次|当前)?对话|修改上一张|保留(?:上下文|历史)|复用(?:对话|上下文|附件)|多轮|迭代|深度研究|完整项目|系列|批量|组图|campaign|continue (?:this|the) chat|modify the previous|keep (?:the )?context|reuse|multi[- ]?turn|iterate|deep research|campaign|batch/i;
const SINGLE_IMAGE_REQUEST = /(?:生成|制作|画|做).{0,12}(?:一张|1张|一个)?(?:图片|图像|海报|插画|图标|封面)|one (?:image|picture|poster|illustration|icon|cover)/i;
const SMALL_TEXT_REQUEST = /(?:把|将).{0,40}(?:改写|缩短|精简|翻译|提取|分类|格式化)|(?:一句话|一句|三个关键词).{0,30}(?:总结|解释|概括|提取)|rewrite (?:this|the) (?:sentence|title)|translate (?:this|the) (?:sentence|title)|extract (?:three|3) keywords/i;

export function classifyChatGPTConversationMode(task, options = {}) {
  const input = normalizeConversationTask(task, options);
  const explicitMode = normalizeConversationMode(input.explicitMode);
  const existingReasons = [];
  const persistentReasons = [];

  if (input.requiresExistingConversation) existingReasons.push("requires existing conversation");
  if (input.requiresExistingAttachments) existingReasons.push("requires existing attachments");
  if (input.needsFutureContinuation) persistentReasons.push("needs future continuation");
  if (input.needsUserIteration) persistentReasons.push("needs user-led iteration");
  if (input.researchMode === "deep") persistentReasons.push("requires deep research");
  if (input.productionMode === "campaign") persistentReasons.push("is a campaign or production run");
  if (input.expectedTurns > 1 && input.retryMode === "none") persistentReasons.push(`expects ${input.expectedTurns} turns`);
  if (input.imageCount > 2) persistentReasons.push(`requests ${input.imageCount} images`);
  if (input.newReferenceImageCount > 2) persistentReasons.push(`uses ${input.newReferenceImageCount} new reference images`);
  if (input.imageCount > 0 && !input.temporaryImageGenerationSupported) {
    persistentReasons.push("Temporary Chat image generation is unavailable in the verified ChatGPT surface");
  }
  if (PERSISTENT_REQUEST.test(input.text)) persistentReasons.push("request language indicates persistent work");

  if (explicitMode === "temporary" && existingReasons.length > 0) {
    return routeDecision("temporary", "blocked", "explicit", "high", ["EXPLICIT_TEMPORARY_CONTEXT_CONFLICT"], existingReasons, input, {
      blockers: existingReasons,
      warnings: ["Temporary Chat cannot reuse history or attachments from another conversation."]
    });
  }

  if (explicitMode === "temporary" && input.imageCount > 0 && !input.temporaryImageGenerationSupported) {
    return routeDecision("temporary", "blocked", "explicit", "high", ["TEMPORARY_IMAGE_GENERATION_UNAVAILABLE"], [
      "The verified ChatGPT Temporary Chat surface does not support image generation."
    ], input, {
      blockers: ["temporary image generation unavailable"],
      warnings: ["Use a clean standard chat for image generation."]
    });
  }

  if (explicitMode === "temporary") {
    return routeDecision("temporary", "new_temporary", "explicit", "high", ["EXPLICIT_TEMPORARY"], ["Temporary Chat was explicitly requested."], input, {
      warnings: persistentReasons.length > 0
        ? [`Explicit Temporary Chat overrides complexity signals: ${persistentReasons.join("; ")}.`]
        : []
    });
  }

  if (explicitMode === "standard") {
    return routeDecision("standard", existingReasons.length > 0 ? "reuse_current" : "new_standard", "explicit", "high", ["EXPLICIT_STANDARD"], ["Standard chat was explicitly requested."], input);
  }

  if (input.retryMode === "mechanical") {
    return routeDecision(
      input.currentConversationMode,
      "reuse_current",
      "automatic",
      "high",
      ["MECHANICAL_RETRY_REUSES_CURRENT"],
      ["A bounded Retry action should remain in the current conversation."],
      input
    );
  }

  if (existingReasons.length > 0) {
    return routeDecision("standard", "reuse_current", "automatic", "high", ["REQUIRES_EXISTING_CONTEXT"], existingReasons, input, {
      blockers: existingReasons
    });
  }

  if (persistentReasons.length > 0) {
    return routeDecision("standard", "new_standard", "automatic", "high", ["PERSISTENT_OR_COMPLEX_TASK"], ["Persistent context is safer for this task."], input, {
      blockers: persistentReasons
    });
  }

  const oneOff = TEMPORARY_REQUEST.test(input.text) || SMALL_TEXT_REQUEST.test(input.text);
  const smallTextTask = input.imageCount === 0 && input.expectedTurns <= 1;
  if (oneOff && smallTextTask) {
    return routeDecision("temporary", "new_temporary", "automatic", "high", ["ONE_OFF_TEXT_TASK"], [
      "the request is a one-off task that can be completed in one turn without image generation"
    ], input);
  }

  return routeDecision("standard", "new_standard", "fallback", "low", ["AMBIGUOUS_DEFAULT_STANDARD"], ["The task boundary is ambiguous, so a clean standard chat is safer."], input);
}

export async function inspectChatGPTConversationMode(tab) {
  if (!tab?.playwright?.evaluate) {
    throw new Error("inspectChatGPTConversationMode requires an in-app browser tab");
  }
  const page = await tab.playwright.evaluate(() => {
    const controls = [...document.querySelectorAll("button, a, [role='button'], [role='menuitem']")].map((node) => ({
      label: (node.getAttribute("aria-label") || node.innerText || node.getAttribute("title") || "").trim(),
      pressed: node.getAttribute("aria-pressed") || "",
      state: node.getAttribute("data-state") || ""
    })).filter((item) => item.label);
    return {
      controls,
      mainText: (document.querySelector("main")?.innerText || "").slice(0, 2500),
      bannerText: (document.querySelector("header, [role='banner']")?.innerText || "").slice(0, 1000)
    };
  });
  const temporaryControls = page.controls.filter((item) => /temporary chat|temporary conversation|临时对话|临时聊天/i.test(item.label));
  const activation = temporaryControls.find((item) => /turn on|enable|开启|打开/i.test(item.label));
  const active = temporaryControls.some((item) =>
    /turn off|disable|关闭/i.test(item.label)
    || /^(true|on)$/i.test(item.pressed)
    || /^(active|checked|on|selected)$/i.test(item.state)
  ) || /Temporary Chat|临时对话|临时聊天/i.test(page.bannerText)
    || /^Temporary Chat\b|^临时(?:对话|聊天)/im.test(page.mainText);
  return {
    mode: active ? "temporary" : "standard",
    temporaryAvailable: temporaryControls.length > 0,
    temporaryActive: active,
    activationLabel: activation?.label || "",
    matchingControlCount: temporaryControls.length
  };
}

export async function enableChatGPTTemporaryChat(tab, options = {}) {
  const before = await inspectChatGPTConversationMode(tab);
  if (before.temporaryActive) return { changed: false, before, after: before, error: "" };
  if (!before.activationLabel || !tab?.playwright?.getByRole) {
    return {
      changed: false,
      before,
      after: before,
      error: "Temporary Chat control was not visible."
    };
  }
  const control = tab.playwright.getByRole("button", { name: before.activationLabel, exact: true });
  const count = await control.count();
  if (count !== 1) {
    return { changed: false, before, after: before, error: `Temporary Chat control was ambiguous (${count} matches).` };
  }
  await control.click();
  if (options.settleMs !== 0) await tab.playwright.waitForTimeout(options.settleMs || 1200);
  const after = await inspectChatGPTConversationMode(tab);
  return {
    changed: after.temporaryActive,
    before,
    after,
    error: after.temporaryActive ? "" : "Temporary Chat active state could not be verified after clicking."
  };
}

export async function prepareChatGPTConversation(tab, task, options = {}) {
  const decision = classifyChatGPTConversationMode(task, options);
  if (decision.blocked) return { decision, prepared: false, fallback: false, error: decision.warnings[0] };
  if (decision.action === "reuse_current") {
    return { decision, prepared: true, fallback: false, mode: (await inspectChatGPTConversationMode(tab)).mode };
  }
  await tab.goto("https://chatgpt.com/");
  if (decision.action === "new_standard") {
    const current = await inspectChatGPTConversationMode(tab);
    return { decision, prepared: current.mode === "standard", fallback: false, mode: current.mode };
  }
  const activation = await enableChatGPTTemporaryChat(tab, options);
  if (activation.after?.temporaryActive) {
    return { decision, prepared: true, fallback: false, mode: "temporary", activation };
  }
  if (decision.source === "explicit") {
    return { decision, prepared: false, fallback: false, mode: "standard", activation, error: activation.error };
  }
  await tab.goto("https://chatgpt.com/");
  const standard = await inspectChatGPTConversationMode(tab);
  return {
    decision: {
      ...decision,
      mode: "standard",
      action: "new_standard",
      reasonCodes: [...decision.reasonCodes, "TEMPORARY_UNAVAILABLE_FALLBACK"],
      warnings: [...decision.warnings, activation.error]
    },
    prepared: standard.mode === "standard",
    fallback: true,
    mode: standard.mode,
    activation
  };
}

function normalizeConversationTask(task, options) {
  const source = typeof task === "string" ? { text: task } : { ...(task || {}) };
  const text = String(source.text || source.prompt || source.request || "");
  return {
    text,
    explicitMode: source.explicitMode || source.explicit_mode || options.explicitMode || "",
    expectedTurns: positiveInteger(source.expectedTurns ?? source.expected_turns ?? options.expectedTurns, 1),
    imageCount: nonNegativeInteger(source.imageCount ?? source.image_count ?? options.imageCount, inferImageCount(text)),
    newReferenceImageCount: nonNegativeInteger(
      source.newReferenceImageCount ?? source.new_reference_image_count ?? source.referenceFileCount ?? source.reference_file_count ?? options.newReferenceImageCount ?? options.referenceFileCount,
      Array.isArray(source.referenceFiles) ? source.referenceFiles.length : 0
    ),
    requiresExistingConversation: Boolean(
      source.requiresExistingConversation ?? source.requires_existing_conversation ?? source.needsConversationHistory ?? source.needs_conversation_history ?? options.requiresExistingConversation ?? options.needsConversationHistory
      ?? /继续(?:这个|上次|当前)?对话|修改上一张|continue (?:this|the) chat|modify the previous/i.test(text)
    ),
    requiresExistingAttachments: Boolean(source.requiresExistingAttachments ?? source.requires_existing_attachments ?? options.requiresExistingAttachments),
    needsFutureContinuation: Boolean(source.needsFutureContinuation ?? source.needs_future_continuation ?? options.needsFutureContinuation),
    needsUserIteration: Boolean(source.needsUserIteration ?? source.needs_user_iteration ?? source.needsIteration ?? source.needs_iteration ?? options.needsUserIteration ?? options.needsIteration),
    researchMode: String(source.researchMode || source.research_mode || source.researchDepth || source.research_depth || options.researchMode || options.researchDepth || "none").toLowerCase(),
    productionMode: String(source.productionMode || source.production_mode || (source.campaign || source.isCampaign || source.is_campaign ? "campaign" : "") || options.productionMode || (options.campaign ? "campaign" : "") || "single").toLowerCase(),
    retryMode: String(source.retryMode || source.retry_mode || options.retryMode || "none").toLowerCase(),
    currentConversationMode: normalizeConversationMode(
      source.currentConversationMode || source.current_conversation_mode || options.currentConversationMode || "standard"
    ) || "standard",
    temporaryImageGenerationSupported: Boolean(
      source.temporaryImageGenerationSupported
      ?? source.temporary_image_generation_supported
      ?? options.temporaryImageGenerationSupported
      ?? false
    )
  };
}

function normalizeConversationMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["temporary", "temp", "临时", "临时对话", "临时聊天"].includes(mode)) return "temporary";
  if (["standard", "persistent", "normal", "标准", "标准对话", "普通对话"].includes(mode)) return "standard";
  return "";
}

function inferImageCount(text) {
  const count = text.match(/(?:生成|制作|画|做|generate|create).{0,12}?(\d{1,2})\s*(?:张|幅|个|images?|pictures?)/i);
  if (count) return Number(count[1]);
  const words = [["九", 9], ["八", 8], ["七", 7], ["六", 6], ["五", 5], ["四", 4], ["三", 3], ["两", 2], ["一", 1]];
  for (const [word, number] of words) {
    if (new RegExp(`${word}张`).test(text)) return number;
  }
  return SINGLE_IMAGE_REQUEST.test(text) ? 1 : 0;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function routeDecision(mode, action, source, confidence, reasonCodes, reasons, input, extra = {}) {
  return {
    mode,
    action,
    blocked: action === "blocked",
    source,
    confidence,
    reasonCodes,
    reasons,
    blockers: extra.blockers || [],
    warnings: extra.warnings || [],
    normalized: {
      expectedTurns: input.expectedTurns,
      imageCount: input.imageCount,
      newReferenceImageCount: input.newReferenceImageCount,
      requiresExistingConversation: input.requiresExistingConversation,
      requiresExistingAttachments: input.requiresExistingAttachments,
      needsFutureContinuation: input.needsFutureContinuation,
      needsUserIteration: input.needsUserIteration,
      researchMode: input.researchMode,
      productionMode: input.productionMode,
      retryMode: input.retryMode,
      currentConversationMode: input.currentConversationMode,
      temporaryImageGenerationSupported: input.temporaryImageGenerationSupported
    }
  };
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

export async function inspectChatGPTResponseState(tab) {
  const page = await tab.playwright.evaluate(() => {
    const main = document.querySelector("main");
    const mainText = (main?.innerText || "").slice(-6000);
    const controls = [...(main || document).querySelectorAll("button, [role='button']")]
      .map((node) => (node.getAttribute("aria-label") || node.innerText || "").trim())
      .filter(Boolean);
    const composer = document.querySelector(
      "#prompt-textarea, textarea[data-testid*='prompt'], [contenteditable='true'][data-testid*='composer'], main [contenteditable='true']"
    );
    return {
      mainText,
      controls,
      hasDraft: Boolean((composer?.value || composer?.innerText || composer?.textContent || "").trim())
    };
  });
  const retryLabel = page.controls.find((label) => /^(retry|try again|重试|再试一次)$/i.test(label)) || "";
  const sendLabel = page.controls.find((label) => /^(send prompt|send message|send|发送提示词|发送消息|发送)$/i.test(label)) || "";
  const retryableError = /something went wrong while generating|there was an error generating|network error|response generation failed|生成回复时出错|生成响应时出错|网络错误/i.test(page.mainText);
  const unsupportedCapability = /temporary chat.{0,80}(?:cannot|can't|does not|doesn't).{0,80}(?:image generation|generate images)|临时对话.{0,80}(?:无法|不能|不支持).{0,80}(?:图片生成|生成图片)/is.test(page.mainText);
  return {
    state: unsupportedCapability
      ? "unsupported_capability"
      : retryableError && retryLabel
        ? "retryable_error"
        : retryableError
          ? "error"
          : "normal",
    retryAvailable: Boolean(retryLabel),
    retryLabel,
    hasDraft: page.hasDraft,
    sendAvailable: Boolean(sendLabel),
    sendLabel,
    errorText: unsupportedCapability
      ? "The current ChatGPT Temporary Chat surface does not support image generation."
      : retryableError
      ? extractResponseError(page.mainText)
      : ""
  };
}

export async function retryChatGPTResponse(tab, options = {}) {
  const state = await inspectChatGPTResponseState(tab);
  if (!state.retryAvailable || !state.retryLabel) {
    return { retried: false, state, error: "No unique Retry control is available." };
  }
  const retry = tab.playwright.getByRole("button", { name: state.retryLabel, exact: true });
  const count = await retry.count();
  if (count !== 1) {
    return { retried: false, state, error: `Retry control was ambiguous (${count} matches).` };
  }
  await retry.click();
  if (options.settleMs !== 0) await tab.playwright.waitForTimeout(options.settleMs || 1000);
  const recoveryActions = ["clicked_retry"];
  let mode = await inspectChatGPTConversationMode(tab);
  if (options.expectedConversationMode === "temporary" && mode.mode !== "temporary") {
    const restored = await enableChatGPTTemporaryChat(tab, { settleMs: options.settleMs });
    if (!restored.after?.temporaryActive) {
      return {
        retried: false,
        state,
        mode,
        recoveryActions,
        error: restored.error || "Temporary Chat could not be restored after Retry."
      };
    }
    recoveryActions.push("restored_temporary_chat");
    mode = restored.after;
  }
  const after = await inspectChatGPTResponseState(tab);
  if (after.state === "normal" && after.hasDraft && after.sendAvailable) {
    const send = tab.playwright.getByRole("button", { name: after.sendLabel, exact: true });
    const sendCount = await send.count();
    if (sendCount !== 1) {
      return {
        retried: false,
        state,
        mode,
        recoveryActions,
        error: `Recovered draft could not be submitted (${sendCount} Send controls).`
      };
    }
    await send.click();
    recoveryActions.push("resubmitted_recovered_draft");
  }
  return { retried: true, state, mode, recoveryActions, error: "" };
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
    settleMs = 2500,
    maxRetries = 1,
    retrySettleMs = 1000,
    expectedConversationMode = "standard"
  } = options;

  const startMs = Date.now();
  const blockedSrcs = [
    ...excludeSrcs,
    ...beforeImages.map((image) => image?.src).filter(Boolean)
  ];
  let latest = [];
  let lastBusy = false;
  let retryCount = 0;
  let terminalState = "waiting";
  const errors = [];
  const recoveryActions = [];

  while (Date.now() - startMs <= timeoutMs) {
    latest = await collectGeneratedImages(tab, {
      minWidth,
      minHeight,
      newest: Number.MAX_SAFE_INTEGER,
      excludeSizes,
      excludeSrcs: blockedSrcs
    });
    lastBusy = await isChatGPTGenerating(tab);
    const responseState = await inspectChatGPTResponseState(tab);

    if (responseState.state === "retryable_error") {
      errors.push(responseState.errorText || "ChatGPT returned a retryable generation error.");
      if (retryCount < maxRetries) {
        const retry = await retryChatGPTResponse(tab, {
          settleMs: retrySettleMs,
          expectedConversationMode
        });
        if (retry.retried) {
          retryCount += 1;
          recoveryActions.push({
            action: "retry",
            attempt: retryCount,
            atMs: Date.now() - startMs,
            steps: retry.recoveryActions || []
          });
          continue;
        }
      }
      terminalState = "retry_exhausted";
      break;
    }

    if (responseState.state === "error") {
      errors.push(responseState.errorText || "ChatGPT returned a generation error.");
      terminalState = "error";
      break;
    }

    if (responseState.state === "unsupported_capability") {
      errors.push(responseState.errorText);
      terminalState = "unsupported_capability";
      break;
    }

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
      terminalState = "complete";
      break;
    }

    await tab.playwright.waitForTimeout(pollMs);
  }

  const waitedMs = Date.now() - startMs;
  const complete = latest.length >= expectedCount && !lastBusy;
  if (terminalState === "waiting") {
    terminalState = complete ? "complete" : "timed_out";
  }
  const result = {
    expectedCount,
    freshCount: latest.length,
    complete,
    partial: !complete && latest.length > 0,
    timedOut: !complete && waitedMs >= timeoutMs,
    waitedMs,
    chatgptStillGenerating: lastBusy,
    terminalState,
    retryCount,
    errors,
    recoveryActions,
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
        terminalState: result.terminalState,
        retryCount: result.retryCount,
        errors: result.errors,
        recoveryActions: result.recoveryActions,
        images: result.images.map(redactDomImage),
        allFreshImages: result.allFreshImages.map(redactDomImage),
        recoveryHint: result.recoveryHint
      };
    }
  });
  return result;
}

function extractResponseError(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const match = lines.find((line) =>
    /something went wrong while generating|there was an error generating|network error|response generation failed|生成回复时出错|生成响应时出错|网络错误/i.test(line)
  );
  return (match || "ChatGPT returned a generation error.").slice(0, 500);
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
