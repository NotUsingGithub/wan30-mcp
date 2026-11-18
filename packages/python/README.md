# wan30

Python client for a [wan30.video](https://wan30.video/) account. It speaks the
same Streamable HTTP MCP endpoint as `@wan30/cli` 0.1.0:

`https://wan30.video/api/mcp/`

Account, models, estimates, task history, and explicit opt-in generation use
the hosted tools `account_status`, `list_models`, `get_model`,
`estimate_generation`, `generate_video`, `list_tasks`, and `get_task`.

**Access requires remaining purchased credits.** Sign-up, check-in and gift
credits alone do not qualify. Buy credits at <https://wan30.video/pricing/>.

This package is published by Wan30 and NotUsingGithub. It is not an official
Alibaba, DashScope, or Tongyi client, and it does not call those APIs.

## Install

```sh
pip install wan30
```

Python 3.10 or newer. The client has no runtime dependencies.

## Use

```python
from wan30 import WanClient

client = WanClient.from_environment()
print(client.account())
print(client.models())

request = {
    "modelId": "wan30-text-to-video",
    "prompt": "A slow camera pan across a forest lake in morning light.",
    "durationSeconds": 5,
    "resolution": "480p",
}
print(client.estimate(request))

# This is the only call that can spend credits. Reuse request_id after a
# network error; the service treats that id as idempotent.
task = client.generate(request, request_id="forest-lake-shot-001", confirm_spend=True)
print(client.task(task["taskId"]))
```

`generate` raises `SPEND_NOT_CONFIRMED` and does not open a connection unless
`confirm_spend` is exactly `True`.

Image to video sends one HTTPS URL in `imageUrls`. Reference to video sends
1–10 HTTPS URLs. Durations are 2–30 seconds. Resolutions are `480p`, `720p`,
and `1080p`. The service default, when you omit a field, is 5 seconds at
`480p`. `model(model_id)` returns that model's input schema.

## Sign in

`WAN30_ACCESS_TOKEN` uses a bearer token you already have. Leave it unset for
the file store:

```python
from wan30 import CredentialManager, WanClient

credentials = CredentialManager()  # ~/.wan30 or WAN30_CONFIG_DIR
credentials.login()                 # browser, loopback port 8787
client = WanClient.from_credentials(credentials)
```

The OAuth client id is the public CLI client `wan30-cli`, with PKCE S256 and
resource `{origin}/api/mcp`. The file format matches `wan30 auth login
--credential-store file`: directory mode `0700`, file mode `0600`. This
package does not read the macOS keychain. A refresh is marked uncertain
before it is sent and is not reused after a lost response. `slow_down` with
`refresh_token_unchanged` is the only case that clears that mark.

`WAN30_ORIGIN` overrides the default `https://wan30.video`. The value must be
an exact `https` origin, with no path, userinfo, or trailing slash.

## Tasks and downloads

```python
print(client.tasks(limit=20))
finished = client.wait(task["taskId"])  # a timeout does not cancel the task
client.download(task["taskId"], "lake.mp4")
```

`wait` polls `get_task` until `SAVED_TO_R2`, `COMPLETED`, or `FAILED`.
Download URLs are fetched without the access token. An existing file is not
overwritten. Accepted media types are `image/png`, `image/jpeg`,
`image/webp`, and `video/mp4`.

## Limits

- Synchronous client. Tool calls time out after 300 seconds; initialize uses
  60 seconds. A timeout does not prove the generation did not start: retry
  `generate` with the same `request_id`.
- POST responses are accepted as JSON or SSE. The optional MCP GET event
  stream is not opened. HTTP redirects on the API are not followed.
- Local JWT checks only confirm the claim shape (`sub`, `grant_id`, `aud`).
  The server still verifies the signature.
- Prices and the live model list come from the service. This client does not
  hard-code a price table.
- The terminal product remains `npm install -g @wan30/cli`.

## Publishing

Names on PyPI: `wan30` and `langchain-wan30`. The upload account is
`notusinggithub`. See [PUBLISHING.md](../PUBLISHING.md). This repository
does not publish on merge.
