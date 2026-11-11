"""Exact HTTPS origin checks used by the CLI."""

from urllib.parse import urlsplit

from wan30.errors import WanClientError

DEFAULT_ORIGIN = "https://wan30.video"
_MESSAGE = "Use an exact HTTPS service origin."


def normalize_origin(value=DEFAULT_ORIGIN):
    """Accept only the canonical origin string.

    `new URL(value).origin === value` in the CLI, so a path, query, userinfo,
    trailing slash, or an explicit default port is rejected.
    """
    if not isinstance(value, str) or not value:
        raise WanClientError("INVALID_ORIGIN", _MESSAGE)
    parts = urlsplit(value)
    try:
        port = parts.port
    except ValueError:
        raise WanClientError("INVALID_ORIGIN", _MESSAGE) from None
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.path
        or parts.query
        or parts.fragment
    ):
        raise WanClientError("INVALID_ORIGIN", _MESSAGE)
    # URL.origin omits the default HTTPS port, so an explicit :443 never matches.
    if port is None or port == 443:
        origin = f"https://{parts.hostname}"
    else:
        origin = f"https://{parts.hostname}:{port}"
    if origin != value:
        raise WanClientError("INVALID_ORIGIN", _MESSAGE)
    return origin


def assert_destination(url, origin):
    parts = urlsplit(url)
    if f"{parts.scheme}://{parts.netloc}" != origin:
        raise WanClientError(
            "INVALID_ORIGIN", "Unexpected authorization destination."
        )
    return url
