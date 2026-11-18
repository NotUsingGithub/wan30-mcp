import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  TOOLS,
  VERSION,
  WanClient,
  WanClientError,
  createLocalMcpServer,
  normalizeOrigin,
} from '../jsr/mod.mjs';

const TOOL_NAMES = [
  'account_status',
  'list_models',
  'get_model',
  'estimate_generation',
  'generate_video',
  'list_tasks',
  'get_task',
];

const hostedTools = JSON.parse(
  readFileSync(new URL('../src/tools.json', import.meta.url), 'utf8')
);

test('JSR entry re-exports the packaged client and the seven hosted tools', () => {
  assert.equal(VERSION, '0.1.0');
  assert.equal(typeof WanClient, 'function');
  assert.equal(typeof createLocalMcpServer, 'function');
  assert.equal(Object.getPrototypeOf(WanClientError), Error);
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    TOOL_NAMES
  );
  assert.deepEqual(TOOLS, hostedTools);
  assert.equal(normalizeOrigin('https://wan30.video'), 'https://wan30.video');
  assert.throws(() => normalizeOrigin('http://wan30.video'), {
    code: 'INVALID_ORIGIN',
  });
});

test('declared JSR exports match the runtime module', () => {
  const declaration = readFileSync(
    new URL('../jsr/mod.d.ts', import.meta.url),
    'utf8'
  );
  for (const name of [
    'VERSION',
    'WanClient',
    'WanClientError',
    'normalizeOrigin',
    'TOOLS',
    'createLocalMcpServer',
  ]) {
    assert.match(declaration, new RegExp(`export (?:const|function|class) ${name}\\b`));
  }
  const manifest = JSON.parse(
    readFileSync(new URL('../jsr.json', import.meta.url), 'utf8')
  );
  assert.equal(manifest.name, '@notusinggithub/wan30');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.exports, './jsr/mod.mjs');
  assert.equal(manifest.license, 'MIT');
  for (const file of manifest.publish.include) {
    readFileSync(new URL(`../${file}`, import.meta.url));
  }
});

test('local server from the JSR entry lists tools without a network call', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network is not used by this test');
  };
  try {
    const server = createLocalMcpServer({
      client: {
        callTool() {
          throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
        },
      },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'jsr-test', version: '0' });
    await Promise.all([
      server.connect(serverSide),
      client.connect(clientSide),
    ]);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      TOOL_NAMES
    );
    const result = await client.callTool({ name: 'account_status' });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).code, 'UNAUTHORIZED');
    assert.deepEqual(calls, []);
    await client.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('account lookup stops before fetch when no token is available', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('network is not used by this test');
  };
  try {
    const wan = new WanClient({
      origin: 'https://wan30.example',
      getToken: async () => {
        throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
      },
    });
    await assert.rejects(wan.account(), { code: 'AUTH_REQUIRED' });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('loading the JSR module does not start the CLI or the network', () => {
  const entry = fileURLToPath(new URL('../jsr/mod.mjs', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `globalThis.fetch = () => {
        console.error('FETCH');
        return Promise.reject(new Error('fetch'));
      };
      const mod = await import(${JSON.stringify(entry)});
      if (mod.TOOLS.length !== 7) process.exit(2);
      console.log(mod.TOOLS.map((tool) => tool.name).join(','));`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), TOOL_NAMES.join(','));
  assert.doesNotMatch(result.stderr, /FETCH|wan30 —/);
});
