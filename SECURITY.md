# Security Policy

## Supported versions

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for this repository. Do not open a public issue containing credentials, session URLs, temporary asset URLs, or account details.

## Credential boundary

ChatGPT Bridge must never collect or automate passwords, passkeys, CAPTCHA answers, one-time codes, cookies, local storage, or session tokens. Users complete authentication directly on `chatgpt.com` in the Codex in-app browser.

## Sensitive artifacts

Manifests omit prompts, conversation-specific URLs, absolute paths, and temporary asset URLs by default. Review generated manifests before publishing them.
