"""High-level client for the seven hosted Wan30 tools.

Generation is refused unless `confirm_spend=True`. That check happens before
any request, including a retry that reuses `request_id`.
"""

import json
import uuid

from wan30._version import __version__
from wan30.auth import CredentialManager, FileVault
from wan30.codec import AUTH_RESPONSE_LIMIT
from wan30.errors import WanClientError
from wan30.media import download_task, wait_for_task
from wan30.origin import normalize_origin
from wan30.protocol import McpSession
from wan30.transport import https_request, open_public_https
from wan30.validate import (
    validate_generation_input,
    validate_limit,
    validate_model_id,
    validate_request_id,
    validate_task_id,
)

SPEND_NOT_CONFIRMED_MESSAGE = (
    "generate spends purchased wan30.video credits. "
    "Sign-up, check-in and gift credits alone do not qualify. "
    "Pass confirm_spend=True after estimate()."
)


def _tool_failure(result):
    content = result.get("content")
    text = ""
    if isinstance(content, list) and content and isinstance(content[0], dict):
        raw = content[0].get("text")
        if isinstance(raw, str):
            text = raw
    error = None
    if text:
        try:
            error = json.loads(text)
        except json.JSONDecodeError:
            error = None
    if isinstance(error, dict):
        code = error.get("code")
        if not isinstance(code, str) or not code:
            code = "TOOL_ERROR"
        message = error.get("message")
        if not isinstance(message, str) or not message:
            message = text or "Tool call failed."
    else:
        code = "TOOL_ERROR"
        message = text or "Tool call failed."
    raise WanClientError(code, message)


class WanClient:
    def __init__(self, *, origin="https://wan30.video", get_token, request=None):
        if not callable(get_token):
            raise WanClientError("INVALID_INPUT", "get_token must be callable.")
        self.origin = normalize_origin(origin)
        self._get_token = get_token
        self._request = request or https_request
        self._mcp = McpSession(self.origin, self._bearer, self._request, __version__)

    def _bearer(self):
        token = self._get_token()
        if not isinstance(token, str) or not token:
            raise WanClientError(
                "INVALID_TOKEN",
                "Access token is not a Wan30 API authorization. Sign in again.",
            )
        return token

    @classmethod
    def from_token(cls, token, *, origin="https://wan30.video", request=None):
        origin = normalize_origin(origin)

        def get_token():
            from wan30.auth import token_identity

            token_identity(token, origin)
            return token

        return cls(origin=origin, get_token=get_token, request=request)

    @classmethod
    def from_credentials(cls, credentials, *, request=None):
        return cls(origin=credentials.origin, get_token=credentials.token, request=request)

    @classmethod
    def from_environment(cls, *, origin=None, config_dir=None, request=None):
        files = FileVault(config_dir) if config_dir else None
        credentials = CredentialManager(origin=origin, files=files, request=request)
        return cls.from_credentials(credentials, request=request)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False

    def close(self):
        self._mcp.close()

    def _data(self, name, arguments, *, timeout=None):
        kwargs = {}
        if timeout is not None:
            kwargs["timeout"] = timeout
        result = self._mcp.call_tool(name, arguments, **kwargs)
        if isinstance(result, dict) and result.get("isError"):
            _tool_failure(result)
        structured = result.get("structuredContent") if isinstance(result, dict) else None
        if not isinstance(structured, dict) or "data" not in structured:
            raise WanClientError(
                "INVALID_RESPONSE", "The server returned an unreadable response."
            )
        return structured["data"]

    def account(self):
        return self._data("account_status", {})

    def auth_status(self):
        self.account()
        return {"authenticated": True, "origin": self.origin}

    def models(self):
        return self._data("list_models", {})

    def model(self, model_id):
        validate_model_id(model_id)
        return self._data("get_model", {"modelId": model_id})

    def estimate(self, generation_input):
        validate_generation_input(generation_input)
        return self._data("estimate_generation", {"input": generation_input})

    def generate(self, generation_input, request_id=None, *, confirm_spend=False):
        validate_generation_input(generation_input)
        if request_id is not None:
            validate_request_id(request_id)
        if confirm_spend is not True:
            raise WanClientError("SPEND_NOT_CONFIRMED", SPEND_NOT_CONFIRMED_MESSAGE)
        if request_id is None:
            request_id = str(uuid.uuid4())
        return self._data(
            "generate_video",
            {"input": generation_input, "requestId": request_id},
        )

    def tasks(self, limit=None):
        validate_limit(limit)
        arguments = {} if limit is None else {"limit": limit}
        return self._data("list_tasks", arguments)

    def task(self, task_id):
        validate_task_id(task_id)
        return self._data("get_task", {"taskId": task_id})

    def wait(self, task_id, **options):
        return wait_for_task(self, task_id, **options)

    def download(self, task_id, destination, *, index=0, open_https=None):
        return download_task(
            self,
            task_id,
            destination,
            index=index,
            open_https=open_https or open_public_https,
        )

    def disconnect(self):
        response = self._mcp.authorized_post(
            self.origin + "/api/mcp/disconnect/",
            timeout=60,
            max_bytes=AUTH_RESPONSE_LIMIT,
        )
        if response.status < 200 or response.status >= 300:
            raise WanClientError(
                "REVOCATION_UNCONFIRMED",
                "Could not disconnect.",
                response.status,
            )
