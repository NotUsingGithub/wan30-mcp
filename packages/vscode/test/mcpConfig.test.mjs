import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { planMcpUpdate, isOfficialLaunch, STDIO_ENTRY } = require("../src/mcpConfig.js");

test("creates a strict VS Code mcp.json entry", () => {
  const plan = planMcpUpdate("");
  assert.equal(plan.action, "create");
  assert.deepEqual(JSON.parse(plan.nextText), {
    servers: {
      wan30: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@wan30/cli", "mcp"],
      },
    },
  });
  assert.equal(plan.nextText.includes("WAN30_ACCESS_TOKEN"), false);
});

test("keeps other servers and settings when adding wan30", () => {
  const plan = planMcpUpdate(
    JSON.stringify({
      inputs: [{ id: "example", type: "promptString" }],
      servers: { other: { type: "stdio", command: "other", args: ["stay"] } },
    })
  );
  assert.equal(plan.action, "create");
  const next = JSON.parse(plan.nextText);
  assert.deepEqual(next.servers.other, {
    type: "stdio",
    command: "other",
    args: ["stay"],
  });
  assert.equal(next.inputs.length, 1);
  assert.deepEqual(next.servers.wan30.args, ["-y", "@wan30/cli", "mcp"]);
});

test("does not rewrite an entry that already matches", () => {
  const current = {
    servers: {
      wan30: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@wan30/cli", "mcp"],
      },
    },
  };
  const plan = planMcpUpdate(`${JSON.stringify(current)}\n`);
  assert.equal(plan.action, "unchanged");
  assert.equal(plan.nextText, undefined);
});

test("requires an explicit replace when the existing entry differs", () => {
  const plan = planMcpUpdate(
    JSON.stringify({
      servers: {
        wan30: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@wan30/cli", "mcp"],
          env: { WAN30_ACCESS_TOKEN: "secret-value" },
        },
        kept: { type: "http", url: "https://example.invalid/mcp" },
      },
    })
  );
  assert.equal(plan.action, "replace");
  const next = JSON.parse(plan.nextText);
  assert.equal(next.servers.wan30.env, undefined);
  assert.equal(next.servers.kept.url, "https://example.invalid/mcp");
  assert.equal(plan.nextText.includes("secret-value"), false);
});

test("refuses comments, trailing commas, and non-objects", () => {
  assert.equal(planMcpUpdate('{\n  // comment\n  "servers": {}\n}\n').action, "refuse");
  assert.equal(planMcpUpdate('{"servers": {},}\n').action, "refuse");
  assert.equal(planMcpUpdate("[]\n").action, "refuse");
  assert.equal(planMcpUpdate('{"servers": []}\n').action, "refuse");
  for (const plan of [
    planMcpUpdate("{"),
    planMcpUpdate("[]"),
    planMcpUpdate('{"servers": []}'),
  ]) {
    assert.equal(plan.nextText, undefined);
  }
});

test("accepts only the official launch command", () => {
  assert.equal(
    isOfficialLaunch({ command: "npx", args: [...STDIO_ENTRY.args] }),
    true
  );
  assert.equal(
    isOfficialLaunch({ command: "npx", args: ["-y", "@wan30/cli", "mcp", "--extra"] }),
    false
  );
  assert.equal(
    isOfficialLaunch({ command: "bash", args: ["-c", "npx -y @wan30/cli mcp"] }),
    false
  );
  assert.equal(
    isOfficialLaunch({ command: "npx", args: ["-y", "@wan27/cli", "mcp"] }),
    false
  );
});
