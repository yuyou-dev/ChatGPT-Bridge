# ChatGPT Bridge plugin

This directory is the distributable Codex plugin. The plugin identifier is `chatgpt-bridge`; the user-facing name is ChatGPT Bridge.

The plugin opens ChatGPT in the Codex in-app browser, verifies that the user is signed in, coordinates single-image or batch-image generation, exports original page assets, and writes measured, review-ready manifests.

It does not use an OpenAI API key or collect credentials. Users sign in directly on `chatgpt.com` inside the Codex in-app browser. Passwords, passkeys, CAPTCHA, and two-factor verification are always completed by the user on ChatGPT.

After installing, start a new Codex task and ask it to use ChatGPT Bridge to generate one or more images. The plugin verifies the browser session, waits for the expected image count, exports original page assets, and writes a privacy-safe manifest with real dimensions and checksums.

This standalone package is distributed under the MIT License. The canonical source and full documentation are available at `https://github.com/yuyou-dev/ChatGPT-Bridge`.
