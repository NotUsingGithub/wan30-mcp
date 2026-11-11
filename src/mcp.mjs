import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { VERSION, WanClientError } from './client.mjs';

/**
 * The tool list of the hosted server, captured by src/agent/video-mcp.test.ts
 * (which fails when the two drift apart). Serving it from the package lets an
 * assistant list the tools before the user has signed in.
 */
export const TOOLS = JSON.parse(
  readFileSync(new URL('./tools.json', import.meta.url), 'utf8')
);

function failure(code, message) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
  };
}

function toolFailure(error) {
  if (
    error instanceof WanClientError &&
    ['AUTH_REQUIRED', 'KEYCHAIN_UNAVAILABLE'].includes(error.code)
  )
    return failure(
      'UNAUTHORIZED',
      error.status === 401
        ? 'Authorization expired or was revoked. Run `wan30 auth login` in a terminal, then try again.'
        : process.platform === 'darwin'
          ? 'Not signed in. Run `wan30 auth login` in a terminal, then try again.'
          : 'Not signed in. Run `wan30 auth login --credential-store file` in a terminal, then try again.'
    );
  // The hosted server rejected the arguments before running the tool.
  if (error?.code === ErrorCode.InvalidParams)
    return failure('INVALID_INPUT', error.message);
  return failure(
    'SERVICE_UNAVAILABLE',
    error instanceof WanClientError
      ? error.message
      : 'Service unavailable. Check list_tasks before retrying.'
  );
}

/** A stdio MCP server that forwards each tool call to the hosted Wan30 server
 * with this device's sign-in. */
export function createLocalMcpServer({ client }) {
  const server = new Server(
    { name: 'wan30', version: VERSION },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!TOOLS.some((tool) => tool.name === params.name))
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown tool: ${params.name}`
      );
    try {
      return await client.callTool(params.name, params.arguments ?? {});
    } catch (error) {
      return toolFailure(error);
    }
  });
  return server;
}
