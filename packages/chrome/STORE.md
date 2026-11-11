# Chrome Web Store listing for Wan30 MCP Setup

This file is listing copy for a later upload by the existing Wan30 / NotUsingGithub publisher. It does not submit a listing. Chrome Web Store review can reject an item; acceptance is not promised.

The package does not contain publisher credentials. Do not create a new publisher account for this upload unless you already intend to use a different existing account. The public author name is Wan30 / NotUsingGithub.

## What was checked

Official Chrome Web Store documentation used for this copy, fetched while preparing the package:

- [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare): manifest `name`, `version`, `description` (132 characters or fewer), and `icons`; the zip must contain `manifest.json` at its root.
- [Supply listing images](https://developer.chrome.com/docs/webstore/images): a 128x128 PNG icon inside the zip, with about 16 pixels of padding around a square mark, and at least one screenshot at 1280x800 or 640x400.
- [Manifest V3 additional requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements): extension logic must be self-contained. No remote script, `eval`, or remotely fetched executable logic.
- [Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions): request the narrowest permissions. This package requests none.
- [Privacy policy](https://developer.chrome.com/docs/webstore/program-policies/privacy) and [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): a product that does not handle user data has no privacy-policy obligation under that FAQ. The dashboard still has a privacy-practices form.
- [Privacy practices tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy): single purpose, permission justification, remote-code declaration, and data-use certification.
- [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and the [2026 policy update](https://developer.chrome.com/blog/cws-policy-updates-2026): do not collect user data beyond a disclosed single purpose, and do not ship an extension that circumvents protections on an AI service. This extension does not bypass Wan30 sign-in, credit checks, or site restrictions.

Policies change. Read the dashboard and those pages again at upload time.

## Item

| Field | Value |
| --- | --- |
| Name | Wan30 MCP Setup |
| Version | 0.1.0 |
| Manifest description | Copy the official Wan30 stdio MCP config and CLI commands. Does not run them, generate video, or store tokens. |
| Single purpose | Copy the official Wan30 local stdio MCP configuration and CLI setup commands, check an exact HTTPS origin locally, and open official Wan30 documentation when the user clicks a link. |
| Category | Confirm the current dashboard list. Productivity is the closest fit for a setup helper. |
| Language | English |
| Icon | `icons/icon128.png`, an original two-bar mark drawn by `icons.mjs`. It is not an Alibaba logo and not a Wan trademark. |
| Homepage shown in the manifest | https://wan30.video/mcp/ |

The next upload must use a higher manifest version than the version already accepted by the store.

## Detailed description

Wan30 MCP Setup copies setup text for the official Wan30 command-line client, @wan30/cli, and its local stdio MCP server.

You can:

- Choose macOS or Linux, including WSL. Native Windows is shown as unsupported.
- Check that a service origin is an exact HTTPS origin. The official service is https://wan30.video.
- Copy the published MCP configuration, the install command, the sign-in command, and read-only account, model, estimate, and task commands.
- Copy the published text, first-frame, and reference request examples.
- Copy the create command. Running it yourself spends purchased wan30.video credits. This extension never runs it.
- Open the Wan30 website, MCP page, CLI page, usage guide, pricing page, and the NotUsingGithub/wan30-mcp source when you click those links.

This extension does not generate video, does not include a video model, and is not a free video service. It is not affiliated with Alibaba. Video generation on wan30.video requires remaining purchased credits. Sign-up, check-in, and gift credits alone do not qualify.

The copied commands need Node.js 22 or newer. Copying text does not install Node, start the CLI, or buy credits.

The extension does not request browser permissions, does not read web pages, does not collect or store access tokens, and does not contact Wan30 or any other server.

## Privacy practices

Remote code: No, I am not using remote code.

Permissions: none are declared, so there is no permission to justify. Do not add one before upload.

Data use: do not check any data-type collection box. The extension does not collect user data. Complete the certification statements so they stay consistent with `PRIVACY.txt`. Do not certify a data practice this extension does not have.

Privacy policy URL: the User Data FAQ says a product that does not handle user data has no privacy-policy obligation. The disclosure is `packages/chrome/PRIVACY.txt` in this public repository. It is not hosted on wan30.video. If the dashboard form will not save without a URL, enter the GitHub blob for that file. Do not enter a URL that does not serve this disclosure. A blob URL is not store acceptance.

## Screenshots

Upload at least one 1280x800 screenshot of this extension's actual popup. A prepared screenshot is produced with the local listing layout (`popup.html?listing=1`) and is not a picture of a video generator. Promotional images are optional; the store can review an item without the 440x280 and 1400x560 images, and those images are reviewed separately.

## Upload by the existing publisher

1. Sign in to the Chrome Web Store developer dashboard with the existing publisher account. This package does not contain that login.
2. Create a new item. Do not attach this zip to an unrelated extension.
3. Upload `wan30-mcp-setup-0.1.0.zip`. `manifest.json` is at the root of the zip.
4. Paste the single purpose and detailed description from this file.
5. Set remote code to No.
6. Leave data-type collection unchecked and follow the privacy section above.
7. Upload `icons/icon128.png` if the dashboard asks for the store icon separately, and upload the 1280x800 screenshot.
8. Submit the draft yourself when you want review. Review can take time and can reject the item. This repository does not submit, publish, or appeal it.
