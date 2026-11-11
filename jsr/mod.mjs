/* @ts-self-types="./mod.d.ts" */
/**
 * Wan30 client and local MCP tools.
 *
 * This module re-exports the client shipped in this repository. Generation
 * uses a wan30.video account and spends purchased credits. Sign-up, check-in,
 * and gift credits alone do not qualify. Node.js 22 or newer.
 *
 * @module
 */
export {
  VERSION,
  WanClient,
  WanClientError,
  normalizeOrigin,
} from "../src/client.mjs";
export { TOOLS, createLocalMcpServer } from "../src/mcp.mjs";
