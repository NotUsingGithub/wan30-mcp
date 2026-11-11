# Wan30 Video

Apify Actor `wan30-video` 0.1.0. It calls the Wan30 Streamable HTTP endpoint `POST {origin}/api/mcp/` with the seven tools in the Wan30 `src/tools.json`: account status, list models, get model, estimate, generate video, list tasks, and get task.

Purchased wan30.video credits are required. Sign-up, check-in, and gift credits alone do not qualify. This is not an official Alibaba, DashScope, or Tongyi client. There is no image-generation action.

The access token is a secret input (`isSecret: true`). The Actor does not read `.env` files or `process.env`. It does not write the token to the log, the dataset, or a URL. Requests send it only in the `Authorization` bearer header.

`generate` does nothing on the network unless `confirmSpend` is exactly `true`. It then calls `estimate_generation`. `generate_video` runs only when that quote returns a value. The confirmation flag is not sent. The generate body is `input` and `requestId`. Omitted optional fields stay omitted.

Authors: Wan30 and NotUsingGithub. MIT.

No public Wan27 Apify Actor repository was found to copy. `https://github.com/NotUsingGithub/wan27-apify` returns 404, and this Actor uses the Wan30 MCP tools instead of another product's API.

## Run locally without Apify

The container command is `node src/main.js`. That path loads the `apify` package, reads `Actor.getInput()`, and writes one dataset item. Offline tests call `run()` with an injected request and do not start the SDK:

```sh
node packages/apify/test/run.mjs
node packages/apify/package.mjs
```

`package.mjs` writes `/opt/cursor/artifacts/wan30-video-0.1.0-apify-source.zip` and a sibling `.sha256` file. The archive is the Actor directory, stored uncompressed, and is suitable as an Apify Zip source once it is hosted at an external URL. This repository does not upload it.

The Actor specification schema allows `0.1` and `0.1.0`. This Actor uses `0.1.0` in both `.actor/actor.json` and `package.json`. `buildTag` is `latest`. Memory is 128–512 MB, default 256 MB. The image is `apify/actor-node:22-slim`, which is a published Node.js 22 tag, and `package.json` pins `apify` 3.7.2.

## Publication

This monorepo folder is not an Apify Store listing. Apify reads an Actor from one source directory. Current source types are documented at https://docs.apify.com/actors/development/deployment/source-types.

A Git source can point at this subdirectory. The Actor directory is the path after the branch or tag:

`https://github.com/NotUsingGithub/wan30-mcp#<branch-or-tag>:packages/apify`

The repository root is not the Actor. `dockerContextDir` is unset, so the Docker context is `packages/apify`. A Zip source is also supported: host a Zip of this directory at an external URL and select Zip file. Web IDE and GitHub Gist are separate source types and are not used here. `apify push` uploads the Actor directory and builds it on Apify; this change does not run that command.

A free Apify account is $0, does not require a credit card, and includes $5 of prepaid platform usage each month (https://apify.com/pricing). When that amount is used, platform access stops until the next cycle. The general terms allow an account to create private Actors. The publish checklist does not require the Creator plan. The Creator plan is a separate $1/month builder plan and is not part of this change.

These steps are still required before a public listing, and none of them is done here:

1. Create a free Apify account and open Development > My Actors.
2. Create an Actor whose source is the Git URL above, or a Zip file URL for this Actor directory.
3. Build it and run it once. Both consume platform usage.
4. Accept the Store Publishing Terms (https://docs.apify.com/actors/publishing/publish).
5. On the Publishing tab, add a logo and description, choose monetization, add a sample output, and keep the output schema. Choose Limited permissions. This Actor reads its input and writes its default dataset; it does not need full account access. Identity verification is required for full permissions or for more than 10 published Actors.
6. Select Publish on Store.

A public page exists only at `https://apify.com/<username>/wan30-video` after that publish action. Pay per usage matches this Actor: it adds no separate event price, and runs still consume the caller's platform usage.
