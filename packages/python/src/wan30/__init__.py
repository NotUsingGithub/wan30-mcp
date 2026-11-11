"""Python client for a wan30.video account.

Purchased credits are required. Sign-up, check-in and gift credits alone do
not qualify. `generate` does not call the service unless `confirm_spend=True`.
"""

from wan30._version import __version__
from wan30.auth import (
    CLIENT_ID,
    CredentialManager,
    FileVault,
    credential_name,
    token_identity,
)
from wan30.client import SPEND_NOT_CONFIRMED_MESSAGE, WanClient
from wan30.errors import WanClientError
from wan30.origin import DEFAULT_ORIGIN, normalize_origin
from wan30.protocol import LATEST_PROTOCOL_VERSION
from wan30.validate import MODEL_IDS

__all__ = [
    "CLIENT_ID",
    "DEFAULT_ORIGIN",
    "LATEST_PROTOCOL_VERSION",
    "MODEL_IDS",
    "SPEND_NOT_CONFIRMED_MESSAGE",
    "CredentialManager",
    "FileVault",
    "WanClient",
    "WanClientError",
    "credential_name",
    "normalize_origin",
    "token_identity",
    "__version__",
]
