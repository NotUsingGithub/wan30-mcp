# Publishing wan30 and langchain-wan30

These packages are not uploaded by this repository. Publish them from the
existing PyPI user **notusinggithub** (`https://pypi.org/user/notusinggithub/`).
PyPI project names: `wan30` and `langchain-wan30`.

Do not put an API token, password, or `.pypirc` in this repo, in a workflow
log, or in a chat. Do not reuse a token from another account.

## Build

```sh
python -m pip install build twine
python -m build packages/python
python -m build packages/langchain-python
python -m twine check packages/python/dist/* packages/langchain-python/dist/*
```

Upload `wan30` first. `langchain-wan30` depends on `wan30>=0.1.0,<0.2`.

## Preferred: GitHub Actions trusted publisher

A pending publisher can create the project on the first upload. While logged
in as `notusinggithub`, open PyPI → account publishing, or the project page
after it exists, and add one GitHub publisher per project:

| PyPI project | Owner | Repository | Workflow | Environment |
| --- | --- | --- | --- | --- |
| `wan30` | `NotUsingGithub` | `wan30-mcp` | `publish-python.yml` | `pypi` |
| `langchain-wan30` | `NotUsingGithub` | `wan30-mcp` | `publish-python.yml` | `pypi` |

The workflow filename must match exactly. Use a GitHub environment named
`pypi` if you want a required reviewer before the job runs. The workflow
needs `id-token: write` and must not set `TWINE_PASSWORD`.

```yaml
name: publish-python
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  wan30:
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install build
      - run: python -m build
        working-directory: packages/python
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: packages/python/dist
  langchain-wan30:
    needs: wan30
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install build
      - run: python -m build
        working-directory: packages/langchain-python
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: packages/langchain-python/dist
```

This file is the setup, not an active workflow. Add it under
`.github/workflows/` only when you are ready to publish by hand.

## Ordinary API token

Create the token while logged in as `notusinggithub`:
<https://pypi.org/manage/account/token/>.

The first upload of a new project needs an account-scoped token. After the
project exists, create a project-scoped token and revoke the broader one.

```sh
export TWINE_USERNAME=__token__
export TWINE_PASSWORD  # paste the pypi- token into the prompt; do not echo it
read -rs TWINE_PASSWORD
python -m twine upload packages/python/dist/*
python -m twine upload packages/langchain-python/dist/*
unset TWINE_PASSWORD
```

A `~/.pypirc` of mode `0600` is the same credential if you prefer a file.
Keep it outside the repository:

```ini
[pypi]
username = __token__
password = pypi-...
```

Then run `python -m twine upload` without putting the password in the command
line.
