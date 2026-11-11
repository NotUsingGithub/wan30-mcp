import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LINKS,
  OFFICIAL_ORIGIN,
  REQUEST_EXAMPLES,
  REQUIREMENTS,
  buildSetup,
  mcpConfig,
  validateOrigin,
} from "../setup.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
const tools = JSON.parse(readFileSync(new URL("../../../src/tools.json", import.meta.url), "utf8"));

function snippet(state, id) {
  return state.groups.flatMap((group) => group.snippets).find((item) => item.id === id);
}

function jsonFences(source) {
  return [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

const help = spawnSync(process.execPath, ["src/cli.mjs", "--help"], {
  cwd: root,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "" },
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /^wan30 —/);

test("official origin matches the published MCP config and CLI help", () => {
  const state = buildSetup({ origin: OFFICIAL_ORIGIN, platform: "linux" });
  const config = JSON.parse(snippet(state, "mcp").text);
  const published = jsonFences(readme).map((text) => JSON.parse(text)).find((value) => value.mcpServers);
  assert.deepEqual(config, published);
  assert.deepEqual(config, mcpConfig(OFFICIAL_ORIGIN));
  assert.equal(config.mcpServers.wan30.env, undefined);
  assert.equal(snippet(state, "login").text, "wan30 auth login --credential-store file\n");
  assert.equal(snippet(state, "install").text, "npm install -g @wan30/cli\n");
  assert.equal(snippet(state, "help").text, "wan30 --help\n");
  assert.equal(snippet(state, "account").text, "wan30 account\n");
  assert.equal(snippet(state, "estimate").text, "wan30 estimate --input request.json\n");
  assert.equal(
    snippet(state, "create").text,
    "wan30 create --input request.json --request-id forest-lake-shot-001\n"
  );
  assert.equal(snippet(state, "create").spendsCredits, true);
  assert.equal(snippet(state, "codex").text, "codex mcp add wan30 -- wan30 mcp\n");
  assert.equal(snippet(state, "claude").text, "claude mcp add wan30 -- wan30 mcp\n");
  assert.ok(readme.includes("codex mcp add wan30 -- wan30 mcp"));
  assert.ok(readme.includes("claude mcp add wan30 -- wan30 mcp"));
  for (const flag of ["--credential-store", "--input", "--request-id", "--limit", "--output", "--origin"]) {
    assert.ok(help.stdout.includes(flag), flag);
  }
  for (const command of ["auth login", "account", "models", "estimate", "create", "tasks", "download"]) {
    assert.ok(help.stdout.includes(command), command);
  }
});

test("macOS sign-in omits the Linux credential store", () => {
  const state = buildSetup({ origin: OFFICIAL_ORIGIN, platform: "macos" });
  assert.equal(snippet(state, "login").text, "wan30 auth login\n");
  assert.equal(snippet(state, "login").text.includes("--credential-store"), false);
});

test("a non-default exact origin is local configuration only", () => {
  const origin = "https://example.com";
  const state = buildSetup({ origin, platform: "macos" });
  assert.equal(state.origin.official, false);
  const config = JSON.parse(snippet(state, "mcp").text);
  assert.deepEqual(config.mcpServers.wan30.env, { WAN30_ORIGIN: origin });
  assert.equal(snippet(state, "account").text, "wan30 --origin https://example.com account\n");
  assert.equal(snippet(state, "codex"), undefined);
  assert.equal(snippet(state, "help").text, "wan30 --help\n");
  assert.equal(JSON.stringify(state).includes("WAN30_ACCESS_TOKEN"), false);
});

test("invalid origins and native Windows cannot produce a paid command", () => {
  for (const origin of [
    "http://wan30.video",
    "https://wan30.video/mcp/",
    "https://user:pass@wan30.video",
    "https://wan30.video?token=1",
    "Bearer secret",
    "",
    "https://wan30.video ",
  ]) {
    const checked = validateOrigin(origin);
    assert.equal(checked.ok, false, origin);
    const state = buildSetup({ origin, platform: "linux" });
    assert.equal(snippet(state, "mcp").copyable, false);
    assert.equal(snippet(state, "create").copyable, false);
    assert.equal(snippet(state, "create").text, "");
  }
  const windows = buildSetup({ origin: OFFICIAL_ORIGIN, platform: "windows" });
  assert.match(windows.platformMessage, /Native Windows is not supported/);
  assert.equal(snippet(windows, "login"), undefined);
  assert.equal(snippet(windows, "create").copyable, false);
  assert.equal(snippet(windows, "create").text, "Native Windows cannot run this command.\n");
  const unselected = buildSetup({ origin: OFFICIAL_ORIGIN, platform: "" });
  assert.match(unselected.platformMessage, /Choose where/);
  assert.equal(snippet(unselected, "create").copyable, false);
});

test("request examples are the published README JSON and match the tool schema", () => {
  const fences = new Set(jsonFences(readme));
  const branches = tools.find((tool) => tool.name === "estimate_generation").inputSchema.properties
    .input.anyOf;
  for (const example of REQUEST_EXAMPLES) {
    assert.ok(fences.has(example.text), example.id);
    const value = JSON.parse(example.text);
    const matches = branches.filter((branch) => {
      try {
        checkObject(value, branch);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(matches.length, 1, example.id);
  }
  for (const line of REQUIREMENTS) assert.equal(typeof line, "string");
  assert.ok(REQUIREMENTS.some((line) => line.includes("Node.js 22")));
  assert.ok(REQUIREMENTS.some((line) => line.includes("Sign-up, check-in, and gift credits alone do not qualify.")));
  assert.ok(REQUIREMENTS.some((line) => line.includes("Not affiliated with Alibaba")));
  assert.deepEqual(
    LINKS.map((link) => link.href),
    [
      "https://wan30.video/",
      "https://wan30.video/mcp/",
      "https://wan30.video/cli/",
      "https://wan30.video/mcp/guide/",
      "https://wan30.video/pricing/",
      "https://github.com/NotUsingGithub/wan30-mcp",
      "https://github.com/NotUsingGithub/wan30-mcp/issues",
    ]
  );
});

function checkObject(value, schema) {
  assert.equal(typeof value, "object");
  for (const key of Object.keys(value)) {
    assert.ok(Object.hasOwn(schema.properties, key), key);
    checkValue(value[key], schema.properties[key]);
  }
  for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), key);
}

function checkValue(value, schema) {
  if (schema.const !== undefined) assert.equal(value, schema.const);
  if (schema.enum) assert.ok(schema.enum.includes(value));
  if (schema.type === "string") {
    assert.equal(typeof value, "string");
    if (schema.format === "uri") assert.equal(new URL(value).protocol, "https:");
  } else if (schema.type === "integer") {
    assert.equal(Number.isInteger(value), true);
  } else if (schema.type === "array") {
    assert.equal(Array.isArray(value), true);
    assert.ok(value.length >= schema.minItems && value.length <= schema.maxItems);
    for (const item of value) checkValue(item, schema.items);
  }
}
