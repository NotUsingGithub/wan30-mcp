# Wan30 Video (`wan30-video-generator`)

Obsidian plugin for a [wan30.video](https://wan30.video/) account. It speaks the same Streamable HTTP MCP endpoint as the Wan30 command line client: `POST {origin}/api/mcp/`.

Purchased wan30.video credits are required for generation. Sign-up, check-in, and gift credits alone do not qualify. Estimate does not create a video. Generation stays off until you turn on **Spend purchased credits** for the quote you just saw. That confirmation is local and is not sent. The request contains `input` and `requestId` only.

This is not an official Alibaba, DashScope, or Tongyi client. There is no image-generation tool. The plugin does not read `.env` files or a credential store, and it does not follow redirects.

Authors: Wan30 and NotUsingGithub. MIT license.

## Commands

- **Show account status** calls `account_status`.
- **List models** calls `list_models`.
- **Show model input** calls `get_model` for `wan30-text-to-video`, `wan30-image-to-video`, or `wan30-reference-to-video`.
- **Estimate video** calls `estimate_generation` and stops.
- **Generate video into this note** estimates first, then waits for the spend toggle. Only the toggled action calls `generate_video`. It then polls `get_task` until `SAVED_TO_R2`, `COMPLETED`, or `FAILED`. A wait timeout does not cancel the task.
- **Show recent tasks** calls `list_tasks` with limit 20.
- **Read a task** calls `get_task`.
- **Insert MCP configuration** inserts the local stdio config for `@wan30/cli`. It does not contain an access token.

Optional fields that you leave blank are not sent. Image and reference models take HTTPS URLs you already have. There is no upload command.

The CLI behind the inserted config needs Node.js 22 or newer, on macOS or Linux, including WSL. Native Windows is not supported.

## Setup

1. Sign in with the [Wan30 CLI](https://wan30.video/cli/) and copy the access token yourself.
2. In Obsidian, open **Settings → Wan30 Video** and paste the token. Set the service origin only if it is an exact HTTPS origin. The default is `https://wan30.video`.

Network calls use Obsidian `requestUrl` and go only to `{origin}/api/mcp/` or `{origin}/api/mcp/disconnect/`.

## Manual install

This ZIP is a manual install, not a community listing. Unzip it so these files sit together:

`<vault>/.obsidian/plugins/wan30-video-generator/manifest.json`
`<vault>/.obsidian/plugins/wan30-video-generator/main.js`
`<vault>/.obsidian/plugins/wan30-video-generator/styles.css`

Reload Obsidian and enable **Wan30 Video**. Build the ZIP from this repository with:

```sh
node packages/obsidian/test/run.mjs
node packages/obsidian/package.mjs
```

`package.mjs` writes `/opt/cursor/artifacts/wan30-video-generator-0.1.0.zip` and a sibling `.sha256` file. The archive contains only `manifest.json`, `main.js`, and `styles.css`. SHA-256 of this source's archive is `bb0482fc2ce338c6c872aa8e9068b21db141ae0460c5496789824149ddf9e65e`. `packages/obsidian/package.json` sets `"type": "commonjs"` so the tests can load `main.js` inside this monorepo. It is not a release asset.

## Community directory

A folder inside this monorepo is not an Obsidian community listing. Official submission reads the plugin from the root of its own GitHub repository, then downloads release assets. The steps below are prerequisites. This pull request does not do them.

1. The plugin source has to be on the default branch of a public GitHub repository whose root contains `README.md`, `LICENSE`, and `manifest.json`. `packages/obsidian/` in `NotUsingGithub/wan30-mcp` does not meet that layout. Do not submit this monorepo URL as the plugin repository.
2. Create a GitHub release on that plugin repository. The tag must be exactly `0.1.0`, with no `v` prefix, because it must match `manifest.json` `version`.
3. Attach `main.js`, `manifest.json`, and `styles.css` to that release. Obsidian downloads those three files from the release. It uses the repository `manifest.json` to find the version.
4. `versions.json` belongs at the root of that same repository. Obsidian consults it only when the installed app is older than `minAppVersion`. It is not a substitute for the release.
5. Submit at [community.obsidian.md](https://community.obsidian.md) with the Obsidian account that owns the plugin, after linking GitHub. The directory checks the `id` `wan30-video-generator` for uniqueness. The id cannot contain `obsidian` and cannot end with `plugin`. The display name cannot contain `Plugin` or `Obsidian`.

Until those steps are done, `wan30-video-generator` will not appear in Obsidian's community browser.

## Links

- [Wan30](https://wan30.video/)
- [MCP](https://wan30.video/mcp/)
- [Usage guide](https://wan30.video/mcp/guide/)
- [CLI](https://wan30.video/cli/)
- [Credit packs](https://wan30.video/pricing/)
- [Source](https://github.com/NotUsingGithub/wan30-mcp)
