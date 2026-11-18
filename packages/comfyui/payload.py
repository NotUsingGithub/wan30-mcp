"""Build a generation object for the hosted Wan30 tools.

Omitted optional fields stay omitted. The server applies its own defaults.
"""

import re

MODELS = (
    "wan30-reference-to-video",
    "wan30-text-to-video",
    "wan30-image-to-video",
)
RESOLUTIONS = ("omit", "480p", "720p", "1080p")
ASPECT_RATIOS = ("omit", "16:9", "9:16", "1:1", "4:3", "3:4")
AUDIO = ("unset", "true", "false")

_URL_SPLIT = re.compile(r"[\s,]+")


def image_urls(value):
    if not isinstance(value, str) or not value.strip():
        return []
    return [part for part in _URL_SPLIT.split(value.strip()) if part]


def generation_input(
    *,
    model_id,
    prompt,
    duration_seconds=0,
    resolution="omit",
    aspect_ratio="omit",
    has_audio="unset",
    image_urls_text="",
):
    body = {"modelId": model_id, "prompt": prompt}
    if duration_seconds:
        body["durationSeconds"] = int(duration_seconds)
    if resolution and resolution != "omit":
        body["resolution"] = resolution
    if aspect_ratio and aspect_ratio != "omit":
        body["aspectRatio"] = aspect_ratio
    if has_audio == "true":
        body["hasAudio"] = True
    elif has_audio == "false":
        body["hasAudio"] = False
    urls = image_urls(image_urls_text)
    if urls:
        body["imageUrls"] = urls
    return body
