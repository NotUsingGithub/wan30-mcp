#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CredentialManager } from './auth.mjs';
import { WanClient, WanClientError } from './client.mjs';
import { PrivateFiles } from './files.mjs';
import { readBoundedFile } from './input.mjs';
import { createLocalMcpServer } from './mcp.mjs';
import { downloadTask, waitForTask } from './media.mjs';
import { selectVault } from './vault.mjs';

let client;
// In MCP mode stdout carries the protocol, so nothing else may write to it.
let stdioMode = false;
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const report = (value) => process.stderr.write(`${value}\n`);
const help = `wan30 — generate videos with your wan30.video credits

  auth login [--credential-store keychain|file] [--no-browser]
  auth status | auth logout
  account                         Credits and access status
  models | model <modelId>        Models, prices and input schema
  estimate --input <json-file>    Credits a generation would cost
  create --input <json-file> [--request-id <id>] [--wait]
  tasks [--limit <1..50>]
  task <taskId> | wait <taskId> [--timeout <seconds>]
  download <taskId> --output <file> [--index <n>]
  mcp                             Start a local MCP server on stdio
  --origin <https-origin>         Default https://wan30.video

Results are JSON on stdout. Retrying create with the same --request-id never
charges twice. A wait timeout does not cancel the task.
`;

async function inputFile(file) {
  if (!file)
    throw new WanClientError(
      'INVALID_INPUT',
      '--input <json-file> is required.'
    );
  try {
    return JSON.parse((await readBoundedFile(file, 32_768)).toString('utf8'));
  } catch (error) {
    if (error instanceof WanClientError) throw error;
    throw new WanClientError('INVALID_INPUT', 'Input file is not valid JSON.');
  }
}

function required(value, label) {
  if (!value)
    throw new WanClientError('INVALID_INPUT', `${label} is required.`);
  return value;
}

async function main() {
  if (!['darwin', 'linux'].includes(process.platform))
    throw new WanClientError(
      'UNSUPPORTED_PLATFORM',
      'This CLI currently supports macOS and Linux (including WSL).'
    );
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      origin: { type: 'string' },
      input: { type: 'string' },
      'request-id': { type: 'string' },
      wait: { type: 'boolean' },
      limit: { type: 'string' },
      timeout: { type: 'string' },
      output: { type: 'string' },
      index: { type: 'string' },
      'credential-store': { type: 'string' },
      'no-browser': { type: 'boolean' },
    },
  });
  if (values.help || !positionals.length) {
    process.stdout.write(help);
    return;
  }
  const [command, id] = positionals;
  if (positionals.length > 2)
    throw new WanClientError(
      'INVALID_INPUT',
      'Unexpected positional arguments.'
    );
  const files = new PrivateFiles();
  const origin =
    values.origin ?? process.env.WAN30_ORIGIN ?? 'https://wan30.video';
  stdioMode = command === 'mcp';
  let credentials;
  const resolveAuth = async () => {
    credentials ??= new CredentialManager({
      origin,
      // An explicitly provided bearer avoids touching the keychain for CI use.
      files: process.env.WAN30_ACCESS_TOKEN
        ? files
        : await selectVault(files, values['credential-store'], report),
    });
    return credentials;
  };
  // The MCP server has to start and list its tools before anyone has signed
  // in, so it looks credentials up on each call. Other commands need them now.
  const auth = stdioMode ? undefined : await resolveAuth();
  client = new WanClient({
    origin,
    getToken: async () => (await resolveAuth()).token(),
  });
  const timeoutMs = Number(values.timeout ?? 600) * 1000;

  if (command === 'auth') {
    if (id === 'login')
      output(
        await auth.login({
          ...(values['no-browser'] ? { launch: () => {} } : {}),
          report,
        })
      );
    else if (id === 'logout') {
      output(await auth.logout(client));
      if (process.env.WAN30_ACCESS_TOKEN)
        report('Unset WAN30_ACCESS_TOKEN in your shell.');
    } else if (id === 'status') {
      await client.account();
      output({ authenticated: true, origin });
    } else
      throw new WanClientError(
        'INVALID_INPUT',
        'Expected auth login, status or logout.'
      );
  } else if (command === 'account') output(await client.account());
  else if (command === 'models') output(await client.models());
  else if (command === 'model')
    output(await client.model(required(id, 'model ID')));
  else if (command === 'estimate')
    output(await client.estimate(await inputFile(values.input)));
  else if (command === 'create') {
    const input = await inputFile(values.input);
    const requestId = values['request-id'] ?? randomUUID();
    report(`Request ID: ${requestId} (reuse it to retry without a new charge)`);
    const created = await client.generate(input, requestId);
    output(
      values.wait
        ? await waitForTask(client, created.taskId, { timeoutMs })
        : created
    );
  } else if (command === 'tasks') {
    const limit = Number(values.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new WanClientError('INVALID_INPUT', 'Limit must be 1..50.');
    output(await client.tasks({ limit }));
  } else if (command === 'task')
    output(await client.task(required(id, 'task ID')));
  else if (command === 'wait')
    output(await waitForTask(client, required(id, 'task ID'), { timeoutMs }));
  else if (command === 'download')
    output(
      await downloadTask(
        client,
        required(id, 'task ID'),
        required(values.output, '--output'),
        { index: Number(values.index ?? 0) }
      )
    );
  else if (command === 'mcp') {
    const server = createLocalMcpServer({ client });
    await server.connect(new StdioServerTransport());
    // Serve until the assistant closes the pipe or the process is signalled.
    await new Promise((resolve) => {
      server.onclose = resolve;
      process.stdin.once('end', resolve);
      process.stdin.once('close', resolve);
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    await server.close();
  } else
    throw new WanClientError(
      'INVALID_INPUT',
      'Unknown command. Run wan30 --help.'
    );
}

main()
  .finally(() => client?.close())
  .catch((error) => {
    const emit = stdioMode ? (value) => report(JSON.stringify(value)) : output;
    emit({
      error: {
        code: error.code ?? 'CLI_ERROR',
        message:
          error instanceof WanClientError
            ? error.message
            : 'Command failed. Check your input and try again.',
      },
    });
    process.exitCode = 1;
  });
