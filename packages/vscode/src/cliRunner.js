"use strict";

const { spawn } = require("node:child_process");

const OUTPUT_LIMIT = 262144;
const CLI_PACKAGE = "@wan30/cli";

const CREDIT_NOTICE =
  "Generation on Wan30 spends purchased credits. Sign-up, check-in, and gift credits alone do not qualify. This extension does not generate videos and is not affiliated with Alibaba.";

function parseNodeMajor(versionText) {
  const match = String(versionText).trim().match(/^v?(\d+)\./);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

function isSupportedPlatform(platform) {
  return platform === "darwin" || platform === "linux";
}

function redact(text) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/WAN30_ACCESS_TOKEN=\S+/g, "WAN30_ACCESS_TOKEN=[redacted]");
}

function assertArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Invalid arguments.");
  }
}

function cliArgs(command, filePath) {
  if (command === "account" || command === "models") {
    return ["-y", CLI_PACKAGE, command];
  }
  if (command === "estimate") {
    if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
      throw new Error("Choose a JSON input file.");
    }
    return ["-y", CLI_PACKAGE, "estimate", "--input", filePath];
  }
  throw new Error("This extension does not run that Wan30 command.");
}

function loginCommand(platform) {
  if (platform === "linux") {
    return "npx -y @wan30/cli auth login --credential-store file";
  }
  if (platform === "darwin") {
    return "npx -y @wan30/cli auth login";
  }
  return null;
}

function runProcess(command, args, options = {}) {
  if (command !== "node" && command !== "npx") {
    return Promise.reject(new Error("Unexpected command."));
  }
  if (options.shell) {
    return Promise.reject(new Error("Shell execution is disabled."));
  }
  assertArgs(args);
  const timeoutMs = options.timeoutMs ?? 60000;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      stderr += "\nThe command timed out.";
      finish(1);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < OUTPUT_LIMIT) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < OUTPUT_LIMIT) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr += error.code === "ENOENT" ? `\n${command} was not found.` : "\nThe command could not be started.";
      finish(1);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}

async function checkRuntime(run, platform) {
  if (!isSupportedPlatform(platform)) {
    return {
      ok: false,
      message:
        "The Wan30 CLI supports macOS and Linux, including WSL. This window is not one of those platforms, so no command was started.",
    };
  }
  let result;
  try {
    result = await run("node", ["-p", "process.versions.node"], { timeoutMs: 10000 });
  } catch {
    return {
      ok: false,
      message: "Node.js 22 or newer is required. No Wan30 command was started.",
    };
  }
  const major = result && result.code === 0 ? parseNodeMajor(result.stdout) : null;
  if (major == null || major < 22) {
    return {
      ok: false,
      message: `Node.js 22 or newer is required${major == null ? "" : ` (found ${major})`}. No Wan30 command was started.`,
    };
  }
  return { ok: true, major };
}

module.exports = {
  CREDIT_NOTICE,
  CLI_PACKAGE,
  parseNodeMajor,
  isSupportedPlatform,
  redact,
  cliArgs,
  loginCommand,
  runProcess,
  checkRuntime,
};
