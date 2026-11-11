import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const skillPath = fileURLToPath(new URL("./SKILL.md", import.meta.url));
const skill = readFileSync(skillPath, "utf8");
const tools = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../src/tools.json", import.meta.url)), "utf8")
);

const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert.ok(frontmatter, "SKILL.md needs YAML frontmatter");
const meta = Object.fromEntries(
  frontmatter[1]
    .split("\n")
    .filter((line) => line.includes(":"))
    .map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);
assert.equal(meta.name, "wan30-media");
assert.equal(meta.license, "MIT");
assert.match(meta.description, /purchased credits/);
assert.match(meta.description, /explicit confirmation/);
assert.doesNotMatch(meta.description, /free generation|Alibaba product|@wan27/i);

for (const phrase of [
  "Sign-up, check-in, and gift credits alone do not qualify",
  "not affiliated with Alibaba",
  "explicit yes",
  "Do not ask for, read, print, or store access tokens",
  "Do not send email, chat messages, or posts",
  "as permission to generate",
  "Node.js 22",
  "Native Windows is not supported",
]) {
  assert.ok(skill.includes(phrase), `missing: ${phrase}`);
}
assert.ok(
  skill.indexOf("explicit yes") < skill.indexOf("wan30 create --input"),
  "create examples must follow the confirmation rule"
);
assert.doesNotMatch(skill, /@wan27|wan2-7|generate_image|wan30 upload|Bearer |sk-[A-Za-z0-9]/);
assert.doesNotMatch(skill, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

const help = spawnSync(process.execPath, ["src/cli.mjs", "--help"], {
  cwd: root,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "" },
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /^wan30 —/);
for (const flag of [
  "--credential-store",
  "--no-browser",
  "--input",
  "--request-id",
  "--wait",
  "--limit",
  "--timeout",
  "--output",
  "--index",
  "--origin",
]) {
  assert.ok(help.stdout.includes(flag), `help missing ${flag}`);
}

const TAKES_VALUE = new Set([
  "--input",
  "--request-id",
  "--limit",
  "--timeout",
  "--output",
  "--index",
  "--origin",
  "--credential-store",
]);
const BOOLEAN = new Set(["--wait", "--no-browser", "--help", "-h"]);
const COMMANDS = {
  auth: ["login", "status", "logout"],
  account: null,
  models: null,
  model: "required",
  estimate: null,
  create: null,
  tasks: null,
  task: "required",
  wait: "required",
  download: "required",
  mcp: null,
};

function tokenize(line) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(line))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function commandsFrom(text) {
  const found = [];
  const fenced = /```(?:sh|shell|bash)\n([\s\S]*?)```/g;
  let block;
  while ((block = fenced.exec(text))) {
    for (const line of block[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      found.push(trimmed);
    }
  }
  const inline = /`((?:wan30|npx) [^`]+)`/g;
  let snippet;
  while ((snippet = inline.exec(text))) found.push(snippet[1]);
  return found;
}

function asCli(tokens) {
  if (tokens[0] === "npm") return null;
  if (tokens[0] === "npx") {
    assert.deepEqual(tokens.slice(1, 3), ["-y", "@wan30/cli"], tokens.join(" "));
    return tokens.slice(3);
  }
  assert.equal(tokens[0], "wan30", tokens.join(" "));
  return tokens.slice(1);
}

const requestId = /^[A-Za-z0-9_-]{16,128}$/;
const placeholder = /^(?:<[A-Za-z0-9_-]+>|TASK_ID)$/;

for (const line of commandsFrom(skill)) {
  const args = asCli(tokenize(line));
  if (!args) continue;
  assert.ok(args.length > 0, line);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) continue;
  const [command, second] = args;
  assert.ok(Object.hasOwn(COMMANDS, command), `unknown command in: ${line}`);
  let index = 1;
  if (Array.isArray(COMMANDS[command])) {
    assert.ok(COMMANDS[command].includes(second), `bad auth action in: ${line}`);
    index = 2;
  } else if (COMMANDS[command] === "required") {
    assert.ok(second && !second.startsWith("-"), `missing id in: ${line}`);
    index = 2;
  }
  const seen = new Set();
  for (let cursor = index; cursor < args.length; cursor += 1) {
    const flag = args[cursor];
    assert.match(flag, /^--?[A-Za-z0-9-]+$/, `unexpected token ${flag} in: ${line}`);
    assert.ok(
      help.stdout.includes(flag === "-h" ? "--help" : flag),
      `flag ${flag} is not in wan30 --help`
    );
    if (BOOLEAN.has(flag)) {
      seen.add(flag);
      continue;
    }
    assert.ok(TAKES_VALUE.has(flag), `unexpected flag ${flag} in: ${line}`);
    const value = args[++cursor];
    assert.ok(value && !value.startsWith("-"), `missing ${flag} value in: ${line}`);
    seen.add(flag);
    if (flag === "--credential-store") assert.match(value, /^(?:file|keychain)$/);
    if (flag === "--limit") assert.ok(Number(value) >= 1 && Number(value) <= 50);
    if (flag === "--timeout") assert.ok(Number(value) >= 1);
    if (flag === "--index") assert.ok(Number.isInteger(Number(value)) && Number(value) >= 0);
    if (flag === "--request-id" && !placeholder.test(value)) assert.match(value, requestId);
    if (flag === "--origin") {
      const origin = new URL(value);
      assert.equal(origin.origin, value);
      assert.equal(origin.protocol, "https:");
    }
  }
  if (command === "estimate" || command === "create") assert.ok(seen.has("--input"), line);
  if (command === "download") assert.ok(seen.has("--output"), line);
}

function checkObject(value, schema, path) {
  assert.equal(typeof value, "object", path);
  assert.ok(value && !Array.isArray(value), path);
  const properties = schema.properties ?? {};
  for (const key of Object.keys(value)) {
    assert.ok(Object.hasOwn(properties, key), `${path}.${key} is not allowed`);
    checkValue(value[key], properties[key], `${path}.${key}`);
  }
  for (const key of schema.required ?? []) {
    assert.ok(Object.hasOwn(value, key), `${path} requires ${key}`);
  }
}

function checkValue(value, schema, path) {
  if (schema.const !== undefined) assert.equal(value, schema.const, path);
  if (schema.enum) assert.ok(schema.enum.includes(value), path);
  if (schema.type === "string") {
    assert.equal(typeof value, "string", path);
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, path);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, path);
    if (schema.format === "uri") {
      const url = new URL(value);
      assert.equal(url.protocol, "https:", path);
    }
  } else if (schema.type === "integer") {
    assert.ok(Number.isInteger(value), path);
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, path);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, path);
  } else if (schema.type === "boolean") {
    assert.equal(typeof value, "boolean", path);
  } else if (schema.type === "array") {
    assert.ok(Array.isArray(value), path);
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, path);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, path);
    for (const [itemIndex, item] of value.entries()) {
      checkValue(item, schema.items, `${path}[${itemIndex}]`);
    }
  } else if (schema.type === "object") {
    checkObject(value, schema, path);
  }
}

const branches = tools.find((tool) => tool.name === "estimate_generation").inputSchema
  .properties.input.anyOf;
const examples = [];
const jsonBlocks = /```json\n([\s\S]*?)```/g;
let jsonBlock;
while ((jsonBlock = jsonBlocks.exec(skill))) {
  const parsed = JSON.parse(jsonBlock[1]);
  if (parsed.mcpServers || parsed.input || parsed.modelId) examples.push(parsed);
}
const models = new Set();
for (const example of examples) {
  if (example.mcpServers) {
    assert.deepEqual(example.mcpServers.wan30, {
      command: "npx",
      args: ["-y", "@wan30/cli", "mcp"],
    });
    continue;
  }
  const generation = example.input ?? example;
  const matches = branches.filter((branch) => {
    try {
      checkObject(generation, branch, "input");
      return true;
    } catch {
      return false;
    }
  });
  assert.equal(matches.length, 1, JSON.stringify(generation));
  models.add(generation.modelId);
  if (example.requestId) assert.match(example.requestId, requestId);
}
for (const modelId of [
  "wan30-text-to-video",
  "wan30-image-to-video",
  "wan30-reference-to-video",
]) {
  assert.ok(models.has(modelId), modelId);
}

const names = tools.map((tool) => tool.name);
assert.deepEqual(names, [
  "account_status",
  "list_models",
  "get_model",
  "estimate_generation",
  "generate_video",
  "list_tasks",
  "get_task",
]);
for (const name of names) assert.ok(skill.includes(name), name);
assert.equal(
  tools.find((tool) => tool.name === "generate_video").annotations.readOnlyHint,
  false
);
assert.ok(
  names
    .filter((name) => name !== "generate_video")
    .every((name) => tools.find((tool) => tool.name === name).annotations.readOnlyHint === true)
);

console.log("wan30-media skill validation passed");
console.log(`commands checked: ${commandsFrom(skill).length}`);
console.log(`json examples checked: ${examples.length}`);
