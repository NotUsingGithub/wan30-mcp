"""Local checks for the generation object published in src/tools.json.

The hosted server remains the authority. These checks stop a request that
cannot match the published schema from being sent. Omitted optional fields
are not filled in; the server applies its own defaults.
"""

import re
from urllib.parse import urlsplit

from wan30.codec import utf16_len
from wan30.errors import WanClientError

MODEL_IDS = (
    "wan30-reference-to-video",
    "wan30-text-to-video",
    "wan30-image-to-video",
)
TOOL_NAMES = (
    "account_status",
    "list_models",
    "get_model",
    "estimate_generation",
    "generate_video",
    "list_tasks",
    "get_task",
)
RESOLUTIONS = ("480p", "720p", "1080p")
ASPECT_RATIOS = ("16:9", "9:16", "1:1", "4:3", "3:4")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
REFERENCE_KEYS = {
    "prompt",
    "durationSeconds",
    "resolution",
    "aspectRatio",
    "hasAudio",
    "modelId",
    "imageUrls",
}
TEXT_KEYS = REFERENCE_KEYS - {"imageUrls"}

_INVALID = "INVALID_INPUT"


def _fail(message):
    raise WanClientError(_INVALID, message)


def _integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        _fail(f"{label} must be an integer from {low} to {high}.")


def _common(value, allowed):
    extra = set(value) - allowed
    if extra:
        _fail("Unexpected generation field: " + ", ".join(sorted(extra)) + ".")
    prompt = value.get("prompt")
    if not isinstance(prompt, str) or not 1 <= utf16_len(prompt) <= 1500:
        _fail("prompt must be 1 to 1500 characters.")
    if "durationSeconds" in value:
        _integer(value["durationSeconds"], "durationSeconds", 2, 30)
    if "resolution" in value and value["resolution"] not in RESOLUTIONS:
        _fail("resolution must be 480p, 720p or 1080p.")
    if "aspectRatio" in value and value["aspectRatio"] not in ASPECT_RATIOS:
        _fail("aspectRatio must be 16:9, 9:16, 1:1, 4:3 or 3:4.")
    if "hasAudio" in value and type(value["hasAudio"]) is not bool:
        _fail("hasAudio must be a boolean.")


def _https_urls(urls, low, high):
    if not isinstance(urls, list) or not low <= len(urls) <= high:
        _fail(f"imageUrls must contain {low} to {high} HTTPS URLs.")
    for url in urls:
        if not isinstance(url, str):
            _fail("imageUrls entries must be HTTPS URLs.")
        parts = urlsplit(url)
        if (
            parts.scheme != "https"
            or not parts.hostname
            or parts.username
            or parts.password
            or any(char in url for char in " \t\r\n")
        ):
            _fail("imageUrls entries must be HTTPS URLs.")


def validate_generation_input(value):
    if not isinstance(value, dict):
        _fail("Generation input must be an object.")
    model_id = value.get("modelId", "wan30-reference-to-video")
    if model_id not in MODEL_IDS:
        _fail("modelId must be a supported Wan30 video model.")
    if "modelId" in value and value["modelId"] != model_id:
        _fail("modelId must be a supported Wan30 video model.")
    if model_id == "wan30-text-to-video":
        if "modelId" not in value:
            _fail("modelId is required.")
        _common(value, TEXT_KEYS)
    elif model_id == "wan30-image-to-video":
        if "modelId" not in value:
            _fail("modelId is required.")
        _common(value, REFERENCE_KEYS)
        _https_urls(value.get("imageUrls"), 1, 1)
    else:
        _common(value, REFERENCE_KEYS)
        _https_urls(value.get("imageUrls"), 1, 10)
    return value


def validate_request_id(request_id):
    if not isinstance(request_id, str) or REQUEST_ID_RE.fullmatch(request_id) is None:
        _fail("requestId must match ^[A-Za-z0-9_-]{16,128}$.")
    return request_id


def validate_model_id(model_id):
    if model_id not in MODEL_IDS:
        _fail("modelId must be a supported Wan30 video model.")
    return model_id


def validate_task_id(task_id):
    if not isinstance(task_id, str) or not 1 <= utf16_len(task_id) <= 128:
        _fail("taskId must be 1 to 128 characters.")
    return task_id


def validate_limit(limit):
    if limit is None:
        return None
    _integer(limit, "limit", 1, 50)
    return limit


def validate_timeout_ms(timeout_ms):
    if type(timeout_ms) is not int or not 1 <= timeout_ms <= 86_400_000:
        _fail("Wait timeout must be 1 ms to 24 hours.")
    return timeout_ms
