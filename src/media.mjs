import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { WanClientError } from './client.mjs';

const MAX_BYTES = 512 * 1024 * 1024;
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4'];

/** Downloads a finished task's output. Output URLs are public storage URLs, so
 * the access token is never sent with this request. Never overwrites a file. */
export async function downloadTask(
  client,
  taskId,
  destination,
  { index = 0, request = fetch } = {}
) {
  const task = await client.task(taskId);
  if (!['SAVED_TO_R2', 'COMPLETED'].includes(task.status))
    throw new WanClientError(
      'TASK_NOT_READY',
      `Task is ${task.status}. Run wan30 wait ${taskId} first.`
    );
  const source = task.outputs?.[index];
  if (typeof source !== 'string' || !source.startsWith('https://'))
    throw new WanClientError('DOWNLOAD_UNAVAILABLE', 'Task has no output.');
  const target = path.resolve(destination);
  const temporary = path.join(
    path.dirname(target),
    `.wan30-download-${randomUUID()}`
  );
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 600_000);
  let file;
  let bytes = 0;
  try {
    file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    const response = await request(source, {
      redirect: 'follow',
      signal: abort.signal,
    });
    const type = response.headers.get('content-type')?.split(';')[0].trim();
    if (!response.ok || !response.body)
      throw new WanClientError(
        'DOWNLOAD_UNAVAILABLE',
        `Download returned HTTP ${response.status}.`,
        response.status
      );
    if (!MEDIA_TYPES.includes(type))
      throw new WanClientError('INVALID_RESPONSE', 'Unexpected media type.');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES)
        throw new WanClientError('INVALID_RESPONSE', 'Media is too large.');
      await file.writeFile(chunk);
    }
    await file.sync();
    await file.close();
    file = null;
    // Hard-link publication is atomic and refuses to overwrite an existing file.
    await link(temporary, target);
    return { taskId, path: target, bytes, contentType: type };
  } finally {
    clearTimeout(timer);
    await file?.close();
    await unlink(temporary).catch(() => {});
  }
}

export async function waitForTask(
  client,
  taskId,
  {
    timeoutMs = 600_000,
    intervalMs = 5000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 86_400_000
  )
    throw new WanClientError(
      'INVALID_INPUT',
      'Wait timeout must be 1 ms to 24 hours.'
    );
  const until = now() + timeoutMs;
  do {
    const task = await client.task(taskId);
    if (['SAVED_TO_R2', 'COMPLETED', 'FAILED'].includes(task.status))
      return task;
    const remaining = until - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  } while (now() < until);
  throw new WanClientError(
    'WAIT_TIMEOUT',
    `Stopped waiting; the task continues. Run wan30 wait ${taskId} again later.`
  );
}
