# wan30

R client for a [wan30.video](https://wan30.video/) account. It speaks the same
Streamable HTTP MCP endpoint as the Wan30 command line client:
`POST {origin}/api/mcp/`.

Purchased wan30.video credits are required for generation. Sign-up, check-in
and gift credits alone do not qualify. `wan30_estimate()` does not spend
credits. `wan30_generate()` does not call the service unless `confirm_spend`
is exactly `TRUE`, and that flag is not sent. Pass the same `request_id` on
a retry.

This is not an official Alibaba, DashScope, or Tongyi client, and it is not
on CRAN. It does not depend on the Python package.

```r
client <- wan30_client()
input <- list(
  modelId = "wan30-text-to-video",
  prompt = "A paper boat on a rainy street"
)
wan30_estimate(client, input)
wan30_generate(
  client,
  input,
  request_id = "paper-boat-request01",
  confirm_spend = TRUE
)
```

`wan30_client()` reads `WAN30_ACCESS_TOKEN` and, when `origin` is omitted,
`WAN30_ORIGIN` from the process environment. It does not read `.env` files
or a credential store. The default HTTP handler uses the curl package and
does not follow redirects.

R requires a maintainer address in `DESCRIPTION`. The public NotUsingGithub
profile publishes no email, so the address is that account's GitHub noreply
identity (`66665951+NotUsingGithub@users.noreply.github.com`). It is not a
monitored mailbox. Use the GitHub issues link for reports.

`wan30_disconnect()` posts an empty body to `{origin}/api/mcp/disconnect/`
with only the bearer token. HTTP 401 from that call is
`REVOCATION_UNCONFIRMED`. `wan30_close()` only drops the local session.

Models are `wan30-reference-to-video`, `wan30-text-to-video`, and
`wan30-image-to-video`. Omitted optional fields are not filled in.

## R-universe

Checked on 2026-11-11, read only:

- `https://notusinggithub.r-universe.dev/api/ls` lists only `wan27` 0.1.0.
  Its `RemoteUrl` is `https://github.com/NotUsingGithub/wan27-r` and it has
  no `RemoteSubdir`. The registry file
  `https://github.com/NotUsingGithub/notusinggithub.r-universe.dev/blob/main/packages.json`
  contains that one repository and no subdirectory.
- `https://github.com/NotUsingGithub/universe` was not found. The current
  registry name is `notusinggithub.r-universe.dev`.
- CRAN has no `wan27` or `wan30` package. R-universe search for `wan30`
  returned no results. `https://github.com/NotUsingGithub/wan30-r` was not
  found.
- `https://github.com/NotUsingGithub/wan30` exists and is a community README
  for wan30.video. It is not an R package and this client does not use it.

R-universe builds a public Git URL. Official setup docs say the build runs
`git clone` on `packages.json` `url`, the `package` field must match the
`DESCRIPTION` name, and `subdir` is required when the package is not at the
repository root. The default branch is what gets built unless `branch` names
another ref. An entry can therefore point at this monorepo:

```json
{
  "package": "wan30",
  "url": "https://github.com/NotUsingGithub/wan30-mcp",
  "subdir": "packages/r"
}
```

That entry is not in the registry. This pull request does not edit
`notusinggithub.r-universe.dev`, create a repository, or publish. A separate
R repository is not required by the documented `subdir` field. The code has
to be on the default branch `main` of `wan30-mcp` before a registry entry
would build it. This branch is not that default branch.

Do not commit an access token.
