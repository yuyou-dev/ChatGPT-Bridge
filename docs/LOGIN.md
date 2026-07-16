# ChatGPT sign-in and privacy

ChatGPT Bridge uses a user's existing ChatGPT web session inside the Codex in-app browser. It does not provide, proxy, or resell a ChatGPT subscription.

## First use

1. Codex opens `https://chatgpt.com/` in the in-app browser.
2. The plugin checks for the ChatGPT message composer.
3. If signed out, Codex asks the user to sign in directly in that browser pane.
4. Passwords, passkeys, CAPTCHA, email verification, and two-factor codes are completed by the user on ChatGPT.
5. After the user confirms completion, the plugin checks for the composer again and continues only when the session is ready.

The plugin recognizes four states:

- `ready`: the ChatGPT composer is visible.
- `signed_out`: sign-in controls or an authentication URL are visible.
- `challenge`: a CAPTCHA or verification challenge is visible.
- `unknown`: the page is not yet ready or cannot be identified safely.

## What the plugin does not access

- Passwords or passkeys.
- One-time codes or CAPTCHA answers.
- Browser cookies or local storage.
- ChatGPT session tokens.

The session may remain signed in because the in-app browser keeps its own browser profile. To revoke it, sign out from ChatGPT in that browser.

## Data sent to ChatGPT

Prompts and any reference files the user explicitly asks to upload are sent to ChatGPT. Do not upload confidential material unless its use is allowed by your organization and by ChatGPT's applicable terms and privacy policy.

## Local manifests

By default, manifests omit the full prompt, conversation-specific URL, absolute local paths, and temporary image URLs. Opt-in debugging flags can expose more data and should not be used in artifacts intended for sharing.
