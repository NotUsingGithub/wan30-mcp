"""Shared fakes. Nothing here contacts a network."""

import base64
import json
from types import SimpleNamespace

from wan30.transport import HttpResponse


def b64url(value):
    raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def jwt(payload):
    return b64url({"alg": "none", "typ": "JWT"}) + "." + b64url(payload) + ".sig"


def access_token(origin="https://wan30.video", **extra):
    claims = {
        "sub": "user",
        "grant_id": "grant",
        "client_id": "wan30-cli",
        "aud": f"{origin}/api/mcp",
    }
    claims.update(extra)
    return jwt(claims)


def http_json(status, payload, headers=None):
    merged = {"content-type": "application/json"}
    if headers:
        merged.update(headers)
    return HttpResponse(status, merged, json.dumps(payload).encode("utf-8"))


def tool_result(data, *, error=False):
    return {
        "content": [{"type": "text", "text": json.dumps(data)}],
        "structuredContent": {"data": data},
        "isError": error,
    }


class Script:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, *, method, headers, body, timeout, max_bytes):
        self.calls.append(
            SimpleNamespace(
                url=url,
                method=method,
                headers=dict(headers),
                body=body,
                timeout=timeout,
                max_bytes=max_bytes,
            )
        )
        if not self.responses:
            raise AssertionError(f"unexpected {method} {url}")
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def handshake(result, *, session="sess-1", version="2025-11-25", tool_status=200):
    init = http_json(
        200,
        {
            "jsonrpc": "2.0",
            "id": 0,
            "result": {
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "wan30", "version": "0.1.0"},
            },
        },
        {"mcp-session-id": session},
    )
    notified = HttpResponse(202, {}, b"")
    tool = http_json(
        tool_status,
        {"jsonrpc": "2.0", "id": 1, "result": result},
    )
    return [init, notified, tool]


def body_json(call):
    return json.loads(call.body.decode("utf-8"))
