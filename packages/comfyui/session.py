"""Open a Wan30 client from the process environment.

ComfyUI workflow JSON never carries a token. Authentication comes from an
existing `wan30` file session or from `WAN30_ACCESS_TOKEN` in the process
environment. This module does not read `.env` files and does not prompt.
"""


_MISSING = (
    "The wan30 package is not installed. It is not on PyPI yet. "
    "Install wan30>=0.1.0,<0.2 from the reviewed wheel, then restart ComfyUI."
)


def open_client(origin=""):
    try:
        from wan30 import WanClient
    except ImportError as exc:
        raise RuntimeError(_MISSING) from exc
    chosen = origin.strip() if isinstance(origin, str) else ""
    if chosen:
        return WanClient.from_environment(origin=chosen)
    return WanClient.from_environment()


def close_client(client):
    close = getattr(client, "close", None)
    if callable(close):
        close()


def call_client(origin, method, /, *args, **kwargs):
    client = open_client(origin)
    try:
        return getattr(client, method)(*args, **kwargs)
    finally:
        close_client(client)
