import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WanClient, WanClientError } from '../src/client.mjs';
import { TOOLS, createLocalMcpServer } from '../src/mcp.mjs';

const TOOL_NAMES = [
  'account_status',
  'list_models',
  'get_model',
  'estimate_generation',
  'generate_video',
  'list_tasks',
  'get_task',
];

/** A local server in front of a stand-in for the hosted connection. */
async function connect(callTool) {
  const server = createLocalMcpServer({ client: { callTool } });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const errorOf = (result) => {
  assert.equal(result.isError, true);
  return JSON.parse(result.content[0].text);
};

test('lists the hosted tools without contacting the service', async () => {
  const client = await connect(() => assert.fail('no call expected'));
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    TOOL_NAMES
  );
  assert.deepEqual(tools, TOOLS);
});

test('returns the hosted result unchanged', async () => {
  const hosted = {
    content: [{ type: 'text', text: '{"credits":10}' }],
    structuredContent: { data: { credits: 10 } },
  };
  const calls = [];
  const client = await connect(async (name, args) => {
    calls.push([name, args]);
    return hosted;
  });
  const input = { modelId: 'wan30-text-to-video', prompt: 'A lake.' };
  const result = await client.callTool({
    name: 'estimate_generation',
    arguments: { input },
  });
  assert.deepEqual(calls, [['estimate_generation', { input }]]);
  assert.deepEqual(result.content, hosted.content);
  assert.deepEqual(result.structuredContent, hosted.structuredContent);
});

test('asks for sign-in when this device has no credentials', async () => {
  const client = await connect(async () => {
    throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
  });
  const error = errorOf(await client.callTool({ name: 'account_status' }));
  assert.equal(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /^Not signed in\. Run `wan30 auth login/);
});

test('reports an expired or revoked connection', async () => {
  const client = await connect(async () => {
    throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.', 401);
  });
  const error = errorOf(await client.callTool({ name: 'account_status' }));
  assert.equal(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /expired or was revoked/);
});

test('keeps the hosted explanation for rejected arguments', async () => {
  const client = await connect(async () => {
    throw Object.assign(new Error('Invalid arguments: prompt is required'), {
      code: -32602,
    });
  });
  const error = errorOf(
    await client.callTool({ name: 'estimate_generation', arguments: {} })
  );
  assert.deepEqual(error, {
    code: 'INVALID_INPUT',
    message: 'Invalid arguments: prompt is required',
  });
});

test('hides unexpected failures behind a retry-safe message', async () => {
  const client = await connect(async () => {
    throw new Error('socket hang up at 10.0.0.7');
  });
  const error = errorOf(await client.callTool({ name: 'list_tasks' }));
  assert.deepEqual(error, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service unavailable. Check list_tasks before retrying.',
  });
});

test('rejects a tool the hosted server does not have', async () => {
  const client = await connect(() => assert.fail('no call expected'));
  await assert.rejects(client.callTool({ name: 'generate_image' }), {
    message: /Unknown tool: generate_image/,
  });
});

test('retries the hosted connection after a failed attempt', async () => {
  let signedIn = false;
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(null, { status: 401 });
  };
  try {
    const client = new WanClient({
      origin: 'https://wan30.example',
      getToken: async () => {
        if (!signedIn)
          throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
        return 'token';
      },
    });
    await assert.rejects(client.callTool('account_status'), {
      code: 'AUTH_REQUIRED',
      status: 0,
    });
    assert.deepEqual(requests, []);
    // Signing in from another terminal must be enough; no restart.
    signedIn = true;
    await assert.rejects(client.callTool('account_status'), {
      code: 'AUTH_REQUIRED',
      status: 401,
    });
    assert.deepEqual(requests, ['https://wan30.example/api/mcp/']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('wan30 mcp starts and lists tools before anyone has signed in', async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'wan30-cli-test-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL('../src/cli.mjs', import.meta.url)),
      'mcp',
      // Keeps the test away from the real keychain.
      '--credential-store',
      'file',
    ],
    env: { PATH: process.env.PATH, WAN30_CONFIG_DIR: configDir },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      TOOL_NAMES
    );
    const error = errorOf(await client.callTool({ name: 'account_status' }));
    assert.equal(error.code, 'UNAUTHORIZED');
    assert.match(error.message, /^Not signed in/);
  } finally {
    await client.close();
    await rm(configDir, { recursive: true, force: true });
  }
});
