"""Wan30 custom nodes for ComfyUI.

Generation is off unless the node widget and `WAN30_CONFIRM_SPEND` both
confirm it. Purchased wan30.video credits are required. Sign-up, check-in
and gift credits alone do not qualify.
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
