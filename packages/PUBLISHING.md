# Publishing wan30 and langchain-wan30

Publish from the existing PyPI user **notusinggithub**
(`https://pypi.org/user/notusinggithub/`). The PyPI project names are `wan30`
and `langchain-wan30`.

The release workflow is
[`.github/workflows/publish-python.yml`](../.github/workflows/publish-python.yml).
It is manual: the only trigger is `workflow_dispatch`. Push, pull request, and
tag events do not run it. It contains no password, API token, or `TWINE_*`
value. Do not add those, and do not put a token in a workflow log or chat.

This pull request does not run the workflow and does not upload to PyPI.
GitHub lists a `workflow_dispatch` workflow after the file is on the default
branch, `main`.

## Workflow input

| Input | Type | Required | Accepted value |
| --- | --- | --- | --- |
| `confirm` | string | yes | `publish` |

Any other value fails the `confirm` job. Tests, the build, and both publish
jobs then do not run.

## What the workflow does

1. `confirm` checks the input. It has no `id-token` permission.
2. `test` runs the `wan30` unit tests, installs `langchain-core>=0.3,<2`, then
   runs the `langchain-wan30` unit tests. It has no `id-token` permission.
3. `build` builds both wheels and sdists with `build==1.6.1`, requires one
   wheel and one sdist per package, runs `twine==7.0.0` check, imports the
   `wan30` wheel, and uploads two artifacts. It has no `id-token` permission.
4. `publish wan30` downloads only the `wan30` artifact and publishes it.
5. `publish langchain-wan30` runs after that job succeeds, then publishes
   `langchain-wan30`.

Only the two publish jobs request `id-token: write`, and each job's
permissions block is only that. They use the GitHub environment named `pypi`.
The workflow token is otherwise limited to `contents: read`. Actions are pinned
to commit SHAs: `actions/checkout` v7.0.1, `actions/setup-python` v7.1.0,
`actions/upload-artifact` v7.0.2, `actions/download-artifact` v8.0.2, and
`pypa/gh-action-pypi-publish` v1.14.3.

`skip-existing: true` tells twine to skip a file whose name is already on
PyPI and to continue. A rerun can therefore pass a package that was already
uploaded and still upload the later package. A rebuilt file of the same
version is also skipped; publish that build by bumping the version. The
publish action also verifies metadata again and prints file hashes. Its
default PEP 740 attestations stay enabled and use the same trusted-publishing
identity. No extra token is required for them.

A run uses one concurrency group, `publish-python`, and does not cancel an
in-progress run.

## PyPI pending publishers

The projects are not on PyPI yet, so register pending publishers. They create
the projects on the first successful upload. While logged in as
`notusinggithub`, open <https://pypi.org/manage/account/publishing/> and add
one GitHub publisher for each project:

| PyPI project name | Owner | Repository name | Workflow name | Environment name |
| --- | --- | --- | --- | --- |
| `wan30` | `NotUsingGithub` | `wan30-mcp` | `publish-python.yml` | `pypi` |
| `langchain-wan30` | `NotUsingGithub` | `wan30-mcp` | `publish-python.yml` | `pypi` |

The workflow filename and environment name must match exactly. Add `wan30`
before `langchain-wan30`. The workflow already uploads in that order.

## GitHub environment

Create the environment before the first dispatch. Open
<https://github.com/NotUsingGithub/wan30-mcp/settings/environments>, choose
**New environment**, and name it `pypi`.

Leave the environment without secrets. This repository change does not add
required reviewers, deployment branches, or organization permissions. A
required reviewer is a separate choice in that environment's protection
rules; add one there if a person should approve every publish. Without a
reviewer, a collaborator who can already run workflows can publish after
typing `publish`.

Creating the environment does not grant PyPI access. The pending publishers
above are that grant.

## Dispatch

After this workflow is on `main` and both configurations exist:

1. Open Actions → **publish-python** → **Run workflow**.
2. Select the branch `main`.
3. Set `confirm` to `publish`.

The same call with the GitHub CLI, from a checkout of `main`:

```sh
gh workflow run publish-python.yml --ref main -f confirm=publish
```

That command starts an upload. Do not run it until the publishers and the
`pypi` environment are in place. A successful Actions log is the publish
record; this document cannot report a PyPI release that has not happened.

## Local build

```sh
python -m pip install "build==1.6.1" "twine==7.0.0"
python -m build packages/python
python -m build packages/langchain-python
python -m twine check packages/python/dist/* packages/langchain-python/dist/*
```

## Ordinary API token

Trusted publishing is the release path. An account token remains a manual
fallback outside GitHub Actions. Create it while logged in as
`notusinggithub`: <https://pypi.org/manage/account/token/>.

The first upload of a new project needs an account-scoped token. After the
project exists, create a project-scoped token and revoke the broader one.

```sh
export TWINE_USERNAME=__token__
read -rs TWINE_PASSWORD
python -m twine upload packages/python/dist/*
python -m twine upload packages/langchain-python/dist/*
unset TWINE_PASSWORD
```

`twine upload` does not skip an existing file. If a file is already on PyPI,
use `python -m twine upload --skip-existing` for that retry.

A `~/.pypirc` of mode `0600` is the same credential if you prefer a file.
Keep it outside the repository:

```ini
[pypi]
username = __token__
password = pypi-...
```

Then run `python -m twine upload` without putting the password in the command
line.
