# ChatGPT Bridge

[![CI](https://github.com/yuyou-dev/ChatGPT-Bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/yuyou-dev/ChatGPT-Bridge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/yuyou-dev/ChatGPT-Bridge)](https://github.com/yuyou-dev/ChatGPT-Bridge/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

ChatGPT Bridge is an open-source Codex plugin that uses your own signed-in ChatGPT web session in the Codex in-app browser to generate images and export the original assets into your local project.

It does not use an OpenAI API key, collect credentials, or copy browser cookies. You sign in directly on `chatgpt.com` inside the in-app browser.

[中文说明](README.zh-CN.md)

## What it does

- Generates one image or a coherent batch of up to 9 independent images through ChatGPT.
- Waits for the expected number of fresh images instead of accepting a partial batch.
- Exports original page assets rather than screenshots.
- Measures real dimensions and computes SHA-256 checksums.
- Detects missing outputs, duplicate files, ratio mismatches, and review failures.
- Writes appendable manifests and a regeneration queue.
- Separates `Generated`, `Exported`, `Measured`, `Needs Review`, and `Approved` states.
- Guides first-time users through safe ChatGPT sign-in in the Codex in-app browser.

## Install from GitHub

Requirements:

- Codex desktop with plugin and in-app browser support.
- A ChatGPT account. Image availability and limits depend on that account's plan and current ChatGPT product behavior.
- Node.js 20 or newer for local helper scripts and development.
- The `zip` command when building release packages locally. GitHub-hosted Linux runners already provide it.

Add this repository as a Codex marketplace, then install the plugin:

```bash
codex plugin marketplace add yuyou-dev/ChatGPT-Bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

Start a new Codex task after installation so the new skill is loaded.

## First sign-in

Ask Codex:

```text
Use ChatGPT Bridge to generate one image and save the original locally.
```

ChatGPT Bridge opens `https://chatgpt.com/` in the Codex in-app browser and checks whether the message composer is available.

If you are signed out:

1. Sign in to your own ChatGPT account directly in the in-app browser.
2. Complete password, passkey, CAPTCHA, or two-factor verification yourself on ChatGPT.
3. Return to Codex and say that sign-in is complete.
4. The plugin verifies that the composer is visible before it continues.

Never send a password or one-time code to Codex. The plugin does not read or export cookies, local storage, passwords, passkeys, or session tokens. See [ChatGPT sign-in and privacy](docs/LOGIN.md).

## Example requests

```text
Use ChatGPT to generate a 3:4 editorial jewelry poster and save the original locally.
```

```text
Generate exactly 9 independent training cards in one coherent visual system. Do not make a collage. Export all originals and report their actual dimensions.
```

```text
Use this reference image in ChatGPT, generate three independent variations, and keep each result in Needs Review until I approve it.
```

## Output

```text
generated-images/my-run/
  image-01.png
  image-02.png
  manifest.json
```

The manifest includes counts, actual dimensions, requested ratio checks, checksums, job metadata, review status, and a regeneration queue. Temporary ChatGPT asset URLs are redacted by default.

## Update

Refresh the Git marketplace snapshot and reinstall the plugin:

```bash
codex plugin marketplace upgrade chatgpt-bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

Start a new Codex task after updating.

To uninstall:

```bash
codex plugin remove chatgpt-bridge@chatgpt-bridge
codex plugin marketplace remove chatgpt-bridge
```

## Release packages

Each GitHub release contains:

- `chatgpt-bridge-plugin-vX.Y.Z.zip`: the standalone plugin directory.
- `chatgpt-bridge-marketplace-vX.Y.Z.zip`: a local marketplace bundle that can be extracted and added with `codex plugin marketplace add /path/to/extracted-folder`.

The Git marketplace command above is the recommended installation method.

## Development

```bash
npm test
npm run validate
npm run package
```

Repository layout:

```text
.agents/plugins/marketplace.json
plugins/chatgpt-bridge/
  .codex-plugin/plugin.json
  skills/chatgpt-image-generator/SKILL.md
  scripts/chatgpt-bridge.mjs
scripts/
tests/
```

See [Architecture](docs/ARCHITECTURE.md), [Troubleshooting](docs/TROUBLESHOOTING.md), [Contributing](CONTRIBUTING.md), and [Security](SECURITY.md).

## Privacy and product boundaries

- Prompts and uploaded references are sent to ChatGPT because generation happens on `chatgpt.com`.
- Local manifests omit prompt text, conversation-specific URLs, absolute paths, and temporary image URLs by default. Explicit debug options can include sensitive details, so review manifests before sharing.
- This project is unofficial and is not affiliated with or endorsed by OpenAI.
- ChatGPT, OpenAI, and related marks belong to their respective owners. Use of ChatGPT is subject to its own terms, privacy policy, account limits, and availability.

## License

MIT. See [LICENSE](LICENSE).
