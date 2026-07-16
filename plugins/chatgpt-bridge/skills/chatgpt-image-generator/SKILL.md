---
name: chatgpt-image-generator
description: Use when the user asks Codex to open ChatGPT in the in-app browser, generate one or more images with their own ChatGPT account, export originals locally, batch images, or verify actual image dimensions.
---

# ChatGPT Image Generator

Use this skill when the user wants image generation through the ChatGPT web UI and wants the results saved locally.

This skill coordinates the browser workflow; it does not use the OpenAI API. It relies on the user's own ChatGPT browser session and never asks for or stores account credentials.

## Required Companion Skill

Before browser work, use the `browser:control-in-app-browser` skill. Follow its setup exactly and use the in-app browser surface, not a separate browser automation mechanism. If that skill or the tab `pageAssets` capability is unavailable, stop with an actionable compatibility message; do not silently switch to Chrome, Playwright CLI, direct asset URLs, or an API.

## First-Run Account Onboarding

Before sending prompts or uploads, open `https://chatgpt.com/` in the Codex in-app browser and call `inspectChatGPTSession(tab)` from `../../scripts/chatgpt-bridge.mjs` when practical.

Handle the returned state as follows:

- `ready`: continue. The ChatGPT composer is visible.
- `signed_out`: keep the in-app browser open and ask the user to sign in to their own ChatGPT account there. Pause generation until the user says sign-in is complete, then verify again.
- `challenge`: ask the user to complete CAPTCHA, passkey, two-factor authentication, or other verification directly in the in-app browser. Never request passwords or one-time codes in chat.
- `unknown`: navigate to `https://chatgpt.com/`, wait for the page to settle, and check again. Continue only when the composer is visible.

The browser profile may retain the user's ChatGPT session across later tasks. Do not inspect, export, log, or copy cookies, local storage, session tokens, passwords, passkeys, or verification codes. To revoke access, the user can sign out of ChatGPT in the in-app browser.

## Workflow

1. Clarify only if required:
   - image count
   - output folder
   - file prefix
   - whether existing ChatGPT conversation should be reused or a new chat should be opened
   - whether reference images need to be uploaded

2. Open or reuse ChatGPT:
   - Prefer a new tab at `https://chatgpt.com/` for clean tests and new batches.
   - Reuse the current ChatGPT conversation when the user asks to continue the current context.

3. Prepare the prompt:
   - Include count, subject, aspect ratio, background, product/model/campaign framing, and negative requirements.
   - For batches, ask for independent images, not a collage, unless the user explicitly wants a grid.
   - For resolution tests, state the requested pixel size, but treat downloaded dimensions as authoritative.
   - When the user wants higher visual quality through research, references, professional knowledge, web lookup, deep research, or iterative co-creation, use Research-Aided Mode before asking ChatGPT to generate images.
   - When the user asks for a multi-item campaign, ecommerce poster set, catalog run, or design co-creation batch, use Campaign Co-Creation Mode.

4. Send the prompt:
   - Prefer direct composer interaction when stable.
   - If direct fill fails, write the prompt to the browser clipboard, focus the ChatGPT textbox, paste, and press Enter.

5. Wait for completion:
   - Check that ChatGPT's stop button is gone.
   - Prefer `waitForGeneratedImages` over one-off collection when an expected image count is known.
   - For batches, wait until the expected number of fresh image resources appears. Do not treat a partial batch, such as 7 of 9 images, as complete.
   - If no fresh images appear and ChatGPT is no longer generating, treat it as a likely text reply instead of an image reply and send a stricter generation-only correction.

6. Export images:
   - Use the tab `pageAssets` capability.
   - Do not navigate directly to temporary asset URLs just to fetch images.
   - Use `scripts/chatgpt-bridge.mjs` from this plugin to save images and write a manifest when practical.

7. Verify outputs:
   - Read actual file dimensions from the saved image bytes.
   - Check `sha256`, duplicate files, saved count, and requested-vs-actual ratio when using the helper manifest.
   - Report file paths, counts, and actual dimensions.
   - If a requested 4K image downloads as 1254 x 1254, 1536 x 1536, or another lower size, state that it did not meet the 4K requirement.

## Research-Aided Mode

Use this mode when the user wants ChatGPT's search, research, thinking, context-building, or professional domain knowledge to improve image generation quality.

1. Start with a research-only message:
   - Tell ChatGPT not to generate images yet.
   - Ask for concise visual knowledge cards, not a long essay.
   - Capture adopted visual knowledge, must-show constraints, common failure modes, and final generation prompts.

2. Send a generation-only message:
   - Refer to the knowledge cards.
   - Ask for the exact number of independent images.
   - Say "do not explain, do not output JSON, do not make a collage, no text/logo/watermark" unless the user requested otherwise.

3. Export and inspect the source assets:
   - Save the generated image resources through `pageAssets`.
   - Verify actual dimensions and file count.
   - Prefer source PNG/JPEG/WebP assets over screenshots.

4. Optionally run a structured refinement:
   - Ask for a short creative-director critique plus regenerated images.
   - Name concrete defects to fix.
   - If multiple unrelated subjects are in the same batch, explicitly say not to blend or combine subjects.
   - If ChatGPT fuses concepts, correct it by regenerating one subject at a time or by using explicit "only this subject / do not include that subject" constraints.

5. Decide whether the flow worked:
   - It passes when research constraints visibly appear in the result and source export succeeds.
   - It is only partially successful if the image is good but the workflow needs separation prompts, retries, or manual correction. Record that in notes.

Good research-only prompt shape:

```text
Please do not generate images yet. For each task, use available search/research/domain knowledge and output:
A. 3-5 visual knowledge points actually used
B. 6 must-show visual constraints
C. 4 common failure modes
D. one final English image-generation prompt
```

## Campaign Co-Creation Mode

Use this mode for deep creative batches such as ecommerce posters, multi-SKU catalogs, reference-driven concept sets, or any request where each output needs traceable identity.

The operating model is:

```text
Research -> Campaign Plan -> Prompt Pack -> Generate -> Export -> Inspect -> Review Pack -> Delivery Manifest
```

### Campaign Planning

Before generating, define a small manifest in your own notes or files:

- `campaignId`: stable slug for the whole run
- `jobId`: one unique id per final image
- `sourceId`: source product/design/reference id
- `slot`: visual role such as `PDP Hero`, `Editorial Board`, or `Macro Detail`
- `promptPath`: path to the exact prompt sent for that job, when practical
- `requestedRatio`
- `referenceFiles`
- expected image count

For high-quality campaign work, save prompt packs to disk. This matters as much as saving images because it makes recovery and review possible.

### Small-Batch Protocol

Do not fire a large campaign blindly into one long ChatGPT turn.

- Prefer one source item or a small group per generation turn.
- For training cards or tightly related visual systems, one batch of up to 9 independent images can work well when the prompt explicitly says "9 separate images" and "do not create one collage".
- For unrelated subjects, queue batches such as 3-4 independent images.
- Wait for completion before sending the next batch.
- Snapshot existing generated images before sending, then collect only newly generated images by excluding previous `src` values.
- If ChatGPT returns fewer images than expected, retry only the missing job IDs.

### Generation Prompt Rules

Use generation-only prompts after planning:

```text
Generate exactly 3 independent images, one image per job ID.
Do not create a collage, contact sheet, grid, watermark, logo, QR code, fake price, or random text.
Preserve this source truth for every job:
<category, silhouette, material, gemstone hierarchy, setting logic, allowed changes>.

Job A ...
Job B ...
Job C ...
```

For unrelated subjects, explicitly say not to combine or blend them. If blending happens, regenerate one subject at a time.

### Export Manifest

When calling `saveImagesFromPageAssets`, pass campaign metadata when available:

```js
const before = await bridge.snapshotGeneratedImages(tab, { minWidth: 500, minHeight: 500 });
// send prompt and wait
const after = await bridge.collectGeneratedImages(tab, {
  minWidth: 500,
  minHeight: 500,
  newest: 3,
  excludeSrcs: before.map((image) => image.src)
});
const result = await bridge.saveImagesFromPageAssets(tab, after, {
  outDir,
  prefix: "poster",
  campaignId: "sapphire-turquoise-posters",
  expectedCount: 3,
  requestedRatio: "3:4",
  jobs: [
    { jobId: "ST-001-PA", sourceId: "ST-001", slot: "PDP Hero", requestedRatio: "3:4", promptPath: "prompts/ST-001-PA.txt" },
    { jobId: "ST-001-PB", sourceId: "ST-001", slot: "Editorial Board", requestedRatio: "3:4", promptPath: "prompts/ST-001-PB.txt" },
    { jobId: "ST-001-PC", sourceId: "ST-001", slot: "Macro Detail", requestedRatio: "9:16", promptPath: "prompts/ST-001-PC.txt" }
  ]
});
```

The helper writes `sha256`, actual dimensions, actual ratio, requested ratio, count validation, duplicate checksum flags, `status: Exported`, and `reviewStatus: Needs Review`. Shareable manifests omit full prompts, conversation-specific URLs, absolute paths, and temporary asset URLs by default.
Manifests use `schemaVersion: 2` and include both nested `dimensions` plus flat `actual_width` / `actual_height` fields for table imports.

### Status Discipline

Do not overclaim quality. Keep production state and visual approval separate:

- `Generated`: ChatGPT appears to have produced the image.
- `Exported`: the source file was saved locally and measured.
- `Uploaded`: a downstream system received the file.
- `Needs Review`: default visual review state.
- `Approved` / `Rejected`: only after explicit review.

Generated or uploaded does not mean approved.

### Downstream Delivery

This plugin should produce clean files and manifests for downstream systems. It does not need to own every delivery integration.

For Feishu/Base-style delivery, keep these fields available:

- title / job id / source id / slot
- local relative image path
- actual dimensions and `sha256`
- status and review status
- attachment/upload status if a downstream script adds it
- fallback text fields for category/status, because select-field APIs can reject option values

## Helper Module

Resolve helper paths relative to this `SKILL.md`:

- `../../scripts/chatgpt-bridge.mjs`
- `../../scripts/inspect-image-dimensions.mjs`

Example use inside the Node-backed browser session after `tab` is selected:

```js
const bridge = await import("/absolute/path/to/chatgpt-bridge/scripts/chatgpt-bridge.mjs");
const before = await bridge.snapshotGeneratedImages(tab, { minWidth: 500, minHeight: 500 });
// send the image-generation prompt in ChatGPT, then wait for the expected count
const generated = await bridge.waitForGeneratedImages(tab, {
  expectedCount: 9,
  beforeImages: before,
  timeoutMs: 600000
});
if (!generated.complete) {
  nodeRepl.write(JSON.stringify(generated, null, 2));
  throw new Error("ChatGPT image batch did not reach the expected count");
}
const result = await bridge.saveImagesFromPageAssets(tab, generated.images, {
  outDir: "/absolute/project/generated-images/my-run",
  prefix: "chatgpt-image",
  expectedCount: 9,
  requestedRatio: "3:4",
  appendManifest: true,
  manifestPath: "/absolute/project/generated-images/my-run/run-manifest.json"
});
nodeRepl.write(JSON.stringify(result, null, 2));
```

### Single vs Batch Lessons

Recent real usage found this split:

- Single-image turns give better control for one key card, but can drift in dimensions and style.
- Batch turns can be faster and more visually consistent for a coherent 6-9 card set.
- Batch success is only export success until reviewed. Keep `Generated`, `Exported`, `Measured`, `Content Reviewed`, and `Approved` separate.
- Use the helper manifest's `validation`, `contentReviewStatus`, and `regenerationQueue` fields to decide what needs a retry.

For a 9-card batch prompt, use a shape like:

```text
Generate exactly NINE independent portrait training-card images in one batch.
Use the same visual system and same character family across all 9.
Do not create one collage, contact sheet, grid, poster, or JSON.
Produce 9 separate image assets.
Do not answer with text, advice, or an outline.
```

If ChatGPT replies with text instead of images, send a short correction:

```text
Please immediately use image generation mode now. Generate the requested image(s). Do not reply with text, advice, JSON, or an outline.
```

## Output Folder Convention

Default to the current project:

```text
<cwd>/generated-images/<short-run-name>/
```

Use simple lowercase slugs for run names. Include a `manifest.json` with:

- prompt hash, with full prompt only when `includePrompt: true` is explicitly appropriate
- generic ChatGPT origin, with a conversation-specific URL only when `includeChatUrl: true` is explicitly appropriate
- saved file paths
- actual pixel dimensions
- file sizes
- SHA256 checksums
- `schemaVersion` and count validation
- requested-vs-actual ratio checks when requested
- campaign/job/source/slot fields when passed
- generated/exported/review status fields
- content review fields such as `contentReviewStatus`, `textLegibility`, `unexpectedEnglishLabels`, `businessInstructionClear`, and `needsRegeneration`
- a `regenerationQueue` for missing outputs, duplicate checksums, ratio mismatches, or content-review failures
- generated-at timestamp
- notes about mismatched requested size if applicable

Temporary ChatGPT asset URLs are redacted from manifests by default. Source URL persistence requires both `includeSourceUrl: true` and the environment variable `CHATGPT_BRIDGE_INCLUDE_SOURCE_URLS=1`; use that only for short-lived local debugging and never share the resulting manifest.

## Reference Images

When the user provides local reference images:

- Confirm the user asked to send those specific files to ChatGPT.
- Use browser-supported upload or clipboard paste.
- After upload, verify the attachments are visible before sending the prompt.
- Record the reference filenames in `manifest.json`.

## Failure Handling

- If ChatGPT is still generating, wait and re-check rather than saving placeholders.
- If fewer images than requested appear, ask ChatGPT to continue only for the missing count.
- If the batch is partial, preserve the manifest/checkpoint and retry only missing job IDs.
- If `pageAssets` misses a DOM-visible image, use the helper export path; it retries inventory, scrolls the image into view, and reports structured missing-asset details.
- If page asset export cannot find an image that is visible, scroll it into view or re-list assets after the image is visible.
- If a browser interaction is blocked by sign-in, CAPTCHA, or account limits, stop and ask the user to handle that step in the browser.
- If the user requests exact 4K, do one retry at most after measuring a lower dimension, then report the measured result honestly.

## Reporting Style

Keep the final response concise:

- say how many images were generated and saved
- link the local output folder
- give actual dimensions when relevant
- mention any images that failed or any requested size mismatch
