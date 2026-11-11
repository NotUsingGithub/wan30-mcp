import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { WanClientError } from './client.mjs';

export async function readBoundedFile(filename, limit) {
  const handle = await open(filename, constants.O_RDONLY);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit)
      throw new WanClientError(
        'INVALID_INPUT',
        `Input must be a regular file no larger than ${limit} bytes.`
      );
    const data = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(
        data,
        offset,
        data.length - offset,
        offset
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size)
      throw new WanClientError(
        'INVALID_INPUT',
        'Input file changed while reading.'
      );
    return data.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
