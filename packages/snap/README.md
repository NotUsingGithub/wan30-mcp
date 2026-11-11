# wan30 snap

Command line client for a [wan30.video](https://wan30.video/) account. The
snap command `wan30` speaks the same Streamable HTTP MCP endpoint as the
Wan30 command line client: `POST {origin}/api/mcp/`.

Purchased wan30.video credits are required for generation. Sign-up, check-in
and gift credits alone do not qualify. `estimate` does not spend credits.
`generate` does not call the service unless `--confirm-spend` is present,
and that flag is not sent. Pass the same `--request-id` on a retry.

This is not an official Alibaba, DashScope, or Tongyi client. It does not
depend on the Python package. It does not read `.env` files or a credential
store. The token comes from `--token` or `WAN30_ACCESS_TOKEN`. The origin
comes from `--origin`, `WAN30_ORIGIN`, or `https://wan30.video`.

```bash
wan30 estimate --input generation.json
wan30 generate --input generation.json --request-id paper-boat-request01 --confirm-spend
```

`generation.json` uses the published field names. Omitted optional fields are
not filled in. Strict confinement uses the `network` and `home` interfaces, so
`--input` has to be under the home directory after the snap is installed.

## Snap Store

Checked read-only on 2026-11-11:

- `https://snapcraft.io/wan27` is published. Package name `wan27`, version
  `0.1.0`, revision 1, strict confinement, base `core22`, license MIT.
  Publisher username `niu-wan27` (display name Wan27). Source repository
  `https://github.com/NotUsingGithub/wan27-snap`, which is a root Go module
  packed with `mksquashfs`. Its recipe is `snap/snapcraft.yaml` at that
  repository root.
- `https://api.snapcraft.io/v2/snaps/info/wan30` returned 404
  `No snap named 'wan30'`. The same is true for `wan30-cli` and `wan30-mcp`.
  A name can still be reserved without a public revision; that is only
  visible to a logged-in store account, and this package was not registered.
- `https://snapcraft.io/publisher/notusinggithub` exists and lists 0 snaps.
  `https://github.com/NotUsingGithub/wan30-snap` was not found.

The Snap Store name chosen here is `wan30`. It matches the published `wan27`
name shape: ASCII, one letter, lower case, at most 40 characters, and it is
not a published name.

`snapcraft upload` publishes a `.snap` file. It does not require a dedicated
repository. Build from GitHub, documented by Canonical on
`build.snapcraft.io`, only detects `snapcraft.yaml`, `snap/snapcraft.yaml`,
or `.snapcraft.yaml` at the root of the linked repository. This recipe lives
at `packages/snap/snap/snapcraft.yaml`, so linking `wan30-mcp` would not see
it. A separate repository is required only for that automatic builder. It is
not required to register `wan30` and upload the packed file.

Nothing here registers the name, logs in, or uploads. `./build.sh` runs the
tests and packs `build/wan30_0.1.0_amd64.snap` and
`build/wan30_0.1.0_arm64.snap` with `mksquashfs`, which is how `wan27` was
packed. From this directory, `snapcraft pack` uses `snap/snapcraft.yaml`.

Do not commit an access token.
