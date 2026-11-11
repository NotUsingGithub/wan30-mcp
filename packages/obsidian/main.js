'use strict';

const { Plugin, Modal, Notice, PluginSettingTab, Setting } = require('obsidian');

const URLS = Object.freeze({
  website: 'https://wan30.video/',
  mcp: 'https://wan30.video/mcp/',
  mcpGuide: 'https://wan30.video/mcp/guide/',
  cli: 'https://wan30.video/cli/',
  pricing: 'https://wan30.video/pricing/',
  source: 'https://github.com/NotUsingGithub/wan30-mcp',
});

const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = Object.freeze([
  PROTOCOL_VERSION,
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
]);
const CLIENT_INFO = Object.freeze({ name: 'wan30-obsidian', version: '0.1.0' });
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
const FINISHED = Object.freeze(['SAVED_TO_R2', 'COMPLETED', 'FAILED']);
const SPEND_MESSAGE =
  'Generation spends purchased wan30.video credits. Sign-up, check-in, and gift credits alone do not qualify. Estimate this input, then confirm the spend. The confirmation flag is not sent.';

const MCP_CONFIG = Object.freeze({
  mcpServers: {
    wan30: {
      command: 'npx',
      args: ['-y', '@wan30/cli', 'mcp'],
    },
  },
});

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
  const present = Object.prototype.hasOwnProperty.call(value, 'modelId');
  const modelId = present ? value.modelId : 'wan30-reference-to-video';
  if (typeof modelId !== 'string' || !MODEL_IDS.includes(modelId)) {
    fail('INVALID_INPUT', 'modelId must be a supported Wan30 video model.');
  }
  if (modelId === 'wan30-text-to-video') {
    if (!present) fail('INVALID_INPUT', 'modelId is required.');
    validateCommon(value, TEXT_KEYS);
  } else if (modelId === 'wan30-image-to-video') {
    if (!present) fail('INVALID_INPUT', 'modelId is required.');
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

function validateLimit(limit) {
  if (limit != null) requireInteger(limit, 'limit', 1, 50);
  return limit;
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
  if (kind === 'text/event-stream') return parseSse(text);
  if (kind === 'application/json') {
    const data = parseJson(text);
    return Array.isArray(data) ? data : [data];
  }
  fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
}

function sameId(left, right) {
  return typeof left === 'number' && typeof right === 'number' && left === right;
}

function matching(messages, id) {
  for (const message of messages) {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && sameId(message.id, id)) {
      return message;
    }
  }
  fail('INVALID_RESPONSE', 'The server returned an unreadable response.');
}

class Wan30Client {
  constructor({ token, origin = 'https://wan30.video', request } = {}) {
    if (typeof token !== 'string' || token.trim() === '') {
      fail('INVALID_TOKEN', 'Add the access token in Settings → Wan30 Video. This plugin does not read .env files.');
    }
    if (typeof request !== 'function') fail('INVALID_INPUT', 'A request function is required.');
    this.token = token.trim();
    this.origin = normalizeOrigin(origin);
    this.request = request;
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 0;
    this.ready = false;
  }

  reset() {
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 0;
    this.ready = false;
  }

  async post(payload, endpoint, { emptyBody = false } = {}) {
    const url = `${this.origin}${endpoint}`;
    if (originOf(url) !== this.origin) fail('INVALID_ORIGIN', 'Unexpected authorization destination.');
    const headers = { Authorization: `Bearer ${this.token}` };
    let body;
    if (!emptyBody) {
      headers['Content-Type'] = 'application/json';
      headers.Accept = 'application/json, text/event-stream';
      if (endpoint === '/api/mcp/' && this.sessionId) headers['mcp-session-id'] = this.sessionId;
      if (endpoint === '/api/mcp/' && this.protocolVersion) {
        headers['mcp-protocol-version'] = this.protocolVersion;
      }
      body = JSON.stringify(payload);
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
    const response = await this.post(
      { jsonrpc: '2.0', id, method, params },
      '/api/mcp/'
    );
    if (response.status === 202 || response.status < 200 || response.status >= 300) {
      fail('INVALID_RESPONSE', `The server returned HTTP ${response.status}.`, response.status);
    }
    const message = matching(rpcMessages(response), id);
    if (message.error) {
      const text = message.error.message || 'Tool call failed.';
      if (sameId(message.error.code, 401)) {
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

  async generate(input, options = {}) {
    const validated = validateGeneration(input);
    if (options.requestId != null && options.requestId !== '') validateRequestId(options.requestId);
    if (options.confirmSpend !== true) {
      fail('SPEND_NOT_CONFIRMED', SPEND_MESSAGE);
    }
    const requestId = options.requestId || createRequestId();
    const data = await this.callTool('generate_video', { input: validated, requestId });
    return { data, requestId };
  }

  tasks(limit) {
    validateLimit(limit);
    const args = limit == null ? {} : { limit };
    return this.callTool('list_tasks', args);
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

async function generateAfterQuote(client, input, options = {}) {
  const validated = validateGeneration(input);
  if (options.requestId != null && options.requestId !== '') validateRequestId(options.requestId);
  if (options.quote == null) fail('QUOTE_REQUIRED', 'Estimate this input before generation.');
  if (options.confirmSpend !== true) fail('SPEND_NOT_CONFIRMED', SPEND_MESSAGE);
  return client.generate(validated, {
    confirmSpend: true,
    requestId: options.requestId,
  });
}

async function waitForTask(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs == null ? 600000 : options.timeoutMs;
  const intervalMs = options.intervalMs == null ? 5000 : options.intervalMs;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const started = now();
  for (;;) {
    const task = await client.task(taskId);
    if (task && FINISHED.includes(task.status)) return task;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      fail('WAIT_TIMEOUT', 'Stopped waiting; the task continues. The wait does not cancel it.');
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsed));
  }
}

function outputUrl(task) {
  const outputs = task && Array.isArray(task.outputs) ? task.outputs : [];
  const first = outputs[0];
  return httpsUrl(first) ? first : null;
}

function mcpSnippet() {
  return `${'```json\n'}${JSON.stringify(MCP_CONFIG, null, 2)}\n${'```'}\nDocs: ${URLS.mcp} · ${URLS.mcpGuide} · ${URLS.cli} · ${URLS.pricing}`;
}

function formInput(state) {
  const input = { modelId: state.modelId, prompt: state.prompt.trim() };
  if (state.duration !== '') input.durationSeconds = Number(state.duration);
  if (state.resolution) input.resolution = state.resolution;
  if (state.aspectRatio) input.aspectRatio = state.aspectRatio;
  if (state.hasAudio === 'true') input.hasAudio = true;
  if (state.hasAudio === 'false') input.hasAudio = false;
  if (state.modelId !== 'wan30-text-to-video') {
    input.imageUrls = state.imageUrls
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return input;
}

class TextModal extends Modal {
  constructor(app, title, text) {
    super(app);
    this.heading = title;
    this.body = text;
  }

  onOpen() {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl('pre', { cls: 'wan30-result', text: this.body });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class VideoFormModal extends Modal {
  constructor(app, plugin, mode) {
    super(app);
    this.plugin = plugin;
    this.mode = mode;
    this.state = {
      modelId: 'wan30-text-to-video',
      prompt: '',
      duration: '',
      resolution: '',
      aspectRatio: '',
      hasAudio: '',
      imageUrls: '',
      requestId: '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(this.mode === 'estimate' ? 'Estimate video' : 'Generate video');
    contentEl.createEl('p', {
      cls: 'wan30-note',
      text: 'Purchased wan30.video credits are required. Sign-up, check-in, and gift credits alone do not qualify. This is not an official Alibaba, DashScope, or Tongyi client.',
    });
    new Setting(contentEl).setName('Prompt').addTextArea((text) => {
      text.inputEl.addClass('wan30-prompt');
      text.onChange((value) => {
        this.state.prompt = value;
      });
    });
    new Setting(contentEl).setName('Model').addDropdown((dropdown) => {
      for (const modelId of MODEL_IDS) dropdown.addOption(modelId, modelId);
      dropdown.setValue(this.state.modelId);
      dropdown.onChange((value) => {
        this.state.modelId = value;
      });
    });
    new Setting(contentEl)
      .setName('Duration seconds')
      .setDesc('Leave empty to omit. Integer from 2 to 30.')
      .addText((text) => text.onChange((value) => {
        this.state.duration = value.trim();
      }));
    new Setting(contentEl).setName('Resolution').addDropdown((dropdown) => {
      dropdown.addOption('', 'Omit');
      for (const value of RESOLUTIONS) dropdown.addOption(value, value);
      dropdown.onChange((value) => {
        this.state.resolution = value;
      });
    });
    new Setting(contentEl).setName('Aspect ratio').addDropdown((dropdown) => {
      dropdown.addOption('', 'Omit');
      for (const value of ASPECT_RATIOS) dropdown.addOption(value, value);
      dropdown.onChange((value) => {
        this.state.aspectRatio = value;
      });
    });
    new Setting(contentEl).setName('Audio').addDropdown((dropdown) => {
      dropdown.addOption('', 'Omit');
      dropdown.addOption('false', 'No audio');
      dropdown.addOption('true', 'Audio');
      dropdown.onChange((value) => {
        this.state.hasAudio = value;
      });
    });
    new Setting(contentEl)
      .setName('HTTPS image URLs')
      .setDesc('One URL for a first frame. One to ten URLs for reference, one per line. Omit for text.')
      .addTextArea((text) => text.onChange((value) => {
        this.state.imageUrls = value;
      }));
    if (this.mode === 'generate') {
      new Setting(contentEl)
        .setName('Request id')
        .setDesc('Leave empty to create one after you confirm. Reuse an id only to retry the same input.')
        .addText((text) => text.onChange((value) => {
          this.state.requestId = value.trim();
        }));
    }
    new Setting(contentEl).addButton((button) => {
      button.setButtonText(this.mode === 'estimate' ? 'Estimate' : 'Estimate, then confirm').setCta();
      button.onClick(() => this.submit());
    });
  }

  async submit() {
    let input;
    try {
      input = validateGeneration(formInput(this.state));
      if (this.state.requestId) validateRequestId(this.state.requestId);
    } catch (error) {
      new Notice(error.message);
      return;
    }
    const client = this.plugin.client();
    if (!client) return;
    try {
      const quote = await client.estimate(input);
      this.close();
      if (this.mode === 'estimate') {
        new TextModal(
          this.app,
          'Estimate',
          `${JSON.stringify(quote, null, 2)}\n\nThis quote did not create a video.`
        ).open();
        return;
      }
      new ConfirmModal(this.app, this.plugin, {
        input,
        quote,
        requestId: this.state.requestId || null,
      }).open();
    } catch (error) {
      new Notice(error.message);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(app, plugin, pending) {
    super(app);
    this.plugin = plugin;
    this.pending = pending;
    this.confirmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Confirm purchased-credit spend');
    contentEl.createEl('p', {
      cls: 'wan30-note',
      text: 'The quote is below. Creating a video spends purchased credits. The confirmation stays on this device and is not sent.',
    });
    contentEl.createEl('pre', {
      cls: 'wan30-result',
      text: JSON.stringify(this.pending.quote, null, 2),
    });
    new Setting(contentEl)
      .setName('Spend purchased credits')
      .setDesc('Off by default. Turn this on only for the quoted input.')
      .addToggle((toggle) => {
        toggle.setValue(false);
        toggle.onChange((value) => {
          this.confirmed = value === true;
        });
      });
    new Setting(contentEl).addButton((button) => {
      button.setButtonText('Create video').setCta().onClick(() => this.create());
    });
  }

  async create() {
    if (this.confirmed !== true) {
      new Notice('Generation was not confirmed. No video was requested.');
      return;
    }
    const client = this.plugin.client();
    if (!client) return;
    try {
      const created = await generateAfterQuote(client, this.pending.input, {
        quote: this.pending.quote,
        confirmSpend: true,
        requestId: this.pending.requestId,
      });
      this.close();
      const taskId = created.data && created.data.taskId;
      new Notice(`Request id ${created.requestId}. Reuse it to retry this input.`);
      if (!taskId) {
        new TextModal(this.app, 'Generation', JSON.stringify(created.data, null, 2)).open();
        return;
      }
      const task = await waitForTask(client, taskId, {
        sleep: (ms) => new Promise((resolve) => {
          this.plugin.pollTimer = setTimeout(resolve, ms);
        }),
      });
      const url = task.status === 'FAILED' ? null : outputUrl(task);
      const editor = this.plugin.activeEditor();
      if (editor && url) editor.replaceSelection(`\n![](${url})\n`);
      else {
        new TextModal(
          this.app,
          'Task',
          `${JSON.stringify(task, null, 2)}\n\nRequest id: ${created.requestId}`
        ).open();
      }
    } catch (error) {
      new Notice(error.message);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ModelModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.modelId = MODEL_IDS[0];
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Show model input');
    new Setting(contentEl).setName('Model').addDropdown((dropdown) => {
      for (const modelId of MODEL_IDS) dropdown.addOption(modelId, modelId);
      dropdown.onChange((value) => {
        this.modelId = value;
      });
    });
    new Setting(contentEl).addButton((button) => {
      button.setButtonText('Show schema').setCta().onClick(async () => {
        const client = this.plugin.client();
        if (!client) return;
        try {
          const schema = await client.model(this.modelId);
          new TextModal(this.app, this.modelId, JSON.stringify(schema, null, 2)).open();
        } catch (error) {
          new Notice(error.message);
        }
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TaskModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.taskId = '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText('Read a task');
    new Setting(contentEl).setName('Task id').addText((text) => text.onChange((value) => {
      this.taskId = value.trim();
    }));
    new Setting(contentEl).addButton((button) => {
      button.setButtonText('Read').setCta().onClick(async () => {
        const client = this.plugin.client();
        if (!client) return;
        try {
          const task = await client.task(this.taskId);
          new TextModal(this.app, 'Task', JSON.stringify(task, null, 2)).open();
        } catch (error) {
          new Notice(error.message);
        }
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class Wan30SettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('p', {
      cls: 'wan30-note',
      text: 'Paste an access token from your own wan30.video account. Purchased credits are required for generation. This plugin does not read .env files or a credential store.',
    });
    new Setting(containerEl)
      .setName('Access token')
      .setDesc(`Create it with the CLI, then paste it here. Guide: ${URLS.mcpGuide}`)
      .addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Access token');
        text.setValue(this.plugin.settings.token);
        text.onChange(async (value) => {
          this.plugin.settings.token = value.trim();
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName('Service origin')
      .setDesc('Exact HTTPS origin. The default is https://wan30.video.')
      .addText((text) => {
        text.setValue(this.plugin.settings.origin);
        text.onChange(async (value) => {
          this.plugin.settings.origin = value.trim();
          await this.plugin.saveSettings();
        });
      });
  }
}

class Wan30Plugin extends Plugin {
  async onload() {
    const loaded = (await this.loadData()) || {};
    this.settings = {
      token: typeof loaded.token === 'string' ? loaded.token : '',
      origin: typeof loaded.origin === 'string' && loaded.origin ? loaded.origin : 'https://wan30.video',
    };
    this.addSettingTab(new Wan30SettingTab(this.app, this));
    this.addCommand({
      id: 'show-account',
      name: 'Show account status',
      callback: () => this.show('Account', (client) => client.account()),
    });
    this.addCommand({
      id: 'list-models',
      name: 'List models',
      callback: () => this.show('Models', (client) => client.models()),
    });
    this.addCommand({
      id: 'show-model',
      name: 'Show model input',
      callback: () => new ModelModal(this.app, this).open(),
    });
    this.addCommand({
      id: 'estimate-video',
      name: 'Estimate video',
      callback: () => new VideoFormModal(this.app, this, 'estimate').open(),
    });
    this.addCommand({
      id: 'generate-video',
      name: 'Generate video into this note',
      editorCallback: () => new VideoFormModal(this.app, this, 'generate').open(),
    });
    this.addCommand({
      id: 'show-tasks',
      name: 'Show recent tasks',
      callback: () => this.show('Tasks', (client) => client.tasks(20)),
    });
    this.addCommand({
      id: 'read-task',
      name: 'Read a task',
      callback: () => new TaskModal(this.app, this).open(),
    });
    this.addCommand({
      id: 'insert-mcp-config',
      name: 'Insert MCP configuration',
      editorCallback: (editor) => {
        editor.replaceSelection(`${mcpSnippet()}\n`);
      },
    });
  }

  onunload() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  async saveSettings() {
    this.session = null;
    await this.saveData({ token: this.settings.token, origin: this.settings.origin });
  }

  client() {
    try {
      if (!this.session || this.session.token !== this.settings.token || this.session.origin !== normalizeOrigin(this.settings.origin)) {
        this.session = new Wan30Client({
          token: this.settings.token,
          origin: this.settings.origin,
          request: (call) => obsidianRequest(call),
        });
      }
      return this.session;
    } catch (error) {
      new Notice(error.message);
      return null;
    }
  }

  activeEditor() {
    return this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
  }

  async show(title, action) {
    const client = this.client();
    if (!client) return;
    try {
      const data = await action(client);
      new TextModal(this.app, title, JSON.stringify(data, null, 2)).open();
    } catch (error) {
      new Notice(error.message);
    }
  }
}

async function obsidianRequest(call) {
  const { requestUrl } = require('obsidian');
  const params = {
    url: call.url,
    method: call.method,
    headers: call.headers,
    throw: false,
  };
  if (call.body != null) params.body = call.body;
  const response = await requestUrl(params);
  const headers = {};
  for (const key of Object.keys(response.headers || {})) headers[key.toLowerCase()] = response.headers[key];
  let body = '';
  if (typeof response.text === 'string') body = response.text;
  else if (response.json != null) body = JSON.stringify(response.json);
  return { status: response.status, headers, body };
}

module.exports = Wan30Plugin;
module.exports.Wan30Client = Wan30Client;
module.exports.Wan30Error = Wan30Error;
module.exports.generateAfterQuote = generateAfterQuote;
module.exports.waitForTask = waitForTask;
module.exports.validateGeneration = validateGeneration;
module.exports.outputUrl = outputUrl;
module.exports.mcpSnippet = mcpSnippet;
module.exports.MCP_CONFIG = MCP_CONFIG;
module.exports.URLS = URLS;
module.exports.SPEND_MESSAGE = SPEND_MESSAGE;
module.exports.createRequestId = createRequestId;
