# Architecture

```text
User request
  -> Codex skill router
  -> ChatGPT session preflight
  -> conversation action router
     -> new_temporary -> supported one-off text response
     -> new_standard  -> image/research/batch workflow
     -> reuse_current -> context continuation or bounded Retry
     -> blocked       -> visible incompatibility result
  -> Codex in-app browser at chatgpt.com
     -> text response, or
     -> image generation
        -> expected-count waiter
        -> pageAssets original export
        -> dimension/checksum validation
        -> portable manifest + regeneration queue
```

The plugin contains no background service and no API client. Browser control is delegated to Codex's in-app browser capability. The helper module operates on a selected browser tab and local filesystem paths supplied at runtime.

## Main components

- `skills/chatgpt-image-generator/SKILL.md`: orchestration, safety, login, single-image, and batch-image workflow.
- `skills/chatgpt-task-router/SKILL.md`: conservative routing between Temporary Chat, standard chat, current-context reuse, and blocked requests.
- `scripts/chatgpt-bridge.mjs`: session inspection, conversation routing, Temporary Chat preparation, retry-aware waiting, export, validation, and manifest helpers.
- `scripts/inspect-image-dimensions.mjs`: standalone local image inspection.

## Trust boundaries

- Authentication stays between the user and ChatGPT in the browser.
- Reference uploads require an explicit user request.
- Original assets are exported through the browser's page-asset capability.
- Local output paths and prompts are not persisted in shareable manifests unless explicitly enabled.
