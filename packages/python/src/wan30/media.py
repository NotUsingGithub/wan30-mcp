"""Wait and download behavior from `src/media.mjs`.

Output URLs are public. The access token is never sent with the download.
"""

import os
import time
import uuid
from urllib.parse import urljoin, urlsplit

from wan30.errors import WanClientError
from wan30.transport import TransportFailure
from wan30.validate import validate_task_id, validate_timeout_ms

MAX_BYTES = 512 * 1024 * 1024
MEDIA_TYPES = ("image/png", "image/jpeg", "image/webp", "video/mp4")
READY_STATUSES = ("SAVED_TO_R2", "COMPLETED")
TERMINAL_STATUSES = READY_STATUSES + ("FAILED",)
_DOWNLOAD_TIMEOUT = 600
_MAX_REDIRECTS = 10


def _media_type(header):
    if not isinstance(header, str):
        return ""
    return header.split(";", 1)[0].strip().lower()


def wait_for_task(
    client,
    task_id,
    *,
    timeout_ms=600_000,
    interval_ms=5000,
    now=None,
    sleep=None,
):
    task_id = validate_task_id(task_id)
    timeout_ms = validate_timeout_ms(timeout_ms)
    if type(interval_ms) is not int or interval_ms < 1:
        raise WanClientError("INVALID_INPUT", "Wait interval must be a positive integer.")
    now = now or (lambda: int(time.time() * 1000))
    sleep = sleep or (lambda ms: time.sleep(ms / 1000))
    until = now() + timeout_ms
    while True:
        task = client.task(task_id)
        status = task.get("status") if isinstance(task, dict) else None
        if status in TERMINAL_STATUSES:
            return task
        remaining = until - now()
        if remaining <= 0:
            break
        sleep(min(interval_ms, remaining))
        if now() >= until:
            break
    raise WanClientError(
        "WAIT_TIMEOUT",
        f"Stopped waiting; the task continues. Run wan30 wait {task_id} again later.",
    )


def _https(url):
    parts = urlsplit(url)
    return parts.scheme == "https" and bool(parts.hostname) and not parts.username


def download_task(
    client,
    task_id,
    destination,
    *,
    index=0,
    open_https,
):
    """Download one output. `open_https(url)` returns a response with status,
    headers, and `iter_chunks()`. The response is closed by this function.
    """
    task_id = validate_task_id(task_id)
    if type(index) is not int or index < 0:
        raise WanClientError("INVALID_INPUT", "Download index must be a non-negative integer.")
    task = client.task(task_id)
    status = task.get("status") if isinstance(task, dict) else None
    if status not in READY_STATUSES:
        shown = "undefined" if status is None else status
        raise WanClientError(
            "TASK_NOT_READY",
            f"Task is {shown}. Run wan30 wait {task_id} first.",
        )
    outputs = task.get("outputs") if isinstance(task, dict) else None
    source = outputs[index] if isinstance(outputs, list) and index < len(outputs) else None
    if not isinstance(source, str) or not source.startswith("https://"):
        raise WanClientError("DOWNLOAD_UNAVAILABLE", "Task has no output.")
    target = os.path.abspath(destination)
    temporary = os.path.join(
        os.path.dirname(target),
        f".wan30-download-{uuid.uuid4()}",
    )
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    try:
        fd = os.open(temporary, flags, 0o600)
    except FileExistsError:
        raise WanClientError("INVALID_INPUT", "Refusing to overwrite an existing file.") from None
    except OSError:
        raise WanClientError("DOWNLOAD_UNAVAILABLE", "Could not write the download.") from None
    try:
        content_type, total = _fetch_media(source, fd, open_https)
        os.fsync(fd)
        os.close(fd)
        fd = None
        try:
            os.link(temporary, target)
        except FileExistsError:
            raise WanClientError(
                "INVALID_INPUT", "Refusing to overwrite an existing file."
            ) from None
        return {
            "taskId": task_id,
            "path": target,
            "bytes": total,
            "contentType": content_type,
        }
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _fetch_media(source, fd, open_https):
    url = source
    redirects = 0
    while True:
        if not _https(url):
            raise WanClientError("DOWNLOAD_UNAVAILABLE", "Download URL left HTTPS.")
        try:
            response = open_https(url)
        except TransportFailure:
            raise WanClientError(
                "DOWNLOAD_UNAVAILABLE", "Download failed before a response."
            ) from None
        try:
            headers = {
                str(key).lower(): value
                for key, value in getattr(response, "headers", {}).items()
            }
            if response.status in (301, 302, 303, 307, 308):
                redirects += 1
                location = headers.get("location")
                if redirects > _MAX_REDIRECTS or not isinstance(location, str) or not location:
                    raise WanClientError(
                        "DOWNLOAD_UNAVAILABLE",
                        f"Download returned HTTP {response.status}.",
                        response.status,
                    )
                url = urljoin(url, location)
                continue
            if response.status < 200 or response.status >= 300:
                raise WanClientError(
                    "DOWNLOAD_UNAVAILABLE",
                    f"Download returned HTTP {response.status}.",
                    response.status,
                )
            content_type = _media_type(headers.get("content-type"))
            if content_type not in MEDIA_TYPES:
                raise WanClientError("INVALID_RESPONSE", "Unexpected media type.")
            total = 0
            for chunk in response.iter_chunks():
                if not isinstance(chunk, (bytes, bytearray)) or not chunk:
                    continue
                total += len(chunk)
                if total > MAX_BYTES:
                    raise WanClientError("INVALID_RESPONSE", "Media is too large.")
                os.write(fd, chunk)
            return content_type, total
        finally:
            close = getattr(response, "close", None)
            if close:
                close()
