# Troubleshooting

## The plugin is not available in a task

Run `codex plugin list` and confirm `chatgpt-bridge@chatgpt-bridge` is installed and enabled. Start a new Codex task after installing or updating.

## ChatGPT asks me to sign in

Sign in directly in the Codex in-app browser. Complete passwords, CAPTCHA, passkeys, and two-factor verification yourself. Return to Codex only after the ChatGPT composer is visible.

## ChatGPT replies with text instead of an image

Ask it to immediately use image generation mode and produce the requested image assets without advice, JSON, or an outline.

## Temporary Chat says image generation is unavailable

This is the currently verified ChatGPT product behavior. Do not wait or repeatedly retry. Open a clean standard chat and submit the image request there. The router does this automatically for image tasks.

## ChatGPT shows “Something went wrong” and a Retry button

The waiter detects this state and clicks one unique `Retry` control. It then verifies the intended conversation mode and whether ChatGPT left the original prompt as an unsent draft. If recovery fails again, it returns `retry_exhausted` instead of waiting for the entire generation timeout.

## A 9-image batch stops at 7 images

Do not export it as complete. Keep the partial checkpoint, ask ChatGPT for only the two missing job IDs, and append the exported files to the same manifest.

## The exported image has the wrong dimensions

Downloaded bytes are authoritative. Keep the asset in `Needs Review`, record the ratio mismatch, and regenerate only the affected job.

## A visible image cannot be exported

The helper re-lists page assets and scrolls the image into view. If it still fails, retry after the page settles. Do not navigate directly to temporary image URLs.

## Browser capability is unavailable

ChatGPT Bridge requires the Codex in-app Browser skill and its `pageAssets` capability. Update Codex or enable the Browser capability, then retry in a new task. The plugin intentionally does not fall back to external Chrome automation or an API.
