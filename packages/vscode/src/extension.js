"use strict";

const mcp = require("./mcpConfig");
const cli = require("./cliRunner");

const DOCUMENTS = [
  ["Wan30 website", "https://wan30.video/"],
  ["MCP setup", "https://wan30.video/mcp/"],
  ["CLI", "https://wan30.video/cli/"],
  ["Usage guide", "https://wan30.video/mcp/guide/"],
  ["Credit packs", "https://wan30.video/pricing/"],
];

const START_PROMPT = [
  "Start the official Wan30 local MCP server with: npx -y @wan30/cli mcp",
  "Node.js 22 or newer is required. Starting it does not generate a video.",
  cli.CREDIT_NOTICE,
  "The extension does not store access tokens.",
].join("\n\n");

function createDefinition(vscode) {
  return new vscode.McpStdioServerDefinition(
    "Wan30",
    mcp.STDIO_ENTRY.command,
    [...mcp.STDIO_ENTRY.args],
    {},
    "0.1.0"
  );
}

function activate(context, dependencies = {}) {
  const vscode = dependencies.vscode || require("vscode");
  const run = dependencies.runProcess || cli.runProcess;
  const platform = dependencies.platform || process.platform;
  const provider = {
    provideMcpServerDefinitions() {
      if (typeof vscode.McpStdioServerDefinition !== "function") return [];
      return [createDefinition(vscode)];
    },
    async resolveMcpServerDefinition(server) {
      if (!mcp.isOfficialLaunch(server)) return undefined;
      const runtime = await cli.checkRuntime(run, platform);
      if (!runtime.ok) {
        await vscode.window.showErrorMessage(runtime.message);
        return undefined;
      }
      const choice = await vscode.window.showWarningMessage(
        START_PROMPT,
        { modal: true },
        "Start server"
      );
      return choice === "Start server" ? server : undefined;
    },
  };

  if (vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === "function") {
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider("wan30", provider)
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("wan30.signIn", () => signIn(vscode, platform)),
    vscode.commands.registerCommand("wan30.account", () =>
      runReadCommand(vscode, run, platform, "account")
    ),
    vscode.commands.registerCommand("wan30.models", () =>
      runReadCommand(vscode, run, platform, "models")
    ),
    vscode.commands.registerCommand("wan30.estimate", () =>
      estimate(vscode, run, platform)
    ),
    vscode.commands.registerCommand("wan30.addWorkspaceConfig", () =>
      addWorkspaceConfig(vscode)
    ),
    vscode.commands.registerCommand("wan30.openDocumentation", () =>
      openDocumentation(vscode)
    )
  );
  return { provider };
}

async function signIn(vscode, platform) {
  const command = cli.loginCommand(platform);
  if (!command) {
    await vscode.window.showErrorMessage(
      "The Wan30 CLI supports macOS and Linux, including WSL. This window is not one of those platforms, so sign-in was not started."
    );
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Open a terminal and run:\n\n${command}\n\nThe CLI stores its own credentials. This extension does not read or save them. ${cli.CREDIT_NOTICE}`,
    { modal: true },
    "Open terminal"
  );
  if (choice !== "Open terminal") return;
  const terminal = vscode.window.createTerminal({ name: "Wan30" });
  terminal.show();
  terminal.sendText(command, true);
}

async function runReadCommand(vscode, run, platform, command) {
  const runtime = await cli.checkRuntime(run, platform);
  if (!runtime.ok) {
    await vscode.window.showErrorMessage(runtime.message);
    return;
  }
  const output = vscode.window.createOutputChannel("Wan30");
  output.show(true);
  output.appendLine(cli.CREDIT_NOTICE);
  output.appendLine(`This ${command} command does not generate a video.`);
  const result = await run("npx", cli.cliArgs(command), { shell: false, timeoutMs: 60000 });
  output.appendLine(result.stdout);
  if (result.stderr) output.appendLine(result.stderr);
  if (result.code !== 0) {
    await vscode.window.showErrorMessage(
      "The Wan30 CLI did not complete. See the Wan30 output channel. No video was generated."
    );
  }
}

async function estimate(vscode, run, platform) {
  const runtime = await cli.checkRuntime(run, platform);
  if (!runtime.ok) {
    await vscode.window.showErrorMessage(runtime.message);
    return;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    title: "Wan30 estimate input JSON",
    filters: { JSON: ["json"] },
  });
  if (!picked || !picked[0]) return;
  const filePath = picked[0].fsPath;
  const output = vscode.window.createOutputChannel("Wan30");
  output.show(true);
  output.appendLine(
    `Estimating credits does not create a video. ${cli.CREDIT_NOTICE}`
  );
  const result = await run("npx", cli.cliArgs("estimate", filePath), {
    shell: false,
    timeoutMs: 60000,
  });
  output.appendLine(result.stdout);
  if (result.stderr) output.appendLine(result.stderr);
  if (result.code !== 0) {
    await vscode.window.showErrorMessage(
      "The estimate did not complete. See the Wan30 output channel. No video was generated."
    );
  }
}

async function addWorkspaceConfig(vscode) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    await vscode.window.showErrorMessage(
      "Open a workspace folder before adding .vscode/mcp.json. No file was changed."
    );
    return;
  }
  let folder = folders[0];
  if (folders.length > 1) {
    const picked = await vscode.window.showQuickPick(
      folders.map((item) => ({ label: item.name, folder: item })),
      { title: "Choose the workspace for .vscode/mcp.json" }
    );
    if (!picked) return;
    folder = picked.folder;
  }
  const directory = vscode.Uri.joinPath(folder.uri, ".vscode");
  const file = vscode.Uri.joinPath(directory, "mcp.json");
  let text = "";
  try {
    const bytes = await vscode.workspace.fs.readFile(file);
    text = Buffer.from(bytes).toString("utf8");
  } catch {
    text = "";
  }
  const plan = mcp.planMcpUpdate(text);
  if (plan.action === "unchanged") {
    await vscode.window.showInformationMessage(
      "Wan30 is already configured in .vscode/mcp.json. The file was not changed."
    );
    return;
  }
  if (plan.action === "refuse") {
    await vscode.window.showErrorMessage(plan.reason);
    return;
  }
  const button = plan.action === "replace" ? "Replace wan30 entry" : "Add configuration";
  const message =
    plan.action === "replace"
      ? `Replace only the wan30 entry in .vscode/mcp.json with npx -y @wan30/cli mcp? Other servers and settings are kept. Environment values on the old entry are not copied. ${cli.CREDIT_NOTICE}`
      : `Add the official Wan30 stdio server to .vscode/mcp.json?\n\nnpx -y @wan30/cli mcp\n\nOther settings are kept. Nothing is written until you confirm. ${cli.CREDIT_NOTICE}`;
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, button);
  if (choice !== button) return;
  await vscode.workspace.fs.createDirectory(directory);
  await vscode.workspace.fs.writeFile(file, Buffer.from(plan.nextText, "utf8"));
  await vscode.window.showInformationMessage(
    "Updated .vscode/mcp.json. Review it before starting the server. No video was generated."
  );
}

async function openDocumentation(vscode) {
  const picked = await vscode.window.showQuickPick(
    DOCUMENTS.map(([label, url]) => ({ label, description: url, url })),
    { title: "Wan30 documentation" }
  );
  if (!picked) return;
  await vscode.env.openExternal(vscode.Uri.parse(picked.url));
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  START_PROMPT,
  DOCUMENTS,
};
