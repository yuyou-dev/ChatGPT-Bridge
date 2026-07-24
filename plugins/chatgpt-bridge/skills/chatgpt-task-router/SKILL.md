---
name: chatgpt-task-router
description: Use when the user asks Codex to bridge a task to ChatGPT, use ChatGPT Temporary Chat for a small one-off task, continue an existing ChatGPT conversation, or decide whether a ChatGPT task needs persistent context.
---

# ChatGPT Task Router

Use this skill before sending a general task to ChatGPT through the Codex in-app browser.

This skill does not use an API and does not collect credentials. Use `browser:control-in-app-browser`, open `https://chatgpt.com/`, and run the session preflight from `../../scripts/chatgpt-bridge.mjs`.

## Route Before Sending

Call:

```js
const bridge = await import("/absolute/path/to/chatgpt-bridge/scripts/chatgpt-bridge.mjs");
const decision = bridge.classifyChatGPTConversationMode({
  text: userRequest,
  imageCount,
  newReferenceImageCount,
  requiresExistingConversation,
  requiresExistingAttachments,
  needsFutureContinuation,
  needsUserIteration,
  researchMode,
  productionMode
});
```

Use the returned action:

- `new_temporary`: open and verify Temporary Chat, then send the one-turn task.
- `new_standard`: open a clean standard chat.
- `reuse_current`: keep the current conversation and verify that it is the intended context.
- `blocked`: stop and explain the conflict.

Perform routing before uploading files or sending a prompt.

## Conservative Rules

- Small one-off text tasks can use Temporary Chat: concise rewrite, translation, extraction, classification, formatting, or a short answer that does not need history.
- Image generation uses a clean standard chat. The verified ChatGPT Temporary Chat surface currently reports that image-generation tools are unavailable.
- Three or more images, research, campaigns, multi-step work, and user-led iteration use a clean standard chat.
- Existing history or attachments require `reuse_current`.
- Ambiguous tasks use a clean standard chat.
- Explicit Temporary Chat plus required existing history/attachments is a conflict and must not silently fall back.

## Retry Recovery

If ChatGPT shows a retryable response error:

1. Inspect the response state.
2. Click a unique `Retry` control at most once.
3. Re-verify the intended conversation mode.
4. If ChatGPT returned to a blank composer with the original prompt still present, restore the intended mode and submit that recovered draft once.
5. Stop on a second failure.

For image waiting, `waitForGeneratedImages` implements this bounded recovery and reports:

- `terminalState`
- `retryCount`
- `errors`
- `recoveryActions`

Do not keep polling when `terminalState` is `retry_exhausted`, `error`, or `unsupported_capability`.

## Account Safety

If ChatGPT is signed out or presents a CAPTCHA, passkey, two-factor, or security challenge, leave the in-app browser open and ask the user to complete it there. Never request or copy passwords, cookies, tokens, or one-time codes.
