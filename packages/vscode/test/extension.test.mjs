import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { activate, DOCUMENTS } = require("../src/extension.js");
const manifest = require("../package.json");

function mockVscode(overrides = {}) {
  const calls = {
    warnings: [],
    errors: [],
    information: [],
    writes: [],
    terminals: [],
    opened: [],
    runs: [],
    output: [],
  };
  const vscode = {
    McpStdioServerDefinition: class {
      constructor(label, command, args, env, version) {
        Object.assign(this, { label, command, args, env, version });
      }
    },
    lm: {
      registerMcpServerDefinitionProvider(id, provider) {
        calls.provider = { id, provider };
        return { dispose() {} };
      },
    },
    commands: {
      registerCommand(id, handler) {
        calls.commands ??= {};
        calls.commands[id] = handler;
        return { dispose() {} };
      },
    },
    window: {
      showWarningMessage(message, options, ...items) {
        calls.warnings.push({ message, options, items });
        return Promise.resolve(overrides.warning?.());
      },
      showErrorMessage(message) {
        calls.errors.push(message);
        return Promise.resolve();
      },
      showInformationMessage(message) {
        calls.information.push(message);
        return Promise.resolve();
      },
      showOpenDialog: () => Promise.resolve(overrides.dialog?.() ?? undefined),
      showQuickPick: (items) => Promise.resolve(overrides.pick?.(items) ?? undefined),
      createOutputChannel() {
        return {
          show() {},
          appendLine(line) {
            calls.output.push(line);
          },
        };
      },
      createTerminal() {
        return {
          show() {},
          sendText(text, execute) {
            calls.terminals.push({ text, execute });
          },
        };
      },
    },
    workspace: {
      workspaceFolders: overrides.folders ?? [],
      fs: {
        async readFile() {
          if (overrides.readError) throw new Error("missing");
          return Buffer.from(overrides.fileText ?? "", "utf8");
        },
        async createDirectory() {},
        async writeFile(_file, bytes) {
          calls.writes.push(Buffer.from(bytes).toString("utf8"));
        },
      },
    },
    Uri: {
      joinPath(base, ...parts) {
        return { fsPath: [base.fsPath, ...parts].join("/") };
      },
      parse(url) {
        return { url };
      },
    },
    env: {
      openExternal(uri) {
        calls.opened.push(uri.url);
        return Promise.resolve(true);
      },
    },
  };
  return { vscode, calls };
}

function context() {
  return { subscriptions: [] };
}

function nodeOk(command, args) {
  assert.deepEqual(args, ["-p", "process.versions.node"]);
  return Promise.resolve({ code: 0, stdout: "v22.14.0\n", stderr: "" });
}

test("the marketplace identity is NotUsingGithub.wan30", () => {
  assert.equal(manifest.publisher, "NotUsingGithub");
  assert.equal(manifest.name, "wan30");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.engines.vscode, "^1.101.0");
  assert.equal(
    manifest.contributes.mcpServerDefinitionProviders[0].id,
    "wan30"
  );
});

test("activation lists the server and does not start npx", async () => {
  const { vscode, calls } = mockVscode();
  const runs = [];
  const { provider } = activate(context(), {
    vscode,
    platform: "linux",
    runProcess: async (command, args) => {
      runs.push([command, args]);
      return nodeOk(command, args);
    },
  });
  const servers = provider.provideMcpServerDefinitions();
  assert.equal(runs.length, 0);
  assert.equal(calls.provider.id, "wan30");
  assert.equal(servers[0].command, "npx");
  assert.deepEqual(servers[0].args, ["-y", "@wan30/cli", "mcp"]);
  assert.deepEqual(servers[0].env, {});
  const declined = await provider.resolveMcpServerDefinition(servers[0]);
  assert.equal(declined, undefined);
  assert.deepEqual(runs, [["node", ["-p", "process.versions.node"]]]);
});

test("the server starts only after confirmation and a supported runtime", async () => {
  const { vscode } = mockVscode({ warning: () => "Start server" });
  const { provider } = activate(context(), {
    vscode,
    platform: "darwin",
    runProcess: nodeOk,
  });
  const [server] = provider.provideMcpServerDefinitions();
  assert.equal(await provider.resolveMcpServerDefinition(server), server);

  const blocked = mockVscode();
  const refused = activate(context(), {
    vscode: blocked.vscode,
    platform: "win32",
    runProcess: async () => {
      throw new Error("should not run");
    },
  }).provider;
  const [windowsServer] = refused.provideMcpServerDefinitions();
  assert.equal(await refused.resolveMcpServerDefinition(windowsServer), undefined);
  assert.match(blocked.calls.errors[0], /macOS and Linux/);

  const tampered = mockVscode({ warning: () => "Start server" });
  let prompted = false;
  tampered.vscode.window.showWarningMessage = () => {
    prompted = true;
    return Promise.resolve("Start server");
  };
  const hostile = activate(context(), {
    vscode: tampered.vscode,
    platform: "linux",
    runProcess: nodeOk,
  }).provider;
  assert.equal(
    await hostile.resolveMcpServerDefinition({
      command: "bash",
      args: ["-c", "npx -y @wan30/cli mcp"],
    }),
    undefined
  );
  assert.equal(prompted, false);
});

test("account and estimate run only the matching CLI arguments", async () => {
  const runs = [];
  const { vscode, calls } = mockVscode();
  activate(context(), {
    vscode,
    platform: "linux",
    runProcess: async (command, args, options = {}) => {
      runs.push({ command, args, shell: options.shell === true });
      if (command === "node") return { code: 0, stdout: "v22.0.0\n", stderr: "" };
      return { code: 0, stdout: "{\"ok\":true}\n", stderr: "" };
    },
  });
  await calls.commands["wan30.account"]();
  assert.deepEqual(runs[1], {
    command: "npx",
    args: ["-y", "@wan30/cli", "account"],
    shell: false,
  });

  const estimate = mockVscode({
    dialog: () => [{ fsPath: "/tmp/my file.json" }],
  });
  const estimateRuns = [];
  activate(context(), {
    vscode: estimate.vscode,
    platform: "linux",
    runProcess: async (command, args) => {
      estimateRuns.push({ command, args });
      if (command === "node") return { code: 0, stdout: "v22.0.0\n", stderr: "" };
      return { code: 0, stdout: "{}\n", stderr: "" };
    },
  });
  await estimate.calls.commands["wan30.estimate"]();
  assert.deepEqual(estimateRuns[1].args, [
    "-y",
    "@wan30/cli",
    "estimate",
    "--input",
    "/tmp/my file.json",
  ]);
  assert.equal(estimate.calls.output.some((line) => line.includes("does not create")), true);
});

test("sign-in is a fixed terminal command and can be cancelled", async () => {
  const cancelled = mockVscode({ warning: () => undefined });
  activate(context(), { vscode: cancelled.vscode, platform: "linux" });
  await cancelled.calls.commands["wan30.signIn"]();
  assert.equal(cancelled.calls.terminals.length, 0);

  const accepted = mockVscode({ warning: () => "Open terminal" });
  activate(context(), { vscode: accepted.vscode, platform: "linux" });
  await accepted.calls.commands["wan30.signIn"]();
  assert.deepEqual(accepted.calls.terminals, [
    {
      text: "npx -y @wan30/cli auth login --credential-store file",
      execute: true,
    },
  ]);
});

test("workspace configuration is not written without confirmation", async () => {
  const noFolder = mockVscode();
  activate(context(), { vscode: noFolder.vscode, platform: "linux" });
  await noFolder.calls.commands["wan30.addWorkspaceConfig"]();
  assert.equal(noFolder.calls.writes.length, 0);
  assert.match(noFolder.calls.errors[0], /No file was changed/);

  const folder = {
    name: "app",
    uri: { fsPath: "/work" },
  };
  const declined = mockVscode({
    folders: [folder],
    fileText: "",
    warning: () => undefined,
  });
  activate(context(), { vscode: declined.vscode, platform: "linux" });
  await declined.calls.commands["wan30.addWorkspaceConfig"]();
  assert.equal(declined.calls.writes.length, 0);

  const accepted = mockVscode({
    folders: [folder],
    fileText: JSON.stringify({
      servers: { other: { type: "stdio", command: "keep", args: [] } },
    }),
    warning: () => "Add configuration",
  });
  activate(context(), { vscode: accepted.vscode, platform: "linux" });
  await accepted.calls.commands["wan30.addWorkspaceConfig"]();
  const written = JSON.parse(accepted.calls.writes[0]);
  assert.equal(written.servers.other.command, "keep");
  assert.deepEqual(written.servers.wan30.args, ["-y", "@wan30/cli", "mcp"]);

  const invalid = mockVscode({
    folders: [folder],
    fileText: "{ not json",
    warning: () => "Add configuration",
  });
  activate(context(), { vscode: invalid.vscode, platform: "linux" });
  await invalid.calls.commands["wan30.addWorkspaceConfig"]();
  assert.equal(invalid.calls.writes.length, 0);
  assert.match(invalid.calls.errors[0], /left unchanged/);

  const secret =
    '{"servers":{"wan30":{"type":"stdio","command":"npx","args":["-y","@wan30/cli","mcp"],"env":{"WAN30_ACCESS_TOKEN":"secret-value"}}}}';
  const replaced = mockVscode({
    folders: [folder],
    fileText: secret,
    warning: () => "Replace wan30 entry",
  });
  activate(context(), { vscode: replaced.vscode, platform: "linux" });
  await replaced.calls.commands["wan30.addWorkspaceConfig"]();
  assert.equal(replaced.calls.writes[0].includes("secret-value"), false);
  assert.equal(JSON.parse(replaced.calls.writes[0]).servers.wan30.env, undefined);
});

test("documentation opens only a chosen official URL", async () => {
  const cancelled = mockVscode({ pick: () => undefined });
  activate(context(), { vscode: cancelled.vscode, platform: "linux" });
  await cancelled.calls.commands["wan30.openDocumentation"]();
  assert.deepEqual(cancelled.calls.opened, []);

  const guide = DOCUMENTS[3][1];
  const picked = mockVscode({
    pick: (items) => items.find((item) => item.url === guide),
  });
  activate(context(), { vscode: picked.vscode, platform: "linux" });
  await picked.calls.commands["wan30.openDocumentation"]();
  assert.deepEqual(picked.calls.opened, [guide]);
});

test("public copy states the credit and platform limits", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const source = ["extension.js", "cliRunner.js", "mcpConfig.js"]
    .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"))
    .join("\n");
  for (const phrase of [
    "Node.js 22",
    "macOS",
    "Linux",
    "WSL",
    "purchased credits",
    "Sign-up, check-in, and gift credits alone do not qualify",
    "not affiliated with Alibaba",
    "does not generate",
    "npx -y @wan30/cli mcp",
    "https://wan30.video/mcp/guide/",
    "https://github.com/NotUsingGithub/wan30-mcp",
  ]) {
    assert.equal(readme.includes(phrase), true, phrase);
  }
  assert.equal(source.includes("@wan27"), false);
  assert.equal(source.includes("wan2-7"), false);
  assert.equal(source.includes("shell: true"), false);
});
