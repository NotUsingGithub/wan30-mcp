"""HTTPS requests that do not follow redirects.

The CLI sets `redirect: 'error'` on every authorized request so a bearer
token cannot be sent to another origin. This module does the same.
"""

import http.client
from urllib.parse import urlsplit

from wan30.errors import WanClientError


class TransportFailure(Exception):
    """The socket failed before an HTTP status was available."""


def header_map(headers):
    if not headers:
        return {}
    pairs = headers.items() if isinstance(headers, dict) else headers
    return {str(key).lower(): value for key, value in pairs}


class HttpResponse:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = header_map(headers)
        self.body = body


def _origin_of(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise WanClientError("INVALID_ORIGIN", "Unexpected authorization destination.")
    return parts


def https_request(url, *, method, headers, body=None, timeout, max_bytes):
    """One HTTPS request. 3xx responses are returned, never followed."""
    parts = _origin_of(url)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    connection = http.client.HTTPSConnection(
        parts.hostname,
        parts.port or 443,
        timeout=timeout,
    )
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        chunks = []
        size = 0
        while True:
            chunk = response.read(65_536)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise WanClientError(
                    "INVALID_RESPONSE",
                    "The server response exceeded the size limit.",
                )
            chunks.append(chunk)
        return HttpResponse(response.status, response.getheaders(), b"".join(chunks))
    except WanClientError:
        raise
    except Exception as error:
        raise TransportFailure("The server response was lost.") from error
    finally:
        connection.close()


class StreamResponse:
    def __init__(self, status, headers, iterator, close):
        self.status = status
        self.headers = header_map(headers)
        self._iterator = iterator
        self._close = close
        self._closed = False

    def iter_chunks(self):
        return self._iterator

    def close(self):
        if not self._closed:
            self._closed = True
            self._close()


def stream_https(url, *, method="GET", headers=None, body=None, timeout=600):
    """One HTTPS response, streamed. Redirects are not followed."""
    parts = _origin_of(url)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    connection = http.client.HTTPSConnection(
        parts.hostname,
        parts.port or 443,
        timeout=timeout,
    )
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
    except Exception as error:
        connection.close()
        raise TransportFailure("The server response was lost.") from error

    def chunks():
        while True:
            chunk = response.read(65_536)
            if not chunk:
                break
            yield chunk

    return StreamResponse(response.status, response.getheaders(), chunks(), connection.close)


def open_public_https(url):
    """GET a public media URL. No Authorization header is set."""
    return stream_https(url, method="GET", headers={"Accept": "*/*"}, timeout=600)
