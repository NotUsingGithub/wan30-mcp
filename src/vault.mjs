import { spawn } from 'node:child_process';
import { WanClientError } from './client.mjs';

function command(binary, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 131_072) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      reject(
        new WanClientError(
          'KEYCHAIN_UNAVAILABLE',
          'System keychain unavailable. To explicitly use private local files, run auth login --credential-store file.'
        )
      );
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= 131_072)
        resolve(Buffer.concat(chunks).toString('utf8').trim());
      else if (code === 44) resolve(null);
      else
        reject(
          new WanClientError(
            'KEYCHAIN_UNAVAILABLE',
            'System keychain is locked or unavailable. Unlock it, or explicitly use auth login --credential-store file.'
          )
        );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
/** Secrets enter macOS security through stdin, never argv/environment/logs. */
export class MacKeychainVault {
  constructor(files, run = command) {
    this.files = files;
    this.run = run;
  }
  account(name) {
    if (!/^credentials-[a-f0-9]{64}\.json$/.test(name))
      throw new Error('Invalid credential key');
    return name;
  }
  lock(name, action) {
    return this.files.lock(name, action);
  }
  async read(name) {
    const result = await this.run('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'wan30-cli',
      '-a',
      this.account(name),
      '-w',
    ]);
    return result === null
      ? null
      : JSON.parse(Buffer.from(result, 'base64url').toString('utf8'));
  }
  async write(name, value) {
    const data = Buffer.from(JSON.stringify(value)).toString('base64url');
    if (data.length > 87_384) throw new Error('Credential too large');
    await this.run(
      '/usr/bin/security',
      ['-i'],
      `add-generic-password -U -s wan30-cli -a ${this.account(name)} -w ${data}\n`
    );
    // security -i can exit successfully when an interactive command failed.
    const saved = await this.read(name);
    if (JSON.stringify(saved) !== JSON.stringify(value))
      throw new WanClientError(
        'KEYCHAIN_UNAVAILABLE',
        'System keychain did not confirm the credential write.'
      );
  }
  async remove(name) {
    await this.run('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      'wan30-cli',
      '-a',
      this.account(name),
    ]);
  }
}
export async function selectVault(
  files,
  selection,
  report = (value) => process.stderr.write(`${value}\n`)
) {
  if (selection !== undefined && !['file', 'keychain'].includes(selection))
    throw new WanClientError(
      'INVALID_INPUT',
      'Credential store must be file or keychain.'
    );
  const config = await files.read('credential-store.json');
  const chosen = selection ?? config?.store ?? 'keychain';
  if (chosen === 'file') {
    if (selection) {
      report(
        `Credentials will be stored in private local files (directory 0700, files 0600): ${files.directory}`
      );
      await files.write('credential-store.json', { store: 'file' });
    }
    return files;
  }
  if (process.platform !== 'darwin')
    throw new WanClientError(
      'KEYCHAIN_UNAVAILABLE',
      'This platform has no supported keychain adapter. Explicitly select private local files with auth login --credential-store file.'
    );
  if (selection)
    await files.write('credential-store.json', { store: 'keychain' });
  return new MacKeychainVault(files);
}
