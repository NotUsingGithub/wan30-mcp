'use strict';

const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = Object.freeze([
  PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);
const CLIENT_INFO = Object.freeze({ name: 'wan30-apify', version: '0.1.0' });
const ACTIONS = Object.freeze([
  'account',
  'models',
  'model',
  'estimate',
  'generate',
  'tasks',
  'task',
]);
const MODEL_IDS = Object.freeze([
  'wan30-text-to-video',
  'wan30-image-to-video',
  'wan30-reference-to-video',
]);
const RESOLUTIONS = Object.freeze(['480p', '720p', '1080p']);
const ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4']);
const REFERENCE_KEYS = Object.freeze([
  'prompt',
  'durationSeconds',
  'resolution',
  'aspectRatio',
  'hasAudio',
  'modelId',
  'imageUrls',
]);
const TEXT_KEYS = Object.freeze(REFERENCE_KEYS.filter((key) => key !== 'imageUrls'));
const INPUT_KEYS = Object.freeze([
  'token',
  'origin',
  'action',
  'modelId',
  'prompt',
  'imageUrls',
  'durationSeconds',
  'resolution',
  'aspectRatio',
  'hasAudio',
  'confirmSpend',
  'requestId',
  'taskId',
  'limit',
]);
const RESPONSE_LIMIT = 2_097_152;
const SPEND_MESSAGE =
  'Generation spends purchased wan30.video credits. Sign-up, check-in, and gift credits alone do not qualify. This is not an official Alibaba, DashScope, or Tongyi client. Set confirmSpend to true only after you accept the estimate. The confirmation flag is not sent. This Actor does not read .env files.';

class Wan30Error extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'Wan30Error';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new Wan30Error(code, message, status);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || !value.startsWith('https://')) {
    fail('INVALID_ORIGIN', 'Use an exact HTTPS service origin.');
  }
  const rest = value.slice('https://'.length);
  if (rest.length === 0 || /[/?#@\\\s]/.test(rest)) {
    fail('INVALID_ORIGIN', 'Use an exact HTTPS service origin.');
  }
  const pieces = rest.split(':');
  let canon;
  if (pieces.length === 1) canon = `https://${pieces[0].toLowerCase()}`;
  else if (pieces.length === 2) {
    const host = pieces[0];
    const port = pieces[1];
    if (host.length === 0 || !/^[0-9]+$/.test(port) || port === '443') {
      fail('INVALID_ORIGIN', 'Use an exact HTTPS service origin.');
    }
    canon = `https://${host.toLowerCase()}:${port}`;
  } else fail('INVALID_ORIGIN', 'Use an exact HTTPS service origin.');
  if (canon !== value) fail('INVALID_ORIGIN', 'Use an exact HTTPS service origin.');
  return value;
}

function originOf(url) {
  const match = /^https:\/\/[^/?#]+/.exec(url);
  if (!match) return null;
  try {
    return normalizeOrigin(match[0]);
  } catch (_error) {
    return null;
  }
}

function httpsUrl(url) {
  if (typeof url !== 'string' || /\s/.test(url) || !url.startsWith('https://')) return false;
  const rest = url.slice('https://'.length);
  if (rest.length === 0 || rest.includes('@')) return false;
  const host = rest.split(/[/?#]/, 1)[0];
  return host.length > 0 && !host.startsWith(':');
}

function wholeNumber(value) {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

function requireInteger(value, label, low, high) {
  if (!wholeNumber(value) || value < low || value > high) {
    fail('INVALID_INPUT', `${label} must be an integer from ${low} to ${high}.`);
  }
}

function validateImageUrls(urls, low, high) {
  if (!Array.isArray(urls) || urls.length < low || urls.length > high) {
    fail('INVALID_INPUT', `imageUrls must contain ${low} to ${high} HTTPS URLs.`);
  }
  for (const url of urls) {
    if (!httpsUrl(url)) fail('INVALID_INPUT', 'imageUrls entries must be HTTPS URLs.');
  }
}

function validateCommon(value, allowed) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (extra.length) fail('INVALID_INPUT', `Unexpected generation field: ${extra.join(', ')}.`);
  const prompt = value.prompt;
  if (typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 1500) {
    fail('INVALID_INPUT', 'prompt must be 1 to 1500 characters.');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'durationSeconds')) {
    requireInteger(value.durationSeconds, 'durationSeconds', 2, 30);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'resolution') &&
    !RESOLUTIONS.includes(value.resolution)
  ) {
    fail('INVALID_INPUT', 'resolution must be 480p, 720p or 1080p.');
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'aspectRatio') &&
    !ASPECT_RATIOS.includes(value.aspectRatio)
  ) {
    fail('INVALID_INPUT', 'aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4.');
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'hasAudio') &&
    typeof value.hasAudio !== 'boolean'
  ) {
    fail('INVALID_INPUT', 'hasAudio must be a boolean.');
  }
}

function validateGeneration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_INPUT', 'Generation input must be an object.');
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'modelId')) {
    fail('INVALID_INPUT', 'modelId is required.');
  }
  const { modelId } = value;
  if (typeof modelId !== 'string' || !MODEL_IDS.includes(modelId)) {
    fail('INVALID_INPUT', 'modelId must be a supported Wan30 video model.');
  }
  if (modelId === 'wan30-text-to-video') validateCommon(value, TEXT_KEYS);
  else if (modelId === 'wan30-image-to-video') {
    validateCommon(value, REFERENCE_KEYS);
    validateImageUrls(value.imageUrls, 1, 1);
  } else {
    validateCommon(value, REFERENCE_KEYS);
    validateImageUrls(value.imageUrls, 1, 10);
  }
  return { ...value };
}

function validateRequestId(requestId) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    fail('INVALID_INPUT', 'requestId must match ^[A-Za-z0-9_-]{16,128}$.');
  }
  return requestId;
}

function validateTaskId(taskId) {
  if (typeof taskId !== 'string' || taskId.length < 1 || taskId.length > 128) {
    fail('INVALID_INPUT', 'taskId must be 1 to 128 characters.');
  }
  return taskId;
}

function createRequestId() {
  const bytes = new Uint8Array(16);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') cryptoRef.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

function mediaType(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  return value.split(';', 1)[0].trim().toLowerCase();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
  }
}

function parseSse(payload) {
  const text = String(payload).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const messages = [];
  let dataLines = [];
  let eventName = null;
  const flush = () => {
    if (dataLines.length && (eventName == null || eventName === '' || eventName === 'message')) {
      messages.push(parseJson(dataLines.join('\n')));
    }
    dataLines = [];
    eventName = null;
  };
  for (const line of text.split('\n')) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith(':')) continue;
    const split = line.indexOf(':');
    const field = split < 0 ? line : line.slice(0, split);
    let value = split < 0 ? '' : line.slice(split + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
  }
  flush();
  return messages;
}

function rpcMessages(response) {
  const kind = mediaType(headerValue(response.headers, 'content-type'));
  let text = response.body;
  if (text == null) text = '';
  if (typeof text !== 'string') text = String(text);
  if (Buffer.byteLength(text) > RESPONSE_LIMIT) {
    fail('INVALID_RESPONSE', 'The server response exceeded the size limit.');
  }
  if (kind === 'text/event-stream') return parseSse(text);
  if (kind === 'application/json') {
    const data = parseJson(text);
    return Array.isArray(data) ? data : [data];
  }
  fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
}

function matching(messages, id) {
  for (const message of messages) {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && message.id === id) {
      return message;
    }
  }
  fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
}

function generationFrom(input) {
  if (!Object.prototype.hasOwnProperty.call(input, 'modelId')) {
    fail('INVALID_INPUT', 'modelId is required.');
  }
  const value = { prompt: input.prompt, modelId: input.modelId };
  if (input.modelId === 'wan30-text-to-video') {
    if (input.imageUrls != null) fail('INVALID_INPUT', 'Unexpected generation field: imageUrls.');
  } else if (Object.prototype.hasOwnProperty.call(input, 'imageUrls')) {
    value.imageUrls = input.imageUrls;
  }
  for (const key of ['durationSeconds', 'resolution', 'aspectRatio', 'hasAudio']) {
    if (input[key] != null) value[key] = input[key];
  }
  return validateGeneration(value);
}

function knownInput(input) {
  const extra = Object.keys(input).filter((key) => !INPUT_KEYS.includes(key)).sort();
  if (extra.length) fail('INVALID_INPUT', `Unexpected input field: ${extra.join(', ')}.`);
  if (!ACTIONS.includes(input.action)) fail('INVALID_INPUT', 'action must be a supported Wan30 action.');
}

function rejectSecret(value, token) {
  if (typeof token === 'string' && token.length >= 8 && JSON.stringify(value).includes(token)) {
    fail('SECRET_IN_OUTPUT', 'The result contained the access token and was discarded.');
  }
}

function localOnlyKey(value) {
  if (!value || typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    const folded = key.toLowerCase();
    if (folded === 'confirmspend' || folded === 'confirm') return true;
    if (localOnlyKey(value[key])) return true;
  }
  return false;
}

class Wan30Client {
  constructor({ token, origin = 'https://wan30.video', request } = {}) {
    if (typeof token !== 'string' || token.length === 0 || token.trim() !== token || token.trim() === '') {
      fail('INVALID_TOKEN', 'Add the access token to the secret input. This Actor does not read .env files.');
    }
    if (typeof request !== 'function') fail('INVALID_INPUT', 'A request function is required.');
    this.token = token;
    this.origin = normalizeOrigin(origin);
    this.request = request;
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
    this.ready = false;
  }

  reset() {
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
    this.ready = false;
  }

  async post(payload, endpoint, { emptyBody = false } = {}) {
    const url = `${this.origin}${endpoint}`;
    if (originOf(url) !== this.origin) fail('INVALID_ORIGIN', 'Unexpected authorization destination.');
    if (this.token.length >= 8 && url.includes(this.token)) {
      fail('SECRET_IN_OUTPUT', 'The access token was removed from the request URL.');
    }
    const headers = { Authorization: `Bearer ${this.token}` };
    let body;
    if (!emptyBody) {
      headers['Content-Type'] = 'application/json';
      headers.Accept = 'application/json, text/event-stream';
      if (endpoint === '/api/mcp/' && this.sessionId) headers['mcp-session-id'] = this.sessionId;
      if (endpoint === '/api/mcp/' && this.protocolVersion) {
        headers['mcp-protocol-version'] = this.protocolVersion;
      }
      if (localOnlyKey(payload)) fail('LOCAL_FIELD', 'A local confirmation field was blocked before the request.');
      body = JSON.stringify(payload);
      if (this.token.length >= 8 && body.includes(this.token)) {
        fail('SECRET_IN_OUTPUT', 'The access token was removed from the request body.');
      }
    }
    let response;
    try {
      response = await this.request({ method: 'POST', url, headers, body });
    } catch (error) {
      if (error instanceof Wan30Error) throw error;
      fail('PROTOCOL_ERROR', 'The server response was lost.');
    }
    const status = Number(response.status);
    if (status >= 300 && status < 400) {
      fail('INVALID_RESPONSE', `The server returned HTTP ${status}. Redirects are not followed.`, status);
    }
    if (status === 401 && endpoint === '/api/mcp/') {
      this.reset();
      fail('AUTH_REQUIRED', 'Authorization expired or was revoked. Sign in again with the Wan30 CLI.', 401);
    }
    const session = headerValue(response.headers, 'mcp-session-id');
    if (endpoint === '/api/mcp/' && session != null && session !== '') {
      if (typeof session !== 'string' || [...session].some((char) => {
        const code = char.codePointAt(0);
        return code < 0x21 || code > 0x7e;
      })) {
        fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
      }
      this.sessionId = session;
    }
    return { ...response, status };
  }

  async requestRpc(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    const response = await this.post({ jsonrpc: '2.0', id, method, params }, '/api/mcp/');
    if (response.status === 202 || response.status < 200 || response.status >= 300) {
      fail('INVALID_RESPONSE', `The server returned HTTP ${response.status}.`, response.status);
    }
    const message = matching(rpcMessages(response), id);
    if (message.error) {
      const text = message.error.message || 'Tool call failed.';
      if (message.error.code === 401) {
        fail('AUTH_REQUIRED', 'Authorization expired or was revoked. Sign in again with the Wan30 CLI.', 401);
      }
      fail('PROTOCOL_ERROR', `MCP error ${message.error.code}: ${text}`);
    }
    if (!message.result || typeof message.result !== 'object') {
      fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
    }
    return message.result;
  }

  async notify(method) {
    const response = await this.post({ jsonrpc: '2.0', method }, '/api/mcp/');
    if (![200, 202, 204].includes(response.status)) {
      fail('INVALID_RESPONSE', `The server returned HTTP ${response.status}.`, response.status);
    }
  }

  async ensureReady() {
    if (this.ready) return;
    try {
      const result = await this.requestRpc('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_INFO.name, version: CLIENT_INFO.version },
      });
      if (!SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
        fail('PROTOCOL_ERROR', `Server's protocol version is not supported: ${result.protocolVersion}`);
      }
      this.protocolVersion = result.protocolVersion;
      await this.notify('notifications/initialized');
      this.ready = true;
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  async callTool(name, args) {
    await this.ensureReady();
    const result = await this.requestRpc('tools/call', { name, arguments: args });
    if (result.isError === true) {
      let parsed = null;
      const text = result.content && result.content[0] && result.content[0].text;
      if (typeof text === 'string') {
        try {
          parsed = JSON.parse(text);
        } catch (_error) {
          parsed = null;
        }
      }
      const code = parsed && parsed.code ? parsed.code : 'TOOL_ERROR';
      const message = (parsed && parsed.message) || text || 'Tool call failed.';
      fail(code, message);
    }
    if (!result.structuredContent || !Object.prototype.hasOwnProperty.call(result.structuredContent, 'data')) {
      fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
    }
    return result.structuredContent.data;
  }

  account() {
    return this.callTool('account_status', {});
  }

  models() {
    return this.callTool('list_models', {});
  }

  model(modelId) {
    if (!MODEL_IDS.includes(modelId)) fail('INVALID_INPUT', 'modelId must be a supported Wan30 video model.');
    return this.callTool('get_model', { modelId });
  }

  estimate(input) {
    return this.callTool('estimate_generation', { input: validateGeneration(input) });
  }

  generateVideo(input, requestId) {
    return this.callTool('generate_video', {
      input: validateGeneration(input),
      requestId: validateRequestId(requestId),
    });
  }

  tasks(limit) {
    if (limit != null) requireInteger(limit, 'limit', 1, 50);
    return this.callTool('list_tasks', limit == null ? {} : { limit });
  }

  task(taskId) {
    return this.callTool('get_task', { taskId: validateTaskId(taskId) });
  }

  async disconnect() {
    const response = await this.post(null, '/api/mcp/disconnect/', { emptyBody: true });
    if (response.status < 200 || response.status >= 300) {
      fail('REVOCATION_UNCONFIRMED', 'Could not disconnect.', response.status);
    }
  }
}

async function run(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_INPUT', 'Input must be an object.');
  }
  if (input.action === 'generate' && input.confirmSpend !== true) {
    fail('SPEND_NOT_CONFIRMED', SPEND_MESSAGE);
  }
  knownInput(input);
  const client = new Wan30Client({
    token: input.token,
    origin: input.origin == null || input.origin === '' ? 'https://wan30.video' : input.origin,
    request: options.request,
  });
  let data;
  let requestId;
  let disconnectCode;
  try {
    if (input.action === 'account') data = await client.account();
    else if (input.action === 'models') data = await client.models();
    else if (input.action === 'model') data = await client.model(input.modelId);
    else if (input.action === 'estimate') data = await client.estimate(generationFrom(input));
    else if (input.action === 'tasks') data = await client.tasks(input.limit);
    else if (input.action === 'task') data = await client.task(input.taskId);
    else {
      const generation = generationFrom(input);
      const quote = await client.estimate(generation);
      if (quote == null) {
        fail('QUOTE_REQUIRED', 'Generation requires a successful estimate. No video was requested.');
      }
      requestId = input.requestId == null || input.requestId === ''
        ? createRequestId()
        : validateRequestId(input.requestId);
      data = await client.generateVideo(generation, requestId);
    }
  } finally {
    if (client.ready) {
      try {
        await client.disconnect();
      } catch (error) {
        disconnectCode = error instanceof Wan30Error ? error.code : 'REVOCATION_UNCONFIRMED';
      }
    }
  }
  const record = { action: input.action, data };
  if (requestId) record.requestId = requestId;
  if (disconnectCode) record.disconnect = 'REVOCATION_UNCONFIRMED';
  rejectSecret(record, client.token);
  return record;
}

async function httpRequest({ method, url, headers, body }) {
  const response = await fetch(url, { method, headers, body, redirect: 'manual' });
  const text = await response.text();
  const mapped = {};
  response.headers.forEach((value, key) => {
    mapped[key] = value;
  });
  return { status: response.status, headers: mapped, body: text };
}

async function start() {
  const { Actor } = require('apify');
  await Actor.main(async () => {
    const input = await Actor.getInput();
    const output = await run(input, { request: httpRequest });
    await Actor.pushData(output);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error instanceof Wan30Error ? error.code : 'ACTOR_FAILED');
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIONS,
  CLIENT_INFO,
  MODEL_IDS,
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  Wan30Client,
  Wan30Error,
  createRequestId,
  generationFrom,
  run,
  validateGeneration,
};
