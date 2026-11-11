# Wan30 MCP and CLI

This extension connects Visual Studio Code to the official Wan30 command-line
client. It registers a local stdio MCP server and can run read-only CLI
commands when you ask it to. It does not generate videos.

The npm package is `@wan30/cli`. The server command is `npx -y @wan30/cli mcp`.
Node.js 22 or newer is required, on macOS or Linux, including WSL. Native
Windows is not supported.

Generation on Wan30 spends purchased credits. Sign-up, check-in, and gift credits alone do not qualify. This extension is not affiliated with Alibaba.
It does not store access tokens, and it does not run `npx` when it activates.

## Local MCP server

VS Code asks this extension for its MCP server definition. The definition is
the official stdio command above, with no added environment variables. VS Code
does not run that command until it needs to start the server. Before the
process starts, the extension checks the platform and Node.js version, then
asks you to confirm.

The server exposes the seven hosted tools: `account_status`, `list_models`,
`get_model`, `estimate_generation`, `generate_video`, `list_tasks`, and
`get_task`. `generate_video` spends purchased credits. This extension never
calls it. Sign in with the CLI before using a tool that needs your account.

## Commands

- **Wan30: Sign In with CLI** opens a terminal with a fixed login command.
  On Linux the command is `npx -y @wan30/cli auth login --credential-store file`.
  On macOS it is `npx -y @wan30/cli auth login`. The CLI stores the
  credentials. This extension does not read them.
- **Wan30: Show Account** runs `npx -y @wan30/cli account`.
- **Wan30: List Models** runs `npx -y @wan30/cli models`.
- **Wan30: Estimate Credits** asks you to choose a JSON file, then runs
  `npx -y @wan30/cli estimate --input` with that path as one argument. An
  estimate does not create a video.
- **Wan30: Add Workspace MCP Configuration** can write `.vscode/mcp.json`
  after a confirmation. Other servers and settings are kept. If the same
  official entry is already present, the file is not rewritten. Invalid JSON
  is left unchanged. A different existing `wan30` entry is replaced only
  after a second, explicit confirmation, and its environment values are not
  copied.
- **Wan30: Open Documentation** opens one of the official pages you choose.

Example estimate input:

```json
{
  "modelId": "wan30-text-to-video",
  "prompt": "A slow camera pan across a forest lake in morning light.",
  "durationSeconds": 5,
  "resolution": "480p"
}
```

## Documentation

- [Wan30 website](https://wan30.video/)
- [MCP setup](https://wan30.video/mcp/)
- [CLI](https://wan30.video/cli/)
- [Usage guide](https://wan30.video/mcp/guide/)
- [Credit packs](https://wan30.video/pricing/)
- [Source](https://github.com/NotUsingGithub/wan30-mcp)

The extension is MIT licensed. Video generation is a separate service at
wan30.video and requires purchased credits.
