import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

let networkCalls = 0;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'obsidian') {
    class ObsidianStub {}
    return {
      Plugin: ObsidianStub,
      Modal: ObsidianStub,
      PluginSettingTab: ObsidianStub,
      Setting: ObsidianStub,
      Notice: class Notice {},
      requestUrl: async () => {
        networkCalls += 1;
        throw new Error('requestUrl must not be called by the offline tests');
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const api = require('../main.js');
const {
  Wan30Client,
  Wan30Error,
  generateAfterQuote,
  waitForTask,
  validateGeneration,
  outputUrl,
  mcpSnippet,
  MCP_CONFIG,
  URLS,
  SPEND_MESSAGE,
  createRequestId,
} = api;

function scripted(responses) {
  const calls = [];
  const request = async (call) => {
    calls.push(call);
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected request ${calls.length}: ${call.url}`);
    return next;
  };
  return { calls, request };
}

function jsonResponse(id, result, session = 'session-a') {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'mcp-session-id': session },
    body: JSON.stringify({ jsonrpc: '2.0', id, result }),
  };
}

function toolResponse(id, data, session) {
  return jsonResponse(id, { structuredContent: { data } }, session);
}

function accepted() {
  return { status: 202, headers: {}, body: '' };
}

function clientWith(responses, options = {}) {
  const script = scripted(responses);
  const client = new Wan30Client({
    token: options.token || 'test-token',
    origin: options.origin || 'https://wan30.video',
    request: script.request,
  });
  return { client, calls: script.calls };
}

const input = { modelId: 'wan30-text-to-video', prompt: 'A paper boat' };
let checks = 0;
function check(condition, label) {
  assert.equal(condition, true, label);
  checks += 1;
}

assert.equal(networkCalls, 0);
check(true, 'mock requestUrl was not used while loading');

const blocked = clientWith([]);
await assert.rejects(
  blocked.client.generate(input),
  (error) => error instanceof Wan30Error && error.code === 'SPEND_NOT_CONFIRMED'
);
check(blocked.calls.length === 0, 'default confirm makes zero requests');
await assert.rejects(
  blocked.client.generate(input, { confirmSpend: false }),
  (error) => error.code === 'SPEND_NOT_CONFIRMED'
);
check(blocked.calls.length === 0, 'false confirm makes zero requests');
await assert.rejects(
  generateAfterQuote(blocked.client, input, { confirmSpend: true }),
  (error) => error.code === 'QUOTE_REQUIRED'
);
check(blocked.calls.length === 0, 'generation without a quote makes zero requests');
await assert.rejects(
  generateAfterQuote(blocked.client, input, { quote: { credits: 3 }, confirmSpend: false }),
  (error) => error.code === 'SPEND_NOT_CONFIRMED' && error.message === SPEND_MESSAGE
);
check(blocked.calls.length === 0, 'quoted but unconfirmed generation makes zero requests');
check(SPEND_MESSAGE.includes('purchased wan30.video credits'), 'spend message names purchased credits');
check(SPEND_MESSAGE.includes('check-in'), 'spend message rejects check-in credits alone');
check(SPEND_MESSAGE.includes('not sent'), 'spend message says the flag is not sent');

const quoted = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  toolResponse(1, { credits: 4 }),
]);
const estimate = await quoted.client.estimate(input);
check(estimate.credits === 4, 'estimate returns server data');
const estimateCall = quoted.calls[2];
const estimateBody = JSON.parse(estimateCall.body);
check(estimateBody.method === 'tools/call', 'estimate is a tool call');
check(estimateBody.params.name === 'estimate_generation', 'estimate tool name');
check(estimateBody.params.arguments.input.modelId === 'wan30-text-to-video', 'model is canonical');
check(estimateBody.params.arguments.input.durationSeconds === undefined, 'omitted duration is not injected');
check(estimateBody.params.arguments.input.resolution === undefined, 'omitted resolution is not injected');
check(!estimateCall.body.includes('confirm'), 'estimate body has no confirm field');
check(estimateCall.headers.Authorization === 'Bearer test-token', 'bearer token header');
check(!estimateCall.body.includes('test-token'), 'token is not in the body');
check(estimateCall.url === 'https://wan30.video/api/mcp/', 'estimate uses the MCP endpoint');
const initialize = JSON.parse(quoted.calls[0].body);
check(initialize.method === 'initialize', 'initialize method');
check(initialize.params.protocolVersion === '2025-11-25', 'protocol version');
check(JSON.stringify(initialize.params.capabilities) === '{}', 'empty capabilities object');
check(initialize.params.clientInfo.name === 'wan30-obsidian', 'client name');
check(initialize.params.clientInfo.version === '0.1.0', 'client version');
check(quoted.calls[0].headers['mcp-session-id'] === undefined, 'first request has no session');
const notice = JSON.parse(quoted.calls[1].body);
check(notice.method === 'notifications/initialized', 'initialized notification');
check(notice.id === undefined, 'notification has no id');
check(quoted.calls[1].headers['mcp-session-id'] === 'session-a', 'notification repeats the session');
check(quoted.calls[1].headers['mcp-protocol-version'] === '2025-11-25', 'negotiated protocol header');

const createdClient = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  toolResponse(1, { taskId: 'task-1' }),
]);
const created = await generateAfterQuote(createdClient.client, input, {
  quote: { credits: 4 },
  confirmSpend: true,
  requestId: 'paper-boat-request',
});
check(created.data.taskId === 'task-1', 'created task id');
check(created.requestId === 'paper-boat-request', 'retained request id');
const wire = createdClient.calls.at(-1);
const wireBody = JSON.parse(wire.body);
check(wireBody.params.name === 'generate_video', 'generate tool name');
check(JSON.stringify(Object.keys(wireBody.params.arguments).sort()) === '["input","requestId"]', 'canonical argument names');
check(wireBody.params.arguments.requestId === 'paper-boat-request', 'request id sent');
check(!/confirm/i.test(wire.body), 'confirm flag is absent from the wire');
check(wire.headers.Accept === 'application/json, text/event-stream', 'accept header');

const fresh = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  toolResponse(1, { taskId: 'task-2' }),
]);
const freshResult = await fresh.client.generate(input, { confirmSpend: true });
check(/^([A-Za-z0-9_-]{16,128})$/.test(freshResult.requestId), 'generated request id shape');
check(createRequestId() !== createRequestId(), 'request ids are not fixed');

const denied = clientWith([
  { status: 401, headers: {}, body: '' },
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }, 'session-b'),
  accepted(),
  toolResponse(1, [], 'session-b'),
]);
await assert.rejects(denied.client.account(), (error) => error.code === 'AUTH_REQUIRED' && error.status === 401);
const tasks = await denied.client.tasks(20);
check(Array.isArray(tasks) && tasks.length === 0, 'task list after reauthentication');
const taskCall = JSON.parse(denied.calls.at(-1).body);
check(taskCall.id === 1, 'session reset restarts rpc ids');
check(taskCall.params.arguments.limit === 20, 'limit is sent when provided');
check(denied.calls.at(-1).headers['mcp-session-id'] === 'session-b', 'new session id');

const errored = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'mcp-session-id': 'session-a' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ code: 'QUOTE_REQUIRED', message: 'Estimate first.' }) }],
      },
    }),
  },
]);
await assert.rejects(errored.client.task('task-1'), (error) => error.code === 'QUOTE_REQUIRED' && error.message === 'Estimate first.');
check(true, 'tool error code is preserved');

const rejected = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  accepted(),
]);
await assert.rejects(
  rejected.client.model('wan30-text-to-video'),
  (error) => error.code === 'INVALID_RESPONSE' && error.status === 202
);
check(true, 'HTTP 202 is not a tool result');

assert.throws(
  () => validateGeneration({ prompt: 'A paper boat', imageUrls: ['http://cdn.example/a.png'] }),
  (error) => error.code === 'INVALID_INPUT'
);
check(true, 'http image URL is rejected locally');
assert.throws(
  () => validateGeneration({ modelId: 'wan30-text-to-video', prompt: 'A paper boat', durationSeconds: true }),
  (error) => error.code === 'INVALID_INPUT'
);
check(true, 'boolean duration is rejected');
assert.throws(() => new Wan30Client({ token: '   ', request: async () => ({}) }), (error) => error.code === 'INVALID_TOKEN');
check(true, 'blank token is rejected locally');
assert.throws(
  () => new Wan30Client({ token: 'test-token', origin: 'https://wan30.video:443', request: async () => ({}) }),
  (error) => error.code === 'INVALID_ORIGIN'
);
check(true, 'explicit port 443 is rejected');

const disconnect = clientWith([
  { status: 401, headers: {}, body: '' },
  { status: 204, headers: {}, body: '' },
]);
await assert.rejects(disconnect.client.disconnect(), (error) => error.code === 'REVOCATION_UNCONFIRMED' && error.status === 401);
check(disconnect.calls[0].url === 'https://wan30.video/api/mcp/disconnect/', 'disconnect path');
check(disconnect.calls[0].body === undefined, 'disconnect body is empty');
check(disconnect.calls[0].headers.Authorization === 'Bearer test-token', 'disconnect sends only the bearer');
check(disconnect.calls[0].headers['mcp-session-id'] === undefined, 'disconnect does not send a session');
await disconnect.client.disconnect();
check(disconnect.calls[1].url.endsWith('/api/mcp/disconnect/'), 'successful disconnect path');

const sse = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-a' },
    body: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"data":{"ok":true}}}}\n\n',
  },
]);
const sseData = await sse.client.account();
check(sseData.ok === true, 'sse tool result');

const reference = validateGeneration({
  modelId: 'wan30-reference-to-video',
  prompt: 'Move closer',
  imageUrls: ['https://cdn.example/a.png'],
});
check(Array.isArray(reference.imageUrls) && reference.imageUrls.length === 1, 'one image URL stays an array');
const encoded = JSON.parse(JSON.stringify({ imageUrls: reference.imageUrls }));
check(Array.isArray(encoded.imageUrls), 'JSON keeps imageUrls as an array');

const waiting = clientWith([
  jsonResponse(0, { protocolVersion: '2025-11-25', capabilities: {} }),
  accepted(),
  toolResponse(1, { status: 'RUNNING', outputs: [] }),
  toolResponse(2, { status: 'SAVED_TO_R2', outputs: ['https://cdn.example/out.mp4'] }),
]);
const finished = await waitForTask(waiting.client, 'task-9', { timeoutMs: 1000, intervalMs: 0, sleep: async () => {} });
check(finished.status === 'SAVED_TO_R2', 'wait stops on the saved status');
check(outputUrl(finished) === 'https://cdn.example/out.mp4', 'https output is kept');
check(outputUrl({ status: 'COMPLETED', outputs: ['http://cdn.example/out.mp4'] }) === null, 'http output is ignored');

const config = JSON.parse(mcpSnippet().split('\n').slice(1, -2).join('\n'));
check(JSON.stringify(config) === JSON.stringify(MCP_CONFIG), 'snippet matches the config object');
check(config.mcpServers.wan30.command === 'npx', 'mcp command');
check(JSON.stringify(config.mcpServers.wan30.args) === '["-y","@wan30/cli","mcp"]', 'mcp args');
check(config.mcpServers.wan30.env === undefined, 'mcp config has no token');
check(URLS.website === 'https://wan30.video/', 'website url');
check(URLS.pricing === 'https://wan30.video/pricing/', 'pricing url');

assert.doesNotMatch(source, /process\.env|readFileSync|dotenv|\/api\/v1\/|generate_image/);
check(true, 'source has no env file reader, invented REST path, or image tool');
assert.match(source, /does not read \.env files/);
assert.match(source, /not an official Alibaba, DashScope, or Tongyi client/);
check(true, 'purchased-credit and non-affiliation wording is present');
assert.equal(networkCalls, 0);
check(true, 'offline tests never called requestUrl');

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
check(manifest.id === 'wan30-video-generator', 'plugin id');
check(manifest.version === '0.1.0', 'plugin version');
check(manifest.author === 'Wan30', 'public author');
check(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'), 'id follows the directory rules');
check(!/plugin/i.test(manifest.name) && !/obsidian/i.test(manifest.name), 'display name avoids reserved words');

console.log(`wan30 obsidian tests passed (${checks} assertions)`);
console.log(`package root ${root}`);
