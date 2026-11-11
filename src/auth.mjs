import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  WanClientError,
  normalizeOrigin,
  readJsonResponse,
} from './client.mjs';

export const CLIENT_ID = 'wan30-cli';
export const CALLBACK_PORT = 8787;
export const CALLBACK_PATH = '/oauth/callback';
const scopes =
  'account:read models:read generations:create tasks:read offline_access';
const nonce = () => randomBytes(32).toString('base64url');
const safeEqual = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function credentialName(origin) {
  return `credentials-${createHash('sha256').update(normalizeOrigin(origin)).digest('hex')}.json`;
}
/** Claims only partition local recovery files. Server signature/live-grant
 * verification remains mandatory for every request. */
export function tokenIdentity(token, origin) {
  try {
    if (typeof token !== 'string' || token.length > 32_768) throw new Error();
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    if (
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      typeof claims.grant_id !== 'string' ||
      !claims.grant_id ||
      claims.aud !== `${origin}/api/mcp`
    )
      throw new Error();
    return createHash('sha256')
      .update(
        JSON.stringify([
          claims.sub,
          claims.grant_id,
          claims.client_id,
          claims.aud,
        ])
      )
      .digest('hex');
  } catch {
    throw new WanClientError(
      'INVALID_TOKEN',
      'Access token is not a Wan30 API authorization. Sign in again.'
    );
  }
}
export function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = [url];
  const child = spawn(command, args, {
    shell: false,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {});
  child.unref();
}
export async function receiveAuthorization({
  origin,
  launch = openBrowser,
  report = (value) => process.stderr.write(`${value}\n`),
  port = CALLBACK_PORT,
  timeoutMs = 300_000,
}) {
  origin = normalizeOrigin(origin);
  const state = nonce();
  const verifier = nonce();
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const url = new URL('/api/auth/oauth2/authorize/', origin);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    resource: `${origin}/api/mcp`,
    scope: scopes,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve({ code, verifier, redirectUri });
    };
    const server = createServer(
      { maxHeaderSize: 8192 },
      (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'none'");
        let callback;
        try {
          callback = new URL(request.url, redirectUri);
        } catch {
          response.writeHead(400).end('Invalid callback.');
          return;
        }
        if (
          request.method !== 'GET' ||
          request.headers.host !== `127.0.0.1:${port}` ||
          callback.origin !== new URL(redirectUri).origin ||
          callback.pathname !== CALLBACK_PATH ||
          callback.searchParams.getAll('state').length !== 1 ||
          !safeEqual(callback.searchParams.get('state'), state)
        ) {
          response.writeHead(400).end('Invalid authorization callback.');
          return;
        }
        const codes = callback.searchParams.getAll('code');
        if (
          callback.searchParams.has('error') ||
          codes.length !== 1 ||
          !codes[0] ||
          codes[0].length > 4096
        ) {
          response
            .writeHead(400)
            .end('Authorization was not completed.', () =>
              finish(
                new WanClientError(
                  'AUTH_CANCELLED',
                  'Authorization was denied or incomplete.'
                )
              )
            );
          return;
        }
        response.end('Authorization received. You can close this window.', () =>
          finish(null, codes[0])
        );
      }
    );
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.setTimeout(10_000, (socket) => socket.destroy());
    server.once('error', () =>
      finish(
        new WanClientError(
          'CALLBACK_UNAVAILABLE',
          'Cannot open the local authorization callback on port 8787.'
        )
      )
    );
    server.listen(port, '127.0.0.1', () => {
      timer = setTimeout(
        () =>
          finish(
            new WanClientError(
              'AUTH_TIMEOUT',
              'Authorization timed out. Run auth login again.'
            )
          ),
        timeoutMs
      );
      report(`Open this URL to authorize Wan30:\n${url}`);
      try {
        launch(url.toString());
      } catch {
        /* Printed URL remains usable. */
      }
    });
  });
}
export class CredentialManager {
  constructor({
    origin,
    files,
    request = fetch,
    accessToken = process.env.WAN30_ACCESS_TOKEN,
    now = Date.now,
  }) {
    this.origin = normalizeOrigin(origin);
    this.files = files;
    this.request = request;
    this.accessToken = accessToken;
    this.now = now;
    this.name = credentialName(this.origin);
  }
  async exchange(fields) {
    let response;
    try {
      response = await this.request(
        new URL('/api/auth/oauth2/token/', this.origin),
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            resource: `${this.origin}/api/mcp`,
            ...fields,
          }).toString(),
        }
      );
    } catch {
      throw new WanClientError(
        'AUTH_OUTCOME_UNKNOWN',
        'Authorization response was lost. Sign in again; do not retry the same refresh token.'
      );
    }
    const data = await readJsonResponse(response, 65_536);
    if (
      response.status === 429 &&
      data.error === 'slow_down' &&
      data.refresh_token_unchanged === true &&
      fields.grant_type === 'refresh_token'
    )
      throw new WanClientError(
        'AUTH_RETRY_LATER',
        'Authorization is temporarily rate limited. Retry later.',
        429
      );
    if (!response.ok)
      throw new WanClientError(
        'AUTH_REQUIRED',
        'Authorization is no longer available. Sign in again.',
        response.status
      );
    if (
      data.token_type?.toLowerCase() !== 'bearer' ||
      typeof data.access_token !== 'string' ||
      typeof data.refresh_token !== 'string' ||
      !data.refresh_token ||
      data.refresh_token.length > 32_768 ||
      !Number.isSafeInteger(data.expires_in) ||
      data.expires_in < 1 ||
      data.expires_in > 86_400
    )
      throw new WanClientError(
        'INVALID_RESPONSE',
        'Invalid authorization response.'
      );
    tokenIdentity(data.access_token, this.origin);
    return {
      origin: this.origin,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: this.now() + data.expires_in * 1000,
      refreshUncertain: false,
    };
  }
  async login(options = {}) {
    if (this.accessToken)
      throw new WanClientError(
        'INVALID_INPUT',
        'Unset WAN30_ACCESS_TOKEN before interactive login.'
      );
    const auth = await receiveAuthorization({
      origin: this.origin,
      ...options,
    });
    return this.files.lock(this.name, async () => {
      const credentials = await this.exchange({
        grant_type: 'authorization_code',
        code: auth.code,
        code_verifier: auth.verifier,
        redirect_uri: auth.redirectUri,
      });
      await this.files.write(this.name, credentials);
      this.cached = credentials;
      return { authenticated: true, origin: this.origin };
    });
  }
  async token() {
    if (this.accessToken) {
      tokenIdentity(this.accessToken, this.origin);
      return this.accessToken;
    }
    if (this.cached?.expiresAt > this.now() + 60_000)
      return this.cached.accessToken;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.files.lock(this.name, async () => {
      const credentials = await this.files.read(this.name);
      if (
        !credentials ||
        credentials.origin !== this.origin ||
        credentials.refreshUncertain
      )
        throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
      if (
        Number.isFinite(credentials.expiresAt) &&
        credentials.expiresAt > this.now() + 60_000
      ) {
        tokenIdentity(credentials.accessToken, this.origin);
        this.cached = credentials;
        return credentials.accessToken;
      }
      if (
        typeof credentials.refreshToken !== 'string' ||
        !credentials.refreshToken
      )
        throw new WanClientError('AUTH_REQUIRED', 'Run wan30 auth login.');
      // Persist before sending: a lost response or crashed process must never
      // automatically reuse a possibly rotated refresh token.
      await this.files.write(this.name, {
        ...credentials,
        refreshUncertain: true,
      });
      let refreshed;
      try {
        refreshed = await this.exchange({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
        });
      } catch (error) {
        // Only our explicit pre-rotation rejection proves reuse is safe. Generic
        // 429/503, proxies and transport failures retain the uncertain marker.
        if (
          error instanceof WanClientError &&
          error.code === 'AUTH_RETRY_LATER'
        )
          await this.files.write(this.name, credentials);
        throw error;
      }
      await this.files.write(this.name, refreshed);
      this.cached = refreshed;
      return refreshed.accessToken;
    });
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }
  async identity() {
    return tokenIdentity(await this.token(), this.origin);
  }
  async logout(client) {
    // Revokes the server-side grant before removing this device's credentials.
    let failure;
    try {
      await client.disconnect();
    } catch {
      failure = true;
    }
    this.cached = null;
    if (!this.accessToken)
      await this.files.lock(this.name, () => this.files.remove(this.name));
    if (failure)
      throw new WanClientError(
        'REVOCATION_UNCONFIRMED',
        this.accessToken
          ? 'Environment token revocation is unconfirmed. Change your website password to disable future refreshes and unset WAN30_ACCESS_TOKEN.'
          : 'Local credentials removed; server revocation is unconfirmed. Change your website password to disable future refreshes.'
      );
    return { revoked: true, origin: this.origin };
  }
}
