export class WanClientError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function normalizeOrigin(value = 'https://wan30.video') {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.protocol !== 'https:'
  )
    throw new WanClientError(
      'INVALID_ORIGIN',
      'Use an exact HTTPS service origin.'
    );
  return url.origin;
}
export async function readJsonResponse(response, limit = 2_097_152) {
  if (!response.body)
    throw new WanClientError(
      'INVALID_RESPONSE',
      'The server returned an empty response.'
    );
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit)
        throw new WanClientError(
          'INVALID_RESPONSE',
          'The server response exceeded the size limit.'
        );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof WanClientError) throw error;
    throw new WanClientError(
      'INVALID_RESPONSE',
      'The server returned an unreadable response.'
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

export class WanClient {
  constructor({ origin, getToken }) {
    this.origin = normalizeOrigin(origin);
    this.getToken = getToken;
  }

  async fetchAuthorized(url, init) {
    if (new URL(url).origin !== this.origin)
      throw new WanClientError(
        'INVALID_ORIGIN',
        'Unexpected authorization destination.'
      );
    const headers = new Headers(init.headers);
    headers.set('Authorization', 'Bearer ' + (await this.getToken()));
    return fetch(url, { ...init, headers, redirect: 'error' });
  }

  /** Connects once. A failed attempt is not kept, so the local MCP server can
   * retry after the user signs in without being restarted. */
  connect() {
    this.connecting ??= (async () => {
      const client = new Client({ name: 'wan30-cli', version: VERSION });
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/api/mcp/', this.origin), {
          fetch: (url, init) => this.fetchAuthorized(url, init),
        })
      );
      this.client = client;
      return client;
    })().catch((error) => {
      this.connecting = undefined;
      throw error;
    });
    return this.connecting;
  }

  /** The hosted server's tool result, unchanged. */
  async callTool(name, args = {}) {
    try {
      const client = await this.connect();
      return await client.callTool({ name, arguments: args }, undefined, {
        timeout: 300000,
      });
    } catch (error) {
      // The hosted server answers 401 once a connection expires or is revoked.
      if (error?.code === 401)
        throw new WanClientError(
          'AUTH_REQUIRED',
          'Authorization expired or was revoked. Run wan30 auth login.',
          401
        );
      throw error;
    }
  }

  async call(name, args = {}) {
    const result = await this.callTool(name, args);
    if (result.isError) {
      let error;
      try {
        error = JSON.parse(result.content[0].text);
      } catch {}
      throw new WanClientError(
        error?.code || 'TOOL_ERROR',
        error?.message || result.content[0]?.text || 'Tool call failed.'
      );
    }
    return result.structuredContent.data;
  }

  account() {
    return this.call('account_status');
  }
  models() {
    return this.call('list_models');
  }
  model(modelId) {
    return this.call('get_model', { modelId });
  }
  estimate(input) {
    return this.call('estimate_generation', { input });
  }
  generate(input, requestId) {
    return this.call('generate_video', { input, requestId });
  }
  tasks(args) {
    return this.call('list_tasks', args);
  }
  task(taskId) {
    return this.call('get_task', { taskId });
  }
  close() {
    return this.client?.close();
  }
  async disconnect() {
    const res = await this.fetchAuthorized(
      new URL('/api/mcp/disconnect/', this.origin),
      { method: 'POST' }
    );
    if (!res.ok)
      throw new WanClientError(
        'REVOCATION_UNCONFIRMED',
        'Could not disconnect.'
      );
  }
}
