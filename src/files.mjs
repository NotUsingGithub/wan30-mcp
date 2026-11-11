import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { WanClientError } from './client.mjs';

export class PrivateFiles {
  constructor(
    directory = process.env.WAN30_CONFIG_DIR || path.join(homedir(), '.wan30')
  ) {
    this.directory = path.resolve(directory);
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new WanClientError(
        'UNSAFE_CONFIG',
        'Configuration directory is not a private owned directory.'
      );
    await chmod(this.directory, 0o700);
  }
  target(name) {
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(name))
      throw new WanClientError('INVALID_FILE', 'Invalid configuration record.');
    return path.join(this.directory, name);
  }
  async read(name) {
    await this.initialize();
    let handle;
    try {
      handle = await open(
        this.target(name),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      const info = await handle.stat();
      if (
        !info.isFile() ||
        info.size > 65_536 ||
        info.mode & 0o077 ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw new WanClientError(
          'UNSAFE_CONFIG',
          'Credential or operation file is not private.'
        );
      return JSON.parse(await handle.readFile('utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }
  async write(name, value, exclusive = false) {
    await this.initialize();
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 65_536)
      throw new WanClientError(
        'INVALID_FILE',
        'Configuration record is too large.'
      );
    const destination = this.target(name);
    const temporary = this.target(`tmp-${randomUUID()}`);
    let handle;
    try {
      handle = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      );
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = null;
      if (exclusive) await link(temporary, destination);
      else await rename(temporary, destination);
      const directory = await open(this.directory, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await handle?.close();
      await rm(temporary, { force: true });
    }
  }
  async remove(name) {
    await this.initialize();
    await rm(this.target(name), { force: true });
  }
  async lock(name, action) {
    // No TTL takeover of a live refresh. A stale lock is reported rather than
    // risking rotating the same refresh token twice after a lost response.
    const lock = `${name}.lock`;
    await this.initialize();
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        await this.write(
          lock,
          { pid: process.pid, createdAt: new Date().toISOString() },
          true
        );
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline)
          throw new WanClientError(
            'BUSY',
            `Credential lock is busy: ${this.target(lock)}. If its recorded process crashed, remove this stale lock and sign in again. No refresh was retried.`
          );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    try {
      return await action();
    } finally {
      await this.remove(lock);
    }
  }
}
