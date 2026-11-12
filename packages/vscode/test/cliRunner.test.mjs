import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const cli = require("../src/cliRunner.js");

test("parses Node major versions and rejects the shell", () => {
  assert.equal(cli.parseNodeMajor("v22.23.4\n"), 22);
  assert.equal(cli.parseNodeMajor("21.0.0"), 21);
  assert.equal(cli.parseNodeMajor("not-node"), null);
  assert.equal(cli.isSupportedPlatform("linux"), true);
  assert.equal(cli.isSupportedPlatform("darwin"), true);
  assert.equal(cli.isSupportedPlatform("win32"), false);
  assert.throws(() => cli.cliArgs("create"), /does not run/);
  assert.throws(() => cli.cliArgs("generate_video"), /does not run/);
});

test("passes an estimate path as one argument", () => {
  const filePath = "/tmp/lake.json; rm -rf /";
  assert.deepEqual(cli.cliArgs("estimate", filePath), [
    "-y",
    "@wan30/cli",
    "estimate",
    "--input",
    filePath,
  ]);
  assert.deepEqual(cli.cliArgs("account"), ["-y", "@wan30/cli", "account"]);
  assert.deepEqual(cli.cliArgs("models"), ["-y", "@wan30/cli", "models"]);
});

test("uses a fixed login command and redacts credential-shaped output", () => {
  assert.equal(
    cli.loginCommand("linux"),
    "npx -y @wan30/cli auth login --credential-store file"
  );
  assert.equal(cli.loginCommand("darwin"), "npx -y @wan30/cli auth login");
  assert.equal(cli.loginCommand("win32"), null);
  const hidden = cli.redact(
    "no Bearer abc.def WAN30_ACCESS_TOKEN=secret-token trailing"
  );
  assert.equal(hidden.includes("abc.def"), false);
  assert.equal(hidden.includes("secret-token"), false);
});

test("checkRuntime does not launch npx", async () => {
  const calls = [];
  const ok = await cli.checkRuntime(async (command, args) => {
    calls.push([command, args]);
    return { code: 0, stdout: "v22.1.0\n", stderr: "" };
  }, "linux");
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, [["node", ["-p", "process.versions.node"]]]);

  const old = await cli.checkRuntime(async () => ({ code: 0, stdout: "v20.0.0\n" }), "darwin");
  assert.equal(old.ok, false);
  const windows = await cli.checkRuntime(async () => {
    throw new Error("should not run");
  }, "win32");
  assert.equal(windows.ok, false);
});

test("the real process runner rejects a shell and does not use one", async () => {
  await assert.rejects(
    cli.runProcess("npx", ["-y", "@wan30/cli", "account"], { shell: true })
  );
  await assert.rejects(cli.runProcess("bash", ["-c", "echo hi"]));
  const result = await cli.runProcess(
    "node",
    ["-e", "process.stdout.write('ok')"],
    { timeoutMs: 10000 }
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok");
});
