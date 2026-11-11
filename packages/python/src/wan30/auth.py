"""OAuth for the public `wan30-cli` client and the CLI's private file store.

PKCE, the token endpoint, refresh-token rotation, and the credential JSON
shape match `src/auth.mjs` and `src/files.mjs`. The macOS keychain adapter is
not implemented; use this file store or `WAN30_ACCESS_TOKEN`.
"""

import errno
import hashlib
import hmac
import json
import os
import secrets
import stat
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from wan30.codec import AUTH_RESPONSE_LIMIT, b64url_decode, b64url_encode, load_json_bytes
from wan30.errors import WanClientError
from wan30.origin import assert_destination, normalize_origin
from wan30.transport import TransportFailure

CLIENT_ID = "wan30-cli"
CALLBACK_PORT = 8787
CALLBACK_PATH = "/oauth/callback"
SCOPES = "account:read models:read generations:create tasks:read offline_access"
_UNSET = object()
_LOGIN_ENV = "Unset WAN30_ACCESS_TOKEN before interactive login."
_SIGN_IN = "Run wan30 auth login."
_INVALID_TOKEN = "Access token is not a Wan30 API authorization. Sign in again."
_LOST = (
    "Authorization response was lost. Sign in again; "
    "do not retry the same refresh token."
)


def credential_name(origin):
    digest = hashlib.sha256(normalize_origin(origin).encode("utf-8")).hexdigest()
    return f"credentials-{digest}.json"


def code_challenge(verifier):
    return b64url_encode(hashlib.sha256(verifier.encode("utf-8")).digest())


def token_identity(token, origin):
    """Partition local files by unsigned claims. The server still verifies the JWT."""
    origin = normalize_origin(origin)
    try:
        if not isinstance(token, str) or len(token) > 32_768:
            raise ValueError
        segment = token.split(".")[1]
        claims = json.loads(b64url_decode(segment).decode("utf-8"))
        if (
            not isinstance(claims, dict)
            or not isinstance(claims.get("sub"), str)
            or not claims["sub"]
            or not isinstance(claims.get("grant_id"), str)
            or not claims["grant_id"]
            or claims.get("aud") != f"{origin}/api/mcp"
        ):
            raise ValueError
        material = json.dumps(
            [claims["sub"], claims["grant_id"], claims.get("client_id"), claims["aud"]],
            ensure_ascii=False,
            separators=(",", ":"),
        )
    except Exception:
        raise WanClientError("INVALID_TOKEN", _INVALID_TOKEN) from None
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and value not in (float("inf"), float("-inf"))


def _safe_equal(left, right):
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    left_b, right_b = left.encode("utf-8"), right.encode("utf-8")
    if len(left_b) != len(right_b):
        return False
    return hmac.compare_digest(left_b, right_b)


def build_authorize_url(*, origin, redirect_uri, state, verifier):
    origin = normalize_origin(origin)
    query = urlencode(
        [
            ("client_id", CLIENT_ID),
            ("response_type", "code"),
            ("redirect_uri", redirect_uri),
            ("resource", f"{origin}/api/mcp"),
            ("scope", SCOPES),
            ("state", state),
            ("code_challenge", code_challenge(verifier)),
            ("code_challenge_method", "S256"),
        ]
    )
    return origin + "/api/auth/oauth2/authorize/?" + query


def evaluate_callback(*, method, target, host, state, redirect_uri):
    """Decide what a loopback callback means.

    Invalid requests return `("ignore", status, body)` and the login keeps
    waiting, matching the CLI. A denied or finished login returns
    `("finish", error or None, code or None, status, body)`.
    """
    if not isinstance(target, str) or len(target) > 8192:
        return ("ignore", 400, "Invalid callback.")
    try:
        callback = urlsplit(urljoin(redirect_uri, target))
        expected = urlsplit(redirect_uri)
    except ValueError:
        return ("ignore", 400, "Invalid callback.")
    query = parse_qs(callback.query, keep_blank_values=True)
    expected_host = expected.netloc
    if (
        method != "GET"
        or host != expected_host
        or callback.scheme != expected.scheme
        or callback.netloc != expected.netloc
        or callback.path != CALLBACK_PATH
        or len(query.get("state", [])) != 1
        or not _safe_equal(query.get("state", [None])[0], state)
    ):
        return ("ignore", 400, "Invalid authorization callback.")
    codes = query.get("code", [])
    if (
        "error" in query
        or len(codes) != 1
        or not codes[0]
        or len(codes[0]) > 4096
    ):
        return ("finish", "denied", None, 400, "Authorization was not completed.")
    return ("finish", None, codes[0], 200, "Authorization received. You can close this window.")


class _CallbackHandler(BaseHTTPRequestHandler):
    server_version = "wan30-python"

    def log_message(self, fmt, *args):
        return

    def _send(self, status, text):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Security-Policy", "default-src 'none'")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self):
        decision = evaluate_callback(
            method=self.command,
            target=self.path,
            host=self.headers.get("Host"),
            state=self.server.oauth_state,
            redirect_uri=self.server.oauth_redirect,
        )
        kind = decision[0]
        if kind == "ignore":
            self._send(decision[1], decision[2])
            return
        self._send(decision[3], decision[4])
        self.server.oauth_result = decision
        self.server.oauth_done.set()

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle
    do_HEAD = _handle


def _nonce():
    return secrets.token_urlsafe(32)


def receive_authorization(
    *,
    origin,
    launch,
    report,
    port=CALLBACK_PORT,
    timeout_s=300,
):
    origin = normalize_origin(origin)
    state = _nonce()
    verifier = _nonce()
    try:
        server = HTTPServer(("127.0.0.1", port), _CallbackHandler)
    except OSError:
        raise WanClientError(
            "CALLBACK_UNAVAILABLE",
            "Cannot open the local authorization callback on port 8787.",
        ) from None
    actual_port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{actual_port}{CALLBACK_PATH}"
    server.oauth_state = state
    server.oauth_redirect = redirect_uri
    server.oauth_done = threading.Event()
    server.oauth_result = None
    url = build_authorize_url(
        origin=origin,
        redirect_uri=redirect_uri,
        state=state,
        verifier=verifier,
    )
    server.timeout = 0.2
    stop = threading.Event()

    def serve():
        while not stop.is_set():
            server.handle_request()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        report(f"Open this URL to authorize Wan30:\n{url}")
        try:
            launch(url)
        except Exception:
            pass
        if not server.oauth_done.wait(timeout_s):
            raise WanClientError(
                "AUTH_TIMEOUT", "Authorization timed out. Run auth login again."
            )
        _kind, reason, code, _status, _body = server.oauth_result
        if reason == "denied":
            raise WanClientError(
                "AUTH_CANCELLED", "Authorization was denied or incomplete."
            )
        return {"code": code, "verifier": verifier, "redirectUri": redirect_uri}
    finally:
        stop.set()
        thread.join(timeout=2)
        server.server_close()


def _valid_name(name):
    if not isinstance(name, str) or not 1 <= len(name) <= 160 or name in {".", ".."}:
        return False
    return all(char.isascii() and (char.isalnum() or char in "._-") for char in name)


class FileVault:
    """Private JSON files. Directory 0700, files 0600, no symlink follows."""

    def __init__(self, directory):
        self.directory = os.path.abspath(directory)

    def initialize(self):
        os.makedirs(self.directory, mode=0o700, exist_ok=True)
        info = os.lstat(self.directory)
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid()
        ):
            raise WanClientError(
                "UNSAFE_CONFIG",
                "Configuration directory is not a private owned directory.",
            )
        os.chmod(self.directory, 0o700)

    def target(self, name):
        if not _valid_name(name):
            raise WanClientError("INVALID_FILE", "Invalid configuration record.")
        return os.path.join(self.directory, name)

    def read(self, name):
        self.initialize()
        path = self.target(name)
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        try:
            fd = os.open(path, flags)
        except FileNotFoundError:
            return None
        except OSError as error:
            if error.errno == errno.ELOOP:
                raise WanClientError(
                    "UNSAFE_CONFIG", "Credential or operation file is not private."
                ) from None
            raise
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_size > 65_536
                or stat.S_IMODE(info.st_mode) & 0o077
                or info.st_uid != os.geteuid()
            ):
                raise WanClientError(
                    "UNSAFE_CONFIG", "Credential or operation file is not private."
                )
            payload = os.read(fd, info.st_size + 1)
            if len(payload) != info.st_size:
                raise WanClientError(
                    "UNSAFE_CONFIG", "Credential or operation file is not private."
                )
        finally:
            os.close(fd)
        try:
            return json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise WanClientError(
                "INVALID_FILE", "Configuration record is not valid JSON."
            ) from None

    def write(self, name, value, exclusive=False):
        self.initialize()
        data = json.dumps(value, separators=(",", ":")).encode("utf-8")
        if len(data) > 65_536:
            raise WanClientError("INVALID_FILE", "Configuration record is too large.")
        destination = self.target(name)
        temporary = self.target(f"tmp-{uuid.uuid4()}")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        fd = os.open(temporary, flags, 0o600)
        try:
            os.write(fd, data)
            os.fsync(fd)
        finally:
            os.close(fd)
        try:
            if exclusive:
                os.link(temporary, destination)
            else:
                os.replace(temporary, destination)
            os.chmod(destination, 0o600)
            dir_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def remove(self, name):
        self.initialize()
        try:
            os.unlink(self.target(name))
        except FileNotFoundError:
            pass

    def lock(self, name, action, *, timeout_s=10, sleep=None):
        lock_name = f"{name}.lock"
        self.initialize()
        deadline = time.monotonic() + timeout_s
        sleep = sleep or time.sleep
        while True:
            try:
                self.write(
                    lock_name,
                    {
                        "pid": os.getpid(),
                        "createdAt": datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                    },
                    exclusive=True,
                )
                break
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise WanClientError(
                        "BUSY",
                        "Credential lock is busy: "
                        f"{self.target(lock_name)}. If its recorded process crashed, "
                        "remove this stale lock and sign in again. No refresh was retried.",
                    )
                sleep(0.1)
        try:
            return action()
        finally:
            self.remove(lock_name)


def _form(pairs):
    return urlencode(pairs).encode("utf-8")


class CredentialManager:
    def __init__(
        self,
        *,
        origin=None,
        files=None,
        request=None,
        access_token=_UNSET,
        now=None,
        receive=None,
    ):
        if origin is None:
            origin = os.environ.get("WAN30_ORIGIN") or "https://wan30.video"
        self.origin = normalize_origin(origin)
        if files is None:
            directory = os.environ.get("WAN30_CONFIG_DIR") or os.path.join(
                os.path.expanduser("~"), ".wan30"
            )
            files = FileVault(directory)
        self.files = files
        self.request = request
        if access_token is _UNSET:
            access_token = os.environ.get("WAN30_ACCESS_TOKEN")
        self.access_token = access_token or None
        self.now = now or (lambda: int(time.time() * 1000))
        self.receive = receive or receive_authorization
        self.name = credential_name(self.origin)
        self.cached = None
        self._lock = threading.Lock()

    def _http(self, url, *, headers, body, timeout):
        assert_destination(url, self.origin)
        if self.request is None:
            from wan30.transport import https_request

            try:
                return https_request(
                    url,
                    method="POST",
                    headers=headers,
                    body=body,
                    timeout=timeout,
                    max_bytes=AUTH_RESPONSE_LIMIT,
                )
            except TransportFailure:
                raise WanClientError("AUTH_OUTCOME_UNKNOWN", _LOST) from None
        try:
            return self.request(
                url,
                method="POST",
                headers=headers,
                body=body,
                timeout=timeout,
                max_bytes=AUTH_RESPONSE_LIMIT,
            )
        except TransportFailure:
            raise WanClientError("AUTH_OUTCOME_UNKNOWN", _LOST) from None

    def exchange(self, fields):
        pairs = [
            ("client_id", CLIENT_ID),
            ("resource", f"{self.origin}/api/mcp"),
            *fields,
        ]
        try:
            response = self._http(
                self.origin + "/api/auth/oauth2/token/",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
                body=_form(pairs),
                timeout=30,
            )
        except WanClientError:
            raise
        except Exception:
            raise WanClientError("AUTH_OUTCOME_UNKNOWN", _LOST) from None
        data = load_json_bytes(response.body)
        grant_type = dict(fields).get("grant_type") if not isinstance(fields, dict) else fields.get("grant_type")
        if (
            response.status == 429
            and isinstance(data, dict)
            and data.get("error") == "slow_down"
            and data.get("refresh_token_unchanged") is True
            and grant_type == "refresh_token"
        ):
            raise WanClientError(
                "AUTH_RETRY_LATER",
                "Authorization is temporarily rate limited. Retry later.",
                429,
            )
        if response.status < 200 or response.status >= 300:
            raise WanClientError(
                "AUTH_REQUIRED",
                "Authorization is no longer available. Sign in again.",
                response.status,
            )
        if not isinstance(data, dict):
            raise WanClientError("INVALID_RESPONSE", "Invalid authorization response.")
        refresh = data.get("refresh_token")
        expires_in = data.get("expires_in")
        token_type = data.get("token_type")
        if (
            not isinstance(token_type, str)
            or token_type.lower() != "bearer"
            or not isinstance(data.get("access_token"), str)
            or not isinstance(refresh, str)
            or not refresh
            or len(refresh) > 32_768
            or type(expires_in) is not int
            or not 1 <= expires_in <= 86_400
        ):
            raise WanClientError("INVALID_RESPONSE", "Invalid authorization response.")
        token_identity(data["access_token"], self.origin)
        return {
            "origin": self.origin,
            "accessToken": data["access_token"],
            "refreshToken": refresh,
            "expiresAt": self.now() + expires_in * 1000,
            "refreshUncertain": False,
        }

    def login(self, *, launch=None, report=None, port=CALLBACK_PORT, timeout_s=300):
        if self.access_token:
            raise WanClientError("INVALID_INPUT", _LOGIN_ENV)
        if launch is None:
            def launch(url):
                import webbrowser

                webbrowser.open(url)

        if report is None:
            def report(value):
                import sys

                sys.stderr.write(f"{value}\n")

        auth = self.receive(
            origin=self.origin,
            launch=launch,
            report=report,
            port=port,
            timeout_s=timeout_s,
        )
        fields = [
            ("grant_type", "authorization_code"),
            ("code", auth["code"]),
            ("code_verifier", auth["verifier"]),
            ("redirect_uri", auth["redirectUri"]),
        ]

        def save():
            credentials = self.exchange(fields)
            self.files.write(self.name, credentials)
            self.cached = credentials
            return {"authenticated": True, "origin": self.origin}

        return self.files.lock(self.name, save)

    def token(self):
        if self.access_token:
            token_identity(self.access_token, self.origin)
            return self.access_token
        now = self.now()
        if self.cached and _finite(self.cached.get("expiresAt")) and self.cached["expiresAt"] > now + 60_000:
            token_identity(self.cached["accessToken"], self.origin)
            return self.cached["accessToken"]
        with self._lock:
            return self.files.lock(self.name, self._token_locked)

    def _token_locked(self):
        credentials = self.files.read(self.name)
        if (
            not isinstance(credentials, dict)
            or credentials.get("origin") != self.origin
            or credentials.get("refreshUncertain")
        ):
            raise WanClientError("AUTH_REQUIRED", _SIGN_IN)
        now = self.now()
        if _finite(credentials.get("expiresAt")) and credentials["expiresAt"] > now + 60_000:
            token_identity(credentials["accessToken"], self.origin)
            self.cached = credentials
            return credentials["accessToken"]
        refresh = credentials.get("refreshToken")
        if not isinstance(refresh, str) or not refresh:
            raise WanClientError("AUTH_REQUIRED", _SIGN_IN)
        # Persist before sending. A lost response must not reuse a rotated token.
        uncertain = dict(credentials)
        uncertain["refreshUncertain"] = True
        self.files.write(self.name, uncertain)
        try:
            refreshed = self.exchange(
                [("grant_type", "refresh_token"), ("refresh_token", refresh)]
            )
        except WanClientError as error:
            if error.code == "AUTH_RETRY_LATER":
                self.files.write(self.name, credentials)
            raise
        self.files.write(self.name, refreshed)
        self.cached = refreshed
        return refreshed["accessToken"]

    def identity(self):
        return token_identity(self.token(), self.origin)

    def logout(self, client):
        failure = False
        try:
            client.disconnect()
        except Exception:
            failure = True
        self.cached = None
        if not self.access_token:
            self.files.lock(self.name, lambda: self.files.remove(self.name))
        if failure:
            if self.access_token:
                message = (
                    "Environment token revocation is unconfirmed. Change your website "
                    "password to disable future refreshes and unset WAN30_ACCESS_TOKEN."
                )
            else:
                message = (
                    "Local credentials removed; server revocation is unconfirmed. "
                    "Change your website password to disable future refreshes."
                )
            raise WanClientError("REVOCATION_UNCONFIRMED", message)
        return {"revoked": True, "origin": self.origin}
