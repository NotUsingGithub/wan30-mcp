"""Streamable HTTP MCP client for `POST {origin}/api/mcp/`.

Message shape follows `@modelcontextprotocol/sdk` 1.32.1, the dependency of
`@wan30/cli` 0.1.0:

* JSON-RPC ids start at 0
* `initialize` asks for protocol `2025-11-25` with empty capabilities
* `notifications/initialized` carries no params
* `tools/call` uses `{name, arguments}`
* `mcp-session-id` and `mcp-protocol-version` are sent only after the server
  has provided them
* redirects are not followed
* HTTP 401 becomes AUTH_REQUIRED

The optional GET event stream is not opened. Tool results are read from the
POST response, either `application/json` or `text/event-stream`.
"""

import json
import threading

from wan30.codec import RESPONSE_LIMIT, dump_json, load_json_bytes, media_type
from wan30.errors import WanClientError
from wan30.origin import assert_destination
from wan30.transport import TransportFailure

LATEST_PROTOCOL_VERSION = "2025-11-25"
SUPPORTED_PROTOCOL_VERSIONS = (
    LATEST_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
)
CLIENT_INFO_NAME = "wan30-python"
INITIALIZE_TIMEOUT = 60
TOOL_TIMEOUT = 300

_AUTH_MESSAGE = "Authorization expired or was revoked. Run wan30 auth login."


def _session_id(headers):
    raw = headers.get("mcp-session-id")
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not all(0x21 <= ord(char) <= 0x7E for char in raw):
        raise WanClientError(
            "INVALID_RESPONSE", "The server returned an unreadable response."
        )
    return raw


def parse_sse(payload):
    """Return JSON objects from SSE `message` events. Priming events are skipped."""
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        raise WanClientError(
            "INVALID_RESPONSE", "The server returned an unreadable response."
        ) from None
    messages = []
    data_lines = []
    event_name = None

    def flush():
        nonlocal data_lines, event_name
        if data_lines and (not event_name or event_name == "message"):
            raw = "\n".join(data_lines)
            try:
                messages.append(json.loads(raw))
            except json.JSONDecodeError:
                raise WanClientError(
                    "INVALID_RESPONSE",
                    "The server returned an unreadable response.",
                ) from None
        data_lines = []
        event_name = None

    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line == "":
            flush()
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data_lines.append(value)
        elif field == "event":
            event_name = value
    flush()
    return messages


def _rpc_messages(response):
    kind = media_type(response.headers.get("content-type"))
    if kind == "text/event-stream":
        return parse_sse(response.body)
    if kind == "application/json":
        data = load_json_bytes(response.body)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]
    raise WanClientError(
        "INVALID_RESPONSE", "The server returned an unreadable response."
    )


def _matching(messages, request_id):
    for message in messages:
        if isinstance(message, dict) and message.get("id") == request_id:
            return message
    raise WanClientError(
        "INVALID_RESPONSE", "The server returned an unreadable response."
    )


def _raise_rpc(message):
    error = message.get("error")
    if not isinstance(error, dict):
        raise WanClientError(
            "INVALID_RESPONSE", "The server returned an unreadable response."
        )
    rpc_code = error.get("code")
    text = error.get("message")
    if not isinstance(text, str) or not text:
        text = "Tool call failed."
    if rpc_code == 401:
        raise WanClientError("AUTH_REQUIRED", _AUTH_MESSAGE, 401)
    failure = WanClientError("PROTOCOL_ERROR", f"MCP error {rpc_code}: {text}")
    failure.rpc_code = rpc_code
    raise failure


class McpSession:
    def __init__(self, origin, get_token, request, client_version):
        self.origin = origin
        self.get_token = get_token
        self.request = request
        self.client_version = client_version
        self.endpoint = origin + "/api/mcp/"
        self.session_id = None
        self.protocol_version = None
        self._next_id = 0
        self._ready = False
        self._lock = threading.Lock()

    def close(self):
        with self._lock:
            self._reset()

    def _reset(self):
        self.session_id = None
        self.protocol_version = None
        self._next_id = 0
        self._ready = False

    def call_tool(self, name, arguments, *, timeout=TOOL_TIMEOUT):
        with self._lock:
            self._ensure()
            message = self._request(
                "tools/call",
                {"name": name, "arguments": arguments},
                timeout=timeout,
            )
            return message

    def _ensure(self):
        if self._ready:
            return
        try:
            result = self._request(
                "initialize",
                {
                    "protocolVersion": LATEST_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {
                        "name": CLIENT_INFO_NAME,
                        "version": self.client_version,
                    },
                },
                timeout=INITIALIZE_TIMEOUT,
            )
            version = result.get("protocolVersion") if isinstance(result, dict) else None
            if version not in SUPPORTED_PROTOCOL_VERSIONS:
                raise WanClientError(
                    "PROTOCOL_ERROR",
                    f"Server's protocol version is not supported: {version}",
                )
            self.protocol_version = version
            self._notify("notifications/initialized", timeout=INITIALIZE_TIMEOUT)
            self._ready = True
        except Exception:
            self._reset()
            raise

    def _headers(self, token):
        headers = {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
        if self.protocol_version:
            headers["mcp-protocol-version"] = self.protocol_version
        return headers

    def _post(self, payload, timeout):
        token = self.get_token()
        if not isinstance(token, str) or not token:
            raise WanClientError(
                "INVALID_TOKEN",
                "Access token is not a Wan30 API authorization. Sign in again.",
            )
        body = dump_json(payload)
        try:
            response = self.request(
                self.endpoint,
                method="POST",
                headers=self._headers(token),
                body=body,
                timeout=timeout,
                max_bytes=RESPONSE_LIMIT,
            )
        except TransportFailure as error:
            raise WanClientError(
                "PROTOCOL_ERROR", "The server response was lost."
            ) from error
        if response.status == 401:
            self._reset()
            raise WanClientError("AUTH_REQUIRED", _AUTH_MESSAGE, 401)
        session = _session_id(response.headers)
        if session:
            self.session_id = session
        return response

    def _request(self, method, params, *, timeout):
        request_id = self._next_id
        self._next_id += 1
        response = self._post(
            {
                "method": method,
                "params": params,
                "jsonrpc": "2.0",
                "id": request_id,
            },
            timeout,
        )
        if response.status == 202 or not 200 <= response.status < 300:
            raise WanClientError(
                "INVALID_RESPONSE",
                f"The server returned HTTP {response.status}.",
                response.status,
            )
        message = _matching(_rpc_messages(response), request_id)
        if "error" in message:
            _raise_rpc(message)
        if not isinstance(message.get("result"), dict):
            raise WanClientError(
                "INVALID_RESPONSE", "The server returned an unreadable response."
            )
        return message["result"]

    def _notify(self, method, *, timeout):
        response = self._post({"method": method, "jsonrpc": "2.0"}, timeout)
        if response.status not in (200, 202, 204):
            raise WanClientError(
                "INVALID_RESPONSE",
                f"The server returned HTTP {response.status}.",
                response.status,
            )

    def authorized_post(self, url, *, timeout, max_bytes):
        """POST used by disconnect. The MCP session id is not sent."""
        assert_destination(url, self.origin)
        token = self.get_token()
        if not isinstance(token, str) or not token:
            raise WanClientError(
                "INVALID_TOKEN",
                "Access token is not a Wan30 API authorization. Sign in again.",
            )
        try:
            return self.request(
                url,
                method="POST",
                headers={"Authorization": "Bearer " + token},
                body=b"",
                timeout=timeout,
                max_bytes=max_bytes,
            )
        except TransportFailure as error:
            raise WanClientError(
                "REVOCATION_UNCONFIRMED", "Could not disconnect."
            ) from error
