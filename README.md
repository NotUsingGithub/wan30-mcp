# Wan30 MCP and CLI — Wan 3.0 AI Video Generation

Generate Wan 3.0 videos from your terminal or AI assistant with your
[wan30.video](https://wan30.video/) account. MCP and CLI spend the same credit
balance as the website, at the same prices. Credits are bought on the website.

**Access requires remaining purchased credits.** Sign-up, check-in and gift
credits alone do not qualify. Buy credits at https://wan30.video/pricing/.

Node 22+, macOS or Linux (including WSL).

## Install

```sh
npm install -g @wan30/cli
```

## Use

```sh
wan30 auth login
wan30 account
wan30 models
wan30 estimate --input request.json
wan30 create --input request.json --wait
wan30 download <taskId> --output result.mp4
wan30 auth logout
```

On Linux, sign in with `wan30 auth login --credential-store file`.

`request.json` examples. Text to video:

```json
{"modelId":"wan30-text-to-video","prompt":"A paper boat on a rainy street","durationSeconds":5,"resolution":"720p"}
```

Image to video, with one HTTPS image as the first frame:

```json
{"modelId":"wan30-image-to-video","prompt":"The crane takes off","imageUrls":["https://example.org/first-frame.jpg"]}
```

Reference to video, with 1–10 HTTPS reference images:

```json
{"modelId":"wan30-reference-to-video","prompt":"Move the camera slowly toward the scene","imageUrls":["https://example.org/reference.jpg"]}
```

Every mode takes 2–30 seconds and 480p, 720p or 1080p. The default is 5
seconds at 480p. `wan30 model <modelId>` prints every option as a JSON Schema.

`create` prints a request ID on stderr. Re-running it with
`--request-id <id>` after a network error returns the same task and is never
charged twice. A `wait` timeout only stops waiting; the task keeps running.

Credentials are stored in the macOS Keychain, or with
`--credential-store file` in a private file (directory 0700, file 0600).
`WAN30_CONFIG_DIR` changes that directory. `WAN30_ACCESS_TOKEN` accepts a
pre-issued access token for automation. Logging out revokes this connection;
changing your website password revokes every connection.

## Connect an assistant (local MCP)

Sign in once with `wan30 auth login`, then register the stdio server:

```sh
codex mcp add wan30 -- wan30 mcp
claude mcp add wan30 -- wan30 mcp
```

Tools: `account_status`, `list_models`, `get_model`, `estimate_generation`,
`generate_video`, `list_tasks`, `get_task`.

Clients that accept JSON configuration can launch the same stdio server with
npx:

```json
{
  "mcpServers": {
    "wan30": {
      "command": "npx",
      "args": ["-y", "@wan30/cli", "mcp"]
    }
  }
}
```

The server starts and lists its tools before you sign in. A tool call made
without a sign-in tells the assistant to run `wan30 auth login`; no restart is
needed afterwards.

Read the account status and estimate the cost before generating. Video
generation spends your website credits.

## JavaScript Registry

`@notusinggithub/wan30` exports this repository's `WanClient` and the same
seven MCP tools for JSR. The npm command remains `@wan30/cli`. Node.js 22 or
newer. Generation uses your wan30.video account. Purchased credits are
required. Sign-up, check-in, and gift credits alone do not qualify.

After 0.1.0 is published:

```sh
npx jsr add @notusinggithub/wan30
```

```js
import { WanClient, TOOLS } from "@notusinggithub/wan30";

const wan = new WanClient({
  getToken: async () => {
    const token = process.env.WAN30_ACCESS_TOKEN;
    if (!token) throw new Error("WAN30_ACCESS_TOKEN is required.");
    return token;
  },
});
console.log(await wan.account());
console.log(TOOLS.map((tool) => tool.name));
```

The module does not read the CLI credential store or open a browser. Sign in
with `wan30 auth login`, or pass an existing access token from the server
environment. Do not put tokens in browser code. `account()` and `estimate()`
do not create a video. `generate()` spends purchased credits.

Check the package without uploading it:

```sh
npx jsr publish --dry-run
```

Publishing sends the package to JSR and asks the `@notusinggithub` scope owner
to approve it in a browser.

## Documentation and support

- [Wan30 website](https://wan30.video/)
- [MCP setup and client instructions](https://wan30.video/mcp/)
- [CLI installation](https://wan30.video/cli/)
- [MCP and CLI usage guide](https://wan30.video/mcp/guide/)
- [Credit packs](https://wan30.video/pricing/)
- [Issue tracker](https://github.com/NotUsingGithub/wan30-mcp/issues)

## License

MIT. The hosted generation service is operated at wan30.video.
