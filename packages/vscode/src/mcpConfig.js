"use strict";

const SERVER_KEY = "wan30";
const STDIO_ENTRY = Object.freeze({
  type: "stdio",
  command: "npx",
  args: Object.freeze(["-y", "@wan30/cli", "mcp"]),
});

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function entryEquals(existing) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return false;
  }
  const keys = Object.keys(existing);
  if (keys.length !== 3) return false;
  if (existing.type !== STDIO_ENTRY.type) return false;
  if (existing.command !== STDIO_ENTRY.command) return false;
  if (!Array.isArray(existing.args) || existing.args.length !== STDIO_ENTRY.args.length) {
    return false;
  }
  return STDIO_ENTRY.args.every((arg, index) => existing.args[index] === arg);
}

function officialEntry() {
  return {
    type: STDIO_ENTRY.type,
    command: STDIO_ENTRY.command,
    args: [...STDIO_ENTRY.args],
  };
}

/**
 * Decide how `.vscode/mcp.json` can change. Never writes a file.
 * `create` and `replace` include the full next document; other keys stay.
 * Invalid JSON and non-object `servers` values are refused.
 */
function planMcpUpdate(text) {
  if (text == null || String(text).trim() === "") {
    return {
      action: "create",
      nextText: serialize({ servers: { [SERVER_KEY]: officialEntry() } }),
    };
  }
  const raw = stripBom(String(text));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      action: "refuse",
      reason:
        ".vscode/mcp.json is not strict JSON, so it was left unchanged. Comments and trailing commas are not rewritten.",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      action: "refuse",
      reason: ".vscode/mcp.json must contain a JSON object. It was left unchanged.",
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, "servers") &&
    (!parsed.servers || typeof parsed.servers !== "object" || Array.isArray(parsed.servers))
  ) {
    return {
      action: "refuse",
      reason: "The servers value in .vscode/mcp.json is not an object. It was left unchanged.",
    };
  }
  const servers = parsed.servers ? { ...parsed.servers } : {};
  const current = Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)
    ? servers[SERVER_KEY]
    : undefined;
  if (current && entryEquals(current)) {
    return { action: "unchanged" };
  }
  const next = {
    ...parsed,
    servers: { ...servers, [SERVER_KEY]: officialEntry() },
  };
  return {
    action: current === undefined ? "create" : "replace",
    nextText: serialize(next),
  };
}

function isOfficialLaunch(server) {
  return Boolean(
    server &&
      server.command === STDIO_ENTRY.command &&
      Array.isArray(server.args) &&
      server.args.length === STDIO_ENTRY.args.length &&
      STDIO_ENTRY.args.every((arg, index) => server.args[index] === arg)
  );
}

module.exports = {
  SERVER_KEY,
  STDIO_ENTRY,
  officialEntry,
  planMcpUpdate,
  isOfficialLaunch,
};
