# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog and versions follow Semantic Versioning.

## [Unreleased]

## [0.2.0] - 2026-07-24

### Added

- Added conservative conversation routing with `new_temporary`, `new_standard`, `reuse_current`, and `blocked` actions.
- Added Temporary Chat state inspection, verified activation, and automatic fallback rules.
- Added retryable response-error detection and one bounded Retry recovery with mode/draft verification.
- Added a reproducible routing benchmark covering explicit overrides, context reuse, research, campaigns, image capability boundaries, ambiguity, and retry behavior.

### Changed

- Image-generation requests now use clean standard chats because the verified ChatGPT Temporary Chat surface reports that image-generation tools are unavailable.
- Image waiting now exits early on retry exhaustion or unsupported capabilities instead of polling until the full timeout.

## [0.1.1] - 2026-07-17

### Security

- Prevented output writes through pre-existing symbolic links.
- Removed absolute paths from ratio-mismatch and regeneration-queue manifest branches.
- Stopped persisting prompt fingerprints by default and reduced session inspection data.

### Fixed

- Included governance and documentation files in marketplace release packages.
- Added release tag/version validation and broader public-data scanning.

## [0.1.0] - 2026-07-17

### Added

- Initial open-source release under the ChatGPT Bridge name.
- Safe first-run ChatGPT session inspection and user-controlled sign-in guidance.
- Single-image and coherent batch generation workflows through the Codex in-app browser.
- Expected-count waiting, original page-asset export, dimension and checksum validation.
- Appendable manifests, content review fields, and regeneration queues.
- Privacy-safe manifests and output filename traversal protection.
- Marketplace and standalone release packages.
