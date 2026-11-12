# wan30

D client for a [wan30.video](https://wan30.video/) account. It speaks the same
Streamable HTTP MCP endpoint as `@wan30/cli` 0.1.0: `POST {origin}/api/mcp/`.

Purchased wan30.video credits are required for generation. Sign-up, check-in
and gift credits alone do not qualify. `estimate` does not spend credits.
`generate` does not call the service unless `confirmSpend` is `true`, and that
flag is not sent in the request. Pass the same `requestId` on a retry.

This is not an official Alibaba, DashScope, or Tongyi client. It does not
depend on the Python package, which is not on PyPI yet.

```d
import std.json : parseJSON;
import wan30;

auto client = Wan30Client.fromEnvironment();
auto input = parseJSON(`{
    "modelId": "wan30-text-to-video",
    "prompt": "A paper boat on a rainy street"
}`);
auto quote = client.estimate(input);
auto task = client.generate(input, "paper-boat-request01", true);
```

`fromEnvironment` reads `WAN30_ACCESS_TOKEN` and optional `WAN30_ORIGIN` from
the process environment. It does not read `.env` files or a credential store.
Sign in with the existing Wan30 CLI, then export the token into the process.
You can also construct `Wan30Client` with a token and an injected HTTP
delegate. The default delegate uses `std.net.curl` and does not follow
redirects. `disconnect` posts to `{origin}/api/mcp/disconnect/` with only the
bearer token and an empty body. HTTP 401 from that call is
`REVOCATION_UNCONFIRMED`, not a fresh sign-in error. `close` only drops the
local session.

Models are `wan30-reference-to-video`, `wan30-text-to-video`, and
`wan30-image-to-video`. Omitted optional fields are not filled in by the client.

## DUB registry

This directory is a normal DUB library: `dub.json` names the package `wan30`,
versioning comes from a git tag, and there are no dependencies. `dub build`
and `dub test` run from this directory.

code.dlang.org registers a GitHub, GitLab, or Bitbucket project and reads
`dub.json` from the root of semver tags named `vX.Y.Z`. It does not register a
subdirectory of a monorepo as its own package. Subpackages exist only when the
repository root recipe lists them, and they are published as `root:child`
under that one registration. This monorepo's root is the JavaScript CLI, and
this change does not add a root recipe.

The registered Wan27 package uses the same rule: its repository is the
dedicated project `NotUsingGithub/wan27-d`, not a folder inside another
repository. `GET https://code.dlang.org/packages/wan30` was not found on
2026-11-11. This pull request does not register that name.

To publish later, without doing it from this monorepo:

1. Put this directory's contents at the root of a dedicated Git repository.
   The zip `wan30-0.1.0-d.zip` is that root.
2. Sign in to https://code.dlang.org with the GitHub account that will own
   that repository. Do not create a new account for this pull request.
3. Register the package from that GitHub owner and project name.
4. Push a tag named `v0.1.0` on that repository. The registry looks for new
   tags about twice an hour. A tag on `NotUsingGithub/wan30-mcp` does not
   publish `packages/dlang`.

Do not commit an access token.
