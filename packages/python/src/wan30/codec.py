"""JSON and token helpers that follow the CLI's JavaScript contracts."""

import base64
import json

from wan30.errors import WanClientError

RESPONSE_LIMIT = 2_097_152
AUTH_RESPONSE_LIMIT = 65_536


def utf16_len(value):
    """JavaScript string length, which is what Zod and Ajv use for maxLength."""
    return len(value.encode("utf-16-le")) // 2


def dump_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_json_bytes(payload, *, empty_message="The server returned an empty response."):
    if not payload:
        raise WanClientError("INVALID_RESPONSE", empty_message)
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise WanClientError(
            "INVALID_RESPONSE", "The server returned an unreadable response."
        ) from None


def b64url_decode(segment):
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def b64url_encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def media_type(header):
    if not header or not isinstance(header, str):
        return ""
    return header.split(";", 1)[0].strip().lower()
