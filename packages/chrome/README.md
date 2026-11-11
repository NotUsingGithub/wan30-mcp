# Wan30 MCP Setup

Chrome extension that copies the official Wan30 stdio MCP configuration and CLI commands. It does not run those commands, generate video, collect an access token, or contact wan30.video.

The store-facing name is **Wan30 MCP Setup**. It is a setup helper for the MIT-licensed `@wan30/cli` client published by Wan30 / NotUsingGithub. It is not a local video model, not a free video service, and not affiliated with Alibaba.

Video generation on [wan30.video](https://wan30.video/) requires remaining purchased credits. Sign-up, check-in, and gift credits alone do not qualify. The copied commands need Node.js 22 or newer on macOS or Linux, including WSL. Native Windows is not supported.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this `packages/chrome` directory.

The popup lets you choose where the CLI will run, check that a service origin is an exact HTTPS origin, copy setup text, and open the official docs when you click a link. The default origin is `https://wan30.video`.

## Checks

From the repository root:

```sh
node --test packages/chrome/test/*.test.mjs
```

Build the Chrome Web Store zip, with `manifest.json` at the root of the archive:

```sh
node packages/chrome/package.mjs wan30-mcp-setup-0.1.0.zip
```

Store listing text and the privacy disclosure are in `STORE.md` and `PRIVACY.txt`. Chrome Web Store review is a separate decision. Nothing in this directory submits a listing or means a listing will be accepted.
