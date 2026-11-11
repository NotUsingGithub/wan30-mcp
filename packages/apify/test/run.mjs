import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);
const actor = require('../src/main.js');
const source = readFileSync(resolve(root, 'src/main.js'), 'utf8');
const token = 'test-token-value-0123456789';
let assertions = 0;

function check(value, message) {
  assert.equal(Boolean(value), true, message);
  assertions += 1;
}

function jsonResponse(value, status = 200, headers = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value),
  };
}

function toolOk(data, id) {
  return jsonResponse({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: { data },
      isError: false,
    },
  });
}

function install(handler) {
  const calls = [];
  const request = async (call) => {
    calls.push(call);
    return handler(call, calls);
  };
  return { calls, request };
}

function standard(call) {
  const body = call.body ? JSON.parse(call.body) : null;
  if (call.url.endsWith('/api/mcp/disconnect/')) return { status: 204, headers: {}, body: '' };
  if (body.method === 'initialize') {
    return jsonResponse({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 'wan30', version: '0.1.0' },
      },
    }, 200, { 'mcp-session-id': 'session-1' });
  }
  if (body.method === 'notifications/initialized') return { status: 202, headers: {}, body: '' };
  if (body.method === 'tools/call') return toolOk({ tool: body.params.name }, body.id);
  throw new Error(`unexpected ${call.url}`);
}

const base = { token, origin: 'https://wan30.video' };

async function rejects(input, code, request = async () => {
  throw new Error('network');
}) {
  await assert.rejects(() => actor.run(input, { request }), (error) => {
    assert.equal(error.code, code);
    return true;
  });
  assertions += 1;
}

await rejects({ action: 'generate', confirmSpend: false, token }, 'SPEND_NOT_CONFIRMED');
await rejects({ action: 'generate', token, prompt: 'a', modelId: 'wan30-text-to-video' }, 'SPEND_NOT_CONFIRMED');
await rejects({ action: 'generate', confirmSpend: 'true', token }, 'SPEND_NOT_CONFIRMED');
check(actor.sourceIncludesSpend ? false : source.includes('purchased wan30.video credits'), 'spend wording');
check(source.includes('The confirmation flag is not sent.'), 'local confirmation');
check(source.includes('This Actor does not read .env files.'), 'no env wording');
check(source.includes('not an official Alibaba, DashScope, or Tongyi client'), 'affiliation wording');
assert.doesNotMatch(source, /process\.env|readFileSync|dotenv|\/api\/v1\/|generate_image/);
assertions += 1;

{
  const { calls, request } = install(standard);
  const record = await actor.run({
    ...base,
    action: 'estimate',
    modelId: 'wan30-text-to-video',
    prompt: 'a quiet harbor',
  }, { request });
  const bodies = calls.filter((call) => call.body).map((call) => JSON.parse(call.body));
  const estimate = bodies.find((body) => body.method === 'tools/call');
  check(estimate.params.name === 'estimate_generation', 'estimate tool');
  assert.deepEqual(Object.keys(estimate.params.arguments).sort(), ['input']);
  assertions += 1;
  assert.deepEqual(estimate.params.arguments.input, {
    prompt: 'a quiet harbor',
    modelId: 'wan30-text-to-video',
  });
  assertions += 1;
  check(!JSON.stringify(bodies).includes('confirm'), 'confirm absent');
  check(!JSON.stringify(bodies).includes(token), 'token absent from bodies');
  check(calls.every((call) => !call.url.includes(token)), 'token absent from urls');
  check(calls[0].headers.Authorization === `Bearer ${token}`, 'bearer header');
  check(calls[0].headers.Accept === 'application/json, text/event-stream', 'accept header');
  check(calls[0].url === 'https://wan30.video/api/mcp/', 'mcp url');
  const initialize = bodies[0];
  assert.deepEqual(initialize.params, {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'wan30-apify', version: '0.1.0' },
  });
  assertions += 1;
  const notification = bodies[1];
  check(notification.method === 'notifications/initialized' && notification.id === undefined, 'notification has no id');
  check(calls[1].headers['mcp-session-id'] === 'session-1', 'session header');
  check(calls[1].headers['mcp-protocol-version'] === '2025-11-25', 'protocol header');
  check(record.action === 'estimate' && record.data.tool === 'estimate_generation', 'estimate record');
  check(record.requestId === undefined && record.token === undefined, 'estimate record is narrow');
  check(calls.at(-1).url.endsWith('/api/mcp/disconnect/'), 'disconnect path');
  check(calls.at(-1).body === undefined, 'disconnect has no body');
  assert.deepEqual(Object.keys(calls.at(-1).headers), ['Authorization']);
  assertions += 1;
}

{
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call' && body.params.name === 'estimate_generation') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ code: 'QUOTE_REQUIRED', message: 'No quote.' }) }],
        },
      });
    }
    return standard(call);
  });
  await assert.rejects(() => actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-text-to-video',
    prompt: 'a quiet harbor',
  }, { request }), (error) => error.code === 'QUOTE_REQUIRED');
  assertions += 1;
  const names = calls.filter((call) => call.body && call.body.includes('tools/call')).map((call) => JSON.parse(call.body).params.name);
  assert.deepEqual(names, ['estimate_generation']);
  assertions += 1;
}

{
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call' && body.params.name === 'estimate_generation') {
      return toolOk(null, body.id);
    }
    return standard(call);
  });
  await assert.rejects(() => actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-text-to-video',
    prompt: 'a quiet harbor',
  }, { request }), (error) => error.code === 'QUOTE_REQUIRED');
  assertions += 1;
  check(!calls.some((call) => call.body && call.body.includes('generate_video')), 'null quote skips generate');
}

{
  const seen = [];
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call') seen.push(body.params);
    return standard(call);
  });
  const record = await actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-image-to-video',
    prompt: 'a quiet harbor',
    imageUrls: ['https://cdn.example/frame.png'],
    requestId: 'request-id-123456',
    durationSeconds: 4,
    resolution: '720p',
    aspectRatio: '16:9',
    hasAudio: false,
  }, { request });
  assert.deepEqual(seen[0], {
    name: 'estimate_generation',
    arguments: {
      input: {
        prompt: 'a quiet harbor',
        modelId: 'wan30-image-to-video',
        imageUrls: ['https://cdn.example/frame.png'],
        durationSeconds: 4,
        resolution: '720p',
        aspectRatio: '16:9',
        hasAudio: false,
      },
    },
  });
  assertions += 1;
  assert.deepEqual(Object.keys(seen[1].arguments).sort(), ['input', 'requestId']);
  assertions += 1;
  check(seen[1].name === 'generate_video', 'generate tool');
  check(seen[1].arguments.requestId === 'request-id-123456', 'reused request id');
  check(record.requestId === 'request-id-123456', 'record request id');
  check(Array.isArray(seen[1].arguments.input.imageUrls) && seen[1].arguments.input.imageUrls.length === 1, 'image url array');
  check(!JSON.stringify(calls.map((call) => call.body)).includes('confirm'), 'generate wire has no confirm');
  check(!JSON.stringify(record).includes(token), 'record hides token');
}

{
  const { request } = install(standard);
  const first = await actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-text-to-video',
    prompt: 'one',
  }, { request });
  const second = await actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-text-to-video',
    prompt: 'two',
  }, { request });
  check(first.requestId !== second.requestId, 'generated request ids differ');
  check(/^[A-Za-z0-9_-]{16,128}$/.test(first.requestId), 'generated request id shape');
}

{
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'initialize' && calls.length === 1) {
      return { status: 401, headers: { 'content-type': 'application/json' }, body: '{"error":"no"}' };
    }
    if (body && body.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'wan30', version: '0.1.0' } },
      }, 200, { 'mcp-session-id': 'session-2' });
    }
    return standard(call);
  });
  const client = new actor.Wan30Client({ token, origin: 'https://wan30.video', request });
  await assert.rejects(() => client.account(), (error) => error.code === 'AUTH_REQUIRED');
  assertions += 1;
  const data = await client.account();
  const initializes = calls.filter((call) => call.body && JSON.parse(call.body).method === 'initialize');
  check(initializes[1].headers['mcp-session-id'] === undefined, 'session cleared after 401');
  check(JSON.parse(initializes[1].body).id === 1, 'rpc id restarts');
  check(data.tool === 'account_status', 'account after reauth');
}

{
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call') {
      return { status: 202, headers: { 'content-type': 'application/json' }, body: '' };
    }
    return standard(call);
  });
  await assert.rejects(() => actor.run({ ...base, action: 'models' }, { request }), (error) => {
    assert.equal(error.code, 'INVALID_RESPONSE');
    assert.equal(error.status, 202);
    return true;
  });
  assertions += 1;
}

{
  const { request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call') {
      return {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: '{"models":1}' }],
            structuredContent: { data: { models: 1 } },
            isError: false,
          },
        })}\n\n`,
      };
    }
    return standard(call);
  });
  const record = await actor.run({ ...base, action: 'models' }, { request });
  check(record.data.models === 1, 'sse tool result');
}

{
  const { calls, request } = install((call) => {
    if (call.url.endsWith('/disconnect/')) return { status: 401, headers: {}, body: '' };
    return standard(call);
  });
  const record = await actor.run({ ...base, action: 'tasks' }, { request });
  const list = calls.filter((call) => call.body && call.body.includes('list_tasks')).map((call) => JSON.parse(call.body));
  assert.deepEqual(list[0].params.arguments, {});
  assertions += 1;
  check(record.disconnect === 'REVOCATION_UNCONFIRMED', 'disconnect failure is recorded');
  check(record.data.tool === 'list_tasks', 'task list still returned');
}

{
  const { calls, request } = install(standard);
  await actor.run({ ...base, action: 'tasks', limit: 7 }, { request });
  const list = calls.filter((call) => call.body && call.body.includes('list_tasks')).map((call) => JSON.parse(call.body));
  assert.deepEqual(list[0].params.arguments, { limit: 7 });
  assertions += 1;
  await actor.run({ ...base, action: 'task', taskId: 'task-1' }, { request });
  const task = calls.filter((call) => call.body && call.body.includes('get_task')).map((call) => JSON.parse(call.body));
  assert.deepEqual(task[0].params.arguments, { taskId: 'task-1' });
  assertions += 1;
  await actor.run({ ...base, action: 'model', modelId: 'wan30-reference-to-video' }, { request });
  const model = calls.filter((call) => call.body && call.body.includes('get_model')).map((call) => JSON.parse(call.body));
  assert.deepEqual(model[0].params.arguments, { modelId: 'wan30-reference-to-video' });
  assertions += 1;
}

{
  const { calls, request } = install(async () => {
    throw new Error('network');
  });
  await assert.rejects(() => actor.run({
    ...base,
    action: 'generate',
    confirmSpend: true,
    modelId: 'wan30-image-to-video',
    prompt: 'a',
    imageUrls: ['http://cdn.example/frame.png'],
  }, { request }), (error) => error.code === 'INVALID_INPUT');
  assertions += 1;
  await assert.rejects(() => actor.run({
    ...base,
    action: 'estimate',
    modelId: 'wan30-text-to-video',
    prompt: 'a',
    durationSeconds: true,
  }, { request }), (error) => error.code === 'INVALID_INPUT');
  assertions += 1;
  check(calls.length === 0, 'invalid input makes no request');
  await rejects({ ...base, action: 'account', token: '   ' }, 'INVALID_TOKEN');
  await rejects({ ...base, action: 'account', origin: 'https://wan30.video:443' }, 'INVALID_ORIGIN');
  await rejects({ ...base, action: 'generate', confirmSpend: true, prompt: 'a' }, 'INVALID_INPUT');
}

{
  const { calls, request } = install((call) => {
    const body = call.body ? JSON.parse(call.body) : null;
    if (body && body.method === 'tools/call') return toolOk({ note: token }, body.id);
    return standard(call);
  });
  await assert.rejects(() => actor.run({ ...base, action: 'account' }, { request }), (error) => error.code === 'SECRET_IN_OUTPUT');
  assertions += 1;
  check(calls.some((call) => call.url.endsWith('/disconnect/')), 'secret result still closes the session');
}

{
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const { request } = install(standard);
    await actor.run({ ...base, action: 'account' }, { request });
  } finally {
    console.log = original;
  }
  check(logs.length === 0, 'run does not log');
}

{
  let fetched = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched += 1;
    throw new Error('live fetch');
  };
  try {
    const { request } = install(standard);
    await actor.run({ ...base, action: 'account' }, { request });
  } finally {
    globalThis.fetch = original;
  }
  check(fetched === 0, 'injected request is the only network');
}

const manifest = JSON.parse(readFileSync(resolve(root, '.actor/actor.json'), 'utf8'));
const inputSchema = JSON.parse(readFileSync(resolve(root, '.actor/input_schema.json'), 'utf8'));
const outputSchema = JSON.parse(readFileSync(resolve(root, '.actor/output_schema.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
check(manifest.actorSpecification === 1 && manifest.name === 'wan30-video', 'actor name');
check(manifest.version === '0.1.0' && pkg.version === '0.1.0', 'version 0.1.0');
check(inputSchema.properties.token.isSecret === true, 'secret token');
check(inputSchema.properties.confirmSpend.default === false, 'confirm defaults off');
check(outputSchema.properties.results.template === '{{links.apiDefaultDatasetUrl}}/items', 'dataset output');
check(pkg.dependencies.apify === '3.7.2', 'pinned apify sdk');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
check(dockerfile.includes('apify/actor-node:22-slim'), 'node 22 slim image');
check(dockerfile.includes('npm install --omit=dev --omit=optional'), 'npm 10 install flags');
check(!dockerfile.includes('--only=prod'), 'deprecated npm production flag is absent');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
check(readme.includes('https://github.com/NotUsingGithub/wan27-apify-actor'), 'wan27 actor reference');
check(readme.includes('pricingModel: FREE'), 'free pricing model is named');
check(source.includes("require('apify')") && !source.startsWith("const { Actor }"), 'sdk loads only when started');

console.log(`wan30 apify tests passed (${assertions} assertions)`);
