# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Development setup

1. Install Node.js 20 or newer.
2. Clone the repository.
3. Run the full local gate:

   ```bash
   npm run check
   ```

4. Sync the working plugin into a local global target:

   ```bash
   npm run sync:global -- --target=/path/to/global/chatgpt-bridge
   ```

5. Reinstall that local build through the marketplace or plugin-development flow
   available in your Codex environment, then start a new Codex task. Confirm the
   loaded plugin version from `plugins/chatgpt-bridge/.codex-plugin/plugin.json`
   before testing.

## Pull requests

- Keep changes focused and include tests for helper behavior.
- Do not commit generated images, ChatGPT conversation URLs, temporary asset URLs, credentials, cookies, or local absolute paths.
- Explain browser compatibility assumptions and failure recovery behavior.
- For image workflow changes, report generated count, exported count, measured dimensions, and review status separately.

## Release process

1. Update `CHANGELOG.md` and the plugin version.
2. Run `npm run check` and `npm run package`.
3. Tag the commit as `vX.Y.Z`.
4. Push the tag. The release workflow validates the plugin and uploads both ZIP packages.
