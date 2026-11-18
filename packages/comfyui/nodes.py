"""ComfyUI nodes for the seven hosted Wan30 tools.

Read-only nodes call account, model, estimate, and task operations.
`Wan30GenerateVideo` is present but does not call the service unless the
workflow widget and the process environment both confirm the spend.
"""

import json
import os

from .payload import ASPECT_RATIOS, AUDIO, MODELS, RESOLUTIONS, generation_input
from .session import call_client

CATEGORY = "Wan30"
CREDIT_NOTE = (
    "Purchased wan30.video credits are required for generation. "
    "Sign-up, check-in and gift credits alone do not qualify."
)
CONFIRM_ENV = "WAN30_CONFIRM_SPEND"
CONFIRM_VALUE = "spend-purchased-credits"
GENERATION_BLOCKED = (
    "generate spends purchased wan30.video credits. "
    "Sign-up, check-in and gift credits alone do not qualify. "
    "Set confirm_spend on the node and export "
    f"{CONFIRM_ENV}={CONFIRM_VALUE} in the ComfyUI process. "
    "That environment value is not stored in the workflow."
)


def _json_result(payload):
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {"ui": {"text": [text]}, "result": (text,)}


def _origin(value):
    return value.strip() if isinstance(value, str) else ""


class Wan30AccountStatus:
    CATEGORY = CATEGORY
    DESCRIPTION = "Read account status for the signed-in wan30.video account. Does not spend credits. " + CREDIT_NOTE
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("account_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"origin": ("STRING", {"default": ""})}}

    def execute(self, origin=""):
        return _json_result(call_client(_origin(origin), "account"))


class Wan30ListModels:
    CATEGORY = CATEGORY
    DESCRIPTION = "List the hosted Wan30 video models. Does not spend credits."
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("models_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"origin": ("STRING", {"default": ""})}}

    def execute(self, origin=""):
        return _json_result(call_client(_origin(origin), "models"))


class Wan30GetModel:
    CATEGORY = CATEGORY
    DESCRIPTION = "Read one hosted Wan30 model. Does not spend credits."
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("model_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"model_id": (MODELS,)},
            "optional": {"origin": ("STRING", {"default": ""})},
        }

    def execute(self, model_id, origin=""):
        return _json_result(call_client(_origin(origin), "model", model_id))


class Wan30Estimate:
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Estimate a generation. Does not spend credits. "
        + CREDIT_NOTE
        + " Image fields must already be HTTPS URLs; this node does not upload local files."
    )
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("estimate_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return _generation_inputs(confirm=False)

    def execute(
        self,
        model_id,
        prompt,
        duration_seconds=0,
        resolution="omit",
        aspect_ratio="omit",
        has_audio="unset",
        image_urls="",
        origin="",
    ):
        payload = generation_input(
            model_id=model_id,
            prompt=prompt,
            duration_seconds=duration_seconds,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            has_audio=has_audio,
            image_urls_text=image_urls,
        )
        return _json_result(call_client(_origin(origin), "estimate", payload))


class Wan30ListTasks:
    CATEGORY = CATEGORY
    DESCRIPTION = "List recent tasks. Does not spend credits. Leave limit at 0 to omit it."
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("tasks_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "limit": ("INT", {"default": 0, "min": 0, "max": 50, "step": 1}),
                "origin": ("STRING", {"default": ""}),
            }
        }

    def execute(self, limit=0, origin=""):
        chosen = None if not limit else int(limit)
        return _json_result(call_client(_origin(origin), "tasks", chosen))


class Wan30GetTask:
    CATEGORY = CATEGORY
    DESCRIPTION = "Read one task. Does not spend credits."
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("task_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"task_id": ("STRING", {"default": ""})},
            "optional": {"origin": ("STRING", {"default": ""})},
        }

    def execute(self, task_id, origin=""):
        return _json_result(call_client(_origin(origin), "task", task_id))


class Wan30GenerateVideo:
    CATEGORY = CATEGORY
    DESCRIPTION = (
        "Create a video only after an explicit spend confirmation. "
        + GENERATION_BLOCKED
        + " Image fields must already be HTTPS URLs; this node does not upload local files."
    )
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("task_json",)
    FUNCTION = "execute"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return _generation_inputs(confirm=True)

    def execute(
        self,
        model_id,
        prompt,
        confirm_spend=False,
        duration_seconds=0,
        resolution="omit",
        aspect_ratio="omit",
        has_audio="unset",
        image_urls="",
        request_id="",
        origin="",
    ):
        if confirm_spend is not True or os.environ.get(CONFIRM_ENV) != CONFIRM_VALUE:
            raise RuntimeError(GENERATION_BLOCKED)
        payload = generation_input(
            model_id=model_id,
            prompt=prompt,
            duration_seconds=duration_seconds,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            has_audio=has_audio,
            image_urls_text=image_urls,
        )
        chosen_id = request_id.strip() if isinstance(request_id, str) and request_id.strip() else None
        data = call_client(
            _origin(origin),
            "generate",
            payload,
            chosen_id,
            confirm_spend=True,
        )
        return _json_result(data)


def _generation_inputs(*, confirm):
    optional = {
        "duration_seconds": ("INT", {"default": 0, "min": 0, "max": 30, "step": 1}),
        "resolution": (RESOLUTIONS,),
        "aspect_ratio": (ASPECT_RATIOS,),
        "has_audio": (AUDIO,),
        "image_urls": ("STRING", {"multiline": True, "default": ""}),
        "origin": ("STRING", {"default": ""}),
    }
    required = {
        "model_id": (MODELS,),
        "prompt": ("STRING", {"multiline": True, "default": ""}),
    }
    if confirm:
        required["confirm_spend"] = ("BOOLEAN", {"default": False})
        optional["request_id"] = ("STRING", {"default": ""})
    return {"required": required, "optional": optional}


NODE_CLASS_MAPPINGS = {
    "Wan30AccountStatus": Wan30AccountStatus,
    "Wan30ListModels": Wan30ListModels,
    "Wan30GetModel": Wan30GetModel,
    "Wan30Estimate": Wan30Estimate,
    "Wan30ListTasks": Wan30ListTasks,
    "Wan30GetTask": Wan30GetTask,
    "Wan30GenerateVideo": Wan30GenerateVideo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Wan30AccountStatus": "Wan30 Account Status",
    "Wan30ListModels": "Wan30 List Models",
    "Wan30GetModel": "Wan30 Get Model",
    "Wan30Estimate": "Wan30 Estimate",
    "Wan30ListTasks": "Wan30 List Tasks",
    "Wan30GetTask": "Wan30 Get Task",
    "Wan30GenerateVideo": "Wan30 Generate Video",
}
