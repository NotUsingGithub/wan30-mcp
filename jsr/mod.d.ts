/**
 * Wan30 client and the seven hosted MCP tools.
 *
 * Imports the implementation in `src/`. Generation uses a wan30.video account
 * and spends purchased credits. Sign-up, check-in, and gift credits alone do
 * not qualify. Requires Node.js 22 or newer. This module does not sign in,
 * read the CLI credential store, or generate a video by itself.
 *
 * @module
 */

/** The seven tools served by the hosted Wan30 MCP server and the local CLI. */
export type Wan30ToolName =
  | "account_status"
  | "list_models"
  | "get_model"
  | "estimate_generation"
  | "generate_video"
  | "list_tasks"
  | "get_task";

/** JSON Schema object published with a tool. */
export interface JsonSchema {
  readonly [keyword: string]: unknown;
}

/** One hosted Wan30 tool definition. */
export interface ToolDefinition {
  readonly name: Wan30ToolName;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
  readonly execution?: {
    readonly taskSupport: string;
  };
}

/** Text content returned by a hosted tool call. */
export interface ToolContent {
  readonly type: string;
  readonly text?: string;
}

/** Hosted MCP tool result, passed through unchanged. */
export interface ToolResult {
  readonly isError?: boolean;
  readonly content: readonly ToolContent[];
  readonly structuredContent?: {
    readonly data?: unknown;
  };
}

/** Minimal caller used by the local stdio server. */
export interface ToolCaller {
  callTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult>;
}

/**
 * Local stdio MCP server. `connect` accepts an MCP transport such as
 * `StdioServerTransport`.
 */
export interface LocalMcpServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
}

/** Options for `fetchAuthorized`. */
export interface AuthorizedRequest {
  method?: string;
  headers?: Headers;
  body?: string;
}

/**
 * Error from the Wan30 client.
 * `status` is the HTTP status, or `0` when the request was not sent.
 */
export class WanClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status?: number);
}

/**
 * Require an exact HTTPS origin with no user info, path, query, or hash.
 * The default origin is `https://wan30.video`.
 */
export function normalizeOrigin(value?: string): string;

/** Version of the Wan30 package this client was loaded from. */
export const VERSION: string;

/** Hosted tool list. The local server can list these before anyone has signed in. */
export const TOOLS: readonly ToolDefinition[];

/** Settings for a server-side Wan30 client. */
export interface WanClientOptions {
  /** Exact HTTPS origin. Defaults to `https://wan30.video`. */
  origin?: string;
  /** Returns an existing access token. Do not hard-code tokens in browser code. */
  getToken: () => Promise<string>;
}

/**
 * Server-side client for the hosted Wan30 MCP endpoint.
 * Tool calls spend the same purchased credits as the website.
 */
export class WanClient {
  readonly origin: string;
  readonly getToken: () => Promise<string>;
  constructor(options: WanClientOptions);
  /** Fetch `url` with a bearer token. Redirects are rejected. */
  fetchAuthorized(url: string, init?: AuthorizedRequest): Promise<Response>;
  /** Open the hosted MCP session. A failed attempt is not kept. */
  connect(): Promise<unknown>;
  /** Call one hosted tool and return its result unchanged. */
  callTool(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult>;
  /** Call one hosted tool and return `structuredContent.data`. */
  call(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  /** Available website credits and access to generation. */
  account(): Promise<unknown>;
  /** Supported generation models. */
  models(): Promise<unknown>;
  /** Input options for one video model. */
  model(modelId: string): Promise<unknown>;
  /** Quote credits before generation. Does not create a task. */
  estimate(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  /**
   * Spend purchased credits on a text, first-frame, or reference video.
   * Reuse `requestId` after a network error to avoid a second charge.
   */
  generate(
    input: Readonly<Record<string, unknown>>,
    requestId: string,
  ): Promise<unknown>;
  /** Recent supported video tasks for this account. */
  tasks(args?: { readonly limit?: number }): Promise<unknown>;
  /** Poll one video task for its status and download URL. */
  task(taskId: string): Promise<unknown>;
  /** Close the hosted MCP session when one is open. */
  close(): Promise<void> | undefined;
  /** Revoke this connection on the hosted server. */
  disconnect(): Promise<void>;
}

/**
 * Build the local stdio MCP server. It lists {@link TOOLS} without a sign-in.
 * A tool call uses `client` and spends purchased credits only when the hosted
 * tool does.
 */
export function createLocalMcpServer(options: {
  client: ToolCaller;
}): LocalMcpServer;
