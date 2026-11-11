# Wan30 ComfyUI nodes

Nodes for a [wan30.video](https://wan30.video/) account. They call the same
hosted tools as `@wan30/cli` 0.1.0 through the Python package `wan30`:
account status, models, estimation, task list, task status, and an explicit
opt-in generation.

Purchased wan30.video credits are required for generation. Sign-up, check-in
and gift credits alone do not qualify. Estimation does not spend credits.

This is not an official Alibaba, DashScope, or Tongyi client. It does not
generate video on your machine and it does not offer free generation.

The Python dependency `wan30>=0.1.0,<0.2` is **not on PyPI yet**. ComfyUI-Manager
will fail `pip install -r requirements.txt` until that release exists. Install
the reviewed wheel first, then install this folder.

## Nodes

| Node | Tool | Spends |
| --- | --- | --- |
| Wan30 Account Status | `account_status` | no |
| Wan30 List Models | `list_models` | no |
| Wan30 Get Model | `get_model` | no |
| Wan30 Estimate | `estimate_generation` | no |
| Wan30 List Tasks | `list_tasks` | no |
| Wan30 Get Task | `get_task` | no |
| Wan30 Generate Video | `generate_video` | only after both confirmations |

Models are `wan30-reference-to-video`, `wan30-text-to-video`, and
`wan30-image-to-video`. Optional duration, resolution, aspect ratio, and audio
are left unset when you keep the `omit` or `0` widgets. The node does not
fill in server defaults. Image inputs are existing HTTPS URLs. The node does
not upload local files.

`Wan30 Generate Video` does not call the service unless both of these are true:

1. The node widget `confirm_spend` is enabled.
2. The ComfyUI process has `WAN30_CONFIRM_SPEND=spend-purchased-credits`.

The environment value is not a workflow input, so it is not saved in workflow
JSON. A shared workflow with the widget enabled still does not spend until
that process environment is set. There is no token, password, or API-key
widget.

## Authentication

Sign in with the Wan30 CLI or the Python client before starting ComfyUI, or
export a process environment the client already understands:

- `WAN30_ACCESS_TOKEN` — bearer token for this process
- `WAN30_CONFIG_DIR` — directory of an existing file session (default `~/.wan30`)
- `WAN30_ORIGIN` — optional origin, default `https://wan30.video`

An optional `origin` widget overrides `WAN30_ORIGIN` for that node. Leave it
empty to use the environment. Do not put a token in the widget or in the
workflow. These nodes do not read `.env` files and do not start a login flow.

## Install

Copy this directory to `ComfyUI/custom_nodes/wan30` so `__init__.py` is directly
inside that folder. Restart ComfyUI.

Installing this monorepo with ComfyUI-Manager's git clone does **not** load
the nodes. ComfyUI imports `custom_nodes/<folder>`, and this repository's root
is the JavaScript CLI. The registry path below installs a zip whose root is
this directory.

## Comfy Registry and Manager

Checked against the current Comfy docs and `comfy-cli`:

- Registry metadata lives in this `pyproject.toml`. The node id is `wan30`.
  On 2026-11-11, `GET https://api.comfy.org/nodes/wan30` returned 404.
- `PublisherId` is `notusinggithub`. That publisher id already exists at
  `https://registry.comfy.org`. This package does not create it. You still
  need a Registry publishing API key from that publisher. Create the key at
  the registry while logged in, and keep it outside this repo.
- `comfy node pack` and `comfy node publish` zip git-tracked files from the
  directory where you run them (`git -C . ls-files`). From `packages/comfyui`
  that is this node only. `.comfyignore` drops `tests/`.
- `Comfy-Org/publish-node-action` checks out the repository root and has no
  subdirectory input. Running it on `NotUsingGithub/wan30-mcp` would archive
  the whole monorepo. Use it only in a dedicated repository whose root is this
  node. This monorepo does not add that workflow.
- Manager installs a registry zip into `custom_nodes/<node-id>/`, then runs
  `requirements.txt`. A legacy `custom-node-list.json` git-clone entry for
  this monorepo would clone the wrong root. Do not open that upstream PR for
  this folder.

Publish only after `wan30` is on PyPI, otherwise Manager installs the node and
then fails its dependency. From a committed checkout:

```sh
cd packages/comfyui
comfy node validate
comfy node publish
```

`comfy node publish` uploads. The API key is prompted, or passed with
`--token` from a secret store. Do not commit the key. The published version
is `0.1.0` in `pyproject.toml`.

Authors recorded here are Wan30 and NotUsingGithub.
