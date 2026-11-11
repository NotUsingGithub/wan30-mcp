"""Tool adapter over `wan30.WanClient`.

Descriptions start with the hosted tool text from `@wan30/cli` 0.1.0.
`confirm_spend` is not sent to the service. It only unlocks `WanClient.generate`.
"""

import json

from langchain_core.tools import StructuredTool

from wan30.validate import TOOL_NAMES

_CREDIT = (
    "Purchased wan30.video credits are required. "
    "Sign-up, check-in and gift credits alone do not qualify."
)

_HOSTED = {
    "account_status": "Available website credits and access to generation.",
    "list_models": "Supported generation models.",
    "get_model": "Input options for the selected video model.",
    "estimate_generation": "Quote credits before generation.",
    "generate_video": (
        "Spend website credits on a text, first-frame or reference video. "
        "Confirm the estimate and reuse requestId on retries."
    ),
    "list_tasks": "Recent supported video tasks for this account.",
    "get_task": "Poll your video task for its status and download URL.",
}


def _dump(value):
    return json.dumps(value, ensure_ascii=False)


def _describe(name, extra=""):
    text = _HOSTED[name] + " " + _CREDIT
    if extra:
        text += " " + extra
    return text


def get_tools(client, *, include_generate=False):
    """Return LangChain tools bound to `client`.

    The default set is read-only plus `estimate_generation`. Pass
    `include_generate=True` to add `generate_video`. That tool still refuses
    to call the service until its `confirm_spend` argument is true.
    """
    if include_generate not in (True, False):
        raise ValueError("include_generate must be a boolean.")

    def account_status() -> str:
        """Available website credits and access to generation."""
        return _dump(client.account())

    def list_models() -> str:
        """Supported generation models."""
        return _dump(client.models())

    def get_model(modelId: str) -> str:
        """Input options for the selected video model."""
        return _dump(client.model(modelId))

    def estimate_generation(input: dict) -> str:
        """Quote credits before generation."""
        return _dump(client.estimate(input))

    def list_tasks(limit: int = 20) -> str:
        """Recent supported video tasks for this account."""
        return _dump(client.tasks(limit))

    def get_task(taskId: str) -> str:
        """Poll your video task for its status and download URL."""
        return _dump(client.task(taskId))

    def generate_video(input: dict, requestId: str, confirm_spend: bool = False) -> str:
        """Spend website credits on a video. Requires confirm_spend."""
        return _dump(
            client.generate(input, request_id=requestId, confirm_spend=confirm_spend)
        )

    specs = {
        "account_status": (account_status, ""),
        "list_models": (list_models, ""),
        "get_model": (get_model, ""),
        "estimate_generation": (estimate_generation, "Does not spend credits."),
        "generate_video": (
            generate_video,
            "Set confirm_spend to true only after the user approves an estimate. "
            "Reuse requestId when retrying so the service does not charge twice.",
        ),
        "list_tasks": (list_tasks, ""),
        "get_task": (get_task, ""),
    }
    selected = TOOL_NAMES if include_generate else tuple(
        name for name in TOOL_NAMES if name != "generate_video"
    )
    tools = [
        StructuredTool.from_function(
            specs[name][0],
            name=name,
            description=_describe(name, specs[name][1]),
        )
        for name in selected
    ]
    names = tuple(tool.name for tool in tools)
    if names != selected:
        raise RuntimeError("Wan30 tool list drifted from the hosted contract.")
    return tools
