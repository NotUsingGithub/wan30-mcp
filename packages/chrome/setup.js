/** Copy-only Wan30 setup text. This module does not run commands or contact a network. */

export const OFFICIAL_ORIGIN = "https://wan30.video";
export const MAX_ORIGIN_LENGTH = 2048;

export const LINKS = [
  { id: "website", label: "Wan30 website", href: "https://wan30.video/" },
  { id: "mcp", label: "MCP setup", href: "https://wan30.video/mcp/" },
  { id: "cli", label: "CLI installation", href: "https://wan30.video/cli/" },
  { id: "guide", label: "Usage guide", href: "https://wan30.video/mcp/guide/" },
  { id: "pricing", label: "Credit packs", href: "https://wan30.video/pricing/" },
  { id: "source", label: "Source code", href: "https://github.com/NotUsingGithub/wan30-mcp" },
  {
    id: "issues",
    label: "Issue tracker",
    href: "https://github.com/NotUsingGithub/wan30-mcp/issues",
  },
];

export const REQUIREMENTS = [
  "Node.js 22 or newer.",
  "macOS or Linux, including WSL. Native Windows is not supported.",
  "Video generation on wan30.video requires remaining purchased credits.",
  "Sign-up, check-in, and gift credits alone do not qualify.",
  "This extension does not run commands, call Wan30, or generate video.",
  "Not affiliated with Alibaba. Not a local video model or a free video service.",
];

export const PLATFORMS = {
  macos: { label: "macOS", supported: true },
  linux: { label: "Linux, including WSL", supported: true },
  windows: { label: "Native Windows", supported: false },
};

export const REQUEST_EXAMPLES = [
  {
    id: "example-text",
    title: "Text to video request.json",
    text: '{"modelId":"wan30-text-to-video","prompt":"A paper boat on a rainy street","durationSeconds":5,"resolution":"720p"}',
  },
  {
    id: "example-image",
    title: "First-frame request.json",
    text: '{"modelId":"wan30-image-to-video","prompt":"The crane takes off","imageUrls":["https://example.org/first-frame.jpg"]}',
  },
  {
    id: "example-reference",
    title: "Reference request.json",
    text: '{"modelId":"wan30-reference-to-video","prompt":"Move the camera slowly toward the scene","imageUrls":["https://example.org/reference.jpg"]}',
  },
];

const ORIGIN_ERROR = "Use an exact HTTPS service origin.";

export function validateOrigin(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ORIGIN_LENGTH)
    return { ok: false, message: ORIGIN_ERROR };
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))
    return { ok: false, message: ORIGIN_ERROR };
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || url.protocol !== "https:")
      return { ok: false, message: ORIGIN_ERROR };
    return {
      ok: true,
      origin: url.origin,
      official: url.origin === OFFICIAL_ORIGIN,
      message:
        url.origin === OFFICIAL_ORIGIN
          ? "Official service: https://wan30.video."
          : "This origin is not https://wan30.video. This extension does not contact it. Copied CLI commands include --origin, and the MCP JSON sets WAN30_ORIGIN.",
    };
  } catch {
    return { ok: false, message: ORIGIN_ERROR };
  }
}

export function mcpConfig(origin) {
  const server = {
    command: "npx",
    args: ["-y", "@wan30/cli", "mcp"],
  };
  if (origin !== OFFICIAL_ORIGIN) server.env = { WAN30_ORIGIN: origin };
  return { mcpServers: { wan30: server } };
}

function cli(argv, origin, { withOrigin = true } = {}) {
  const args = ["wan30"];
  if (withOrigin && origin !== OFFICIAL_ORIGIN) args.push("--origin", origin);
  args.push(...argv);
  return args.join(" ");
}

function snippet(fields) {
  return {
    spendsCredits: false,
    copyable: true,
    ...fields,
    copyLabel: fields.copyLabel,
  };
}

export function buildSetup({ origin, platform }) {
  const checked = validateOrigin(origin);
  const selected = PLATFORMS[platform] || null;
  let platformMessage = "Choose where you will run the Wan30 CLI.";
  if (selected?.supported) platformMessage = "";
  if (platform === "windows")
    platformMessage = "Native Windows is not supported. Use macOS or Linux, including WSL.";

  const usable = checked.ok;
  const serviceOrigin = checked.ok ? checked.origin : null;
  const groups = [];

  const mcpSnippets = [
    snippet({
      id: "mcp",
      title: "stdio MCP config",
      copyLabel: "Copy MCP config",
      copyable: usable,
      text: usable ? `${JSON.stringify(mcpConfig(serviceOrigin), null, 2)}\n` : "",
    }),
  ];
  if (checked.official) {
    mcpSnippets.push(
      snippet({
        id: "codex",
        title: "Codex",
        copyLabel: "Copy Codex command",
        text: "codex mcp add wan30 -- wan30 mcp\n",
      }),
      snippet({
        id: "claude",
        title: "Claude Code",
        copyLabel: "Copy Claude Code command",
        text: "claude mcp add wan30 -- wan30 mcp\n",
      })
    );
  }
  groups.push({
    id: "mcp",
    title: "Local MCP",
    note: checked.official
      ? "Matches the published stdio configuration. Copying does not start the server."
      : "A non-default origin is carried only in this JSON. The published Codex and Claude Code commands are for https://wan30.video.",
    snippets: mcpSnippets,
  });

  const login =
    platform === "macos"
      ? cli(["auth", "login"], serviceOrigin)
      : platform === "linux"
        ? cli(["auth", "login", "--credential-store", "file"], serviceOrigin)
        : "";
  groups.push({
    id: "cli",
    title: "CLI setup",
    note: "If Chrome is on Windows, choose Linux, including WSL, only when these commands will run inside WSL.",
    snippets: [
      snippet({
        id: "install",
        title: "Install",
        copyLabel: "Copy install command",
        text: "npm install -g @wan30/cli\n",
      }),
      snippet({
        id: "help",
        title: "Help",
        copyLabel: "Copy help command",
        text: "wan30 --help\n",
      }),
      ...(login
        ? [
            snippet({
              id: "login",
              title: "Sign in",
              copyLabel: "Copy sign-in command",
              copyable: usable,
              text: usable ? `${login}\n` : "",
            }),
          ]
        : []),
    ],
  });

  groups.push({
    id: "read",
    title: "Read-only commands",
    note: "These do not create a video.",
    snippets: [
      ["account", "Account", ["account"]],
      ["models", "Models", ["models"]],
      ["model", "Text-to-video schema", ["model", "wan30-text-to-video"]],
      ["estimate", "Estimate", ["estimate", "--input", "request.json"]],
      ["tasks", "Recent tasks", ["tasks", "--limit", "20"]],
    ].map(([id, title, argv]) =>
      snippet({
        id,
        title,
        copyLabel: `Copy ${title.toLowerCase()} command`,
        copyable: usable,
        text: usable ? `${cli(argv, serviceOrigin)}\n` : "",
      })
    ),
  });

  groups.push({
    id: "examples",
    title: "Example request files",
    note: "Save one as request.json yourself. This extension does not write files or upload images.",
    snippets: REQUEST_EXAMPLES.map((example) =>
      snippet({
        id: example.id,
        title: example.title,
        copyLabel: "Copy JSON",
        text: `${example.text}\n`,
      })
    ),
  });

  groups.push({
    id: "paid",
    title: "Purchased-credit command",
    note: "Running create spends purchased wan30.video credits. Sign-up, check-in, and gift credits alone do not qualify. Keep the same request id if you retry. This extension does not run it.",
    snippets: [
      snippet({
        id: "create",
        title: "Create",
        copyLabel: "Copy create command",
        copyable: usable && Boolean(selected?.supported),
        spendsCredits: true,
        text: !usable
          ? ""
          : platform === "windows"
            ? "Native Windows cannot run this command.\n"
            : selected?.supported
              ? `${cli(
                  ["create", "--input", "request.json", "--request-id", "forest-lake-shot-001"],
                  serviceOrigin
                )}\n`
              : "",
      }),
    ],
  });

  groups.push({
    id: "download",
    title: "After a task exists",
    note: "Download does not create a video. Replace TASK_ID with a task id the CLI printed. The CLI does not overwrite an existing file.",
    snippets: [
      snippet({
        id: "download",
        title: "Download",
        copyLabel: "Copy download command",
        copyable: usable && Boolean(selected?.supported),
        text: !usable
          ? ""
          : platform === "windows"
            ? "Native Windows cannot run this command.\n"
            : selected?.supported
              ? `${cli(["download", "TASK_ID", "--output", "result.mp4"], serviceOrigin)}\n`
              : "",
      }),
    ],
  });

  return {
    origin: checked,
    platform,
    platformMessage,
    requirements: REQUIREMENTS,
    links: LINKS,
    groups,
  };
}

export async function copyText(text, { clipboard, document }) {
  if (typeof text !== "string" || text.length === 0) throw new Error("Nothing to copy.");
  try {
    if (!clipboard?.writeText) throw new Error("Clipboard unavailable.");
    await clipboard.writeText(text);
    return "clipboard";
  } catch (error) {
    if (!document?.createElement || !document.execCommand) throw error;
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.focus();
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Could not copy.");
    return "fallback";
  }
}
