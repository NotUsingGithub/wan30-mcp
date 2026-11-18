"""Offline tests for the Wan30 ComfyUI nodes.

The client is injected. Nothing in the default path confirms a spend or
opens a network session.
"""

import importlib
import json
import os
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE.parent))

comfyui = importlib.import_module("comfyui")
nodes = importlib.import_module("comfyui.nodes")
session = importlib.import_module("comfyui.session")

SECRET_NAMES = {
    "token",
    "access_token",
    "api_key",
    "apikey",
    "password",
    "secret",
    "credential",
    "credentials",
}


class RecordingClient:
    def __init__(self):
        self.calls = []
        self.closed = False

    def account(self):
        self.calls.append(("account",))
        return {"authenticated": True}

    def models(self):
        self.calls.append(("models",))
        return [{"id": "wan30-text-to-video"}]

    def model(self, model_id):
        self.calls.append(("model", model_id))
        return {"id": model_id}

    def estimate(self, payload):
        self.calls.append(("estimate", payload))
        return {"credits": 2}

    def generate(self, payload, request_id=None, *, confirm_spend=False):
        self.calls.append(("generate", payload, request_id, confirm_spend))
        return {"taskId": "task-1"}

    def tasks(self, limit=None):
        self.calls.append(("tasks", limit))
        return []

    def task(self, task_id):
        self.calls.append(("task", task_id))
        return {"id": task_id}

    def close(self):
        self.closed = True


class RaisingClient(RecordingClient):
    def account(self):
        raise RuntimeError("offline")


class NodeTests(unittest.TestCase):
    def setUp(self):
        self.client = RecordingClient()
        self.original = session.open_client
        session.open_client = lambda origin="": self.client
        self.previous_confirm = os.environ.pop(nodes.CONFIRM_ENV, None)

    def tearDown(self):
        session.open_client = self.original
        if self.previous_confirm is None:
            os.environ.pop(nodes.CONFIRM_ENV, None)
        else:
            os.environ[nodes.CONFIRM_ENV] = self.previous_confirm

    def test_mappings_and_defaults_do_not_spend(self):
        self.assertEqual(
            tuple(comfyui.NODE_CLASS_MAPPINGS),
            (
                "Wan30AccountStatus",
                "Wan30ListModels",
                "Wan30GetModel",
                "Wan30Estimate",
                "Wan30ListTasks",
                "Wan30GetTask",
                "Wan30GenerateVideo",
            ),
        )
        self.assertEqual(set(comfyui.NODE_CLASS_MAPPINGS), set(comfyui.NODE_DISPLAY_NAME_MAPPINGS))
        for name, cls in comfyui.NODE_CLASS_MAPPINGS.items():
            self.assertEqual(cls.CATEGORY, "Wan30")
            self.assertTrue(cls.OUTPUT_NODE)
            self.assertIn("Wan30", comfyui.NODE_DISPLAY_NAME_MAPPINGS[name])
            spec = cls.INPUT_TYPES()
            names = set()
            for group in spec.values():
                names.update(group)
            self.assertTrue(names.isdisjoint(SECRET_NAMES), names)
        generate = comfyui.NODE_CLASS_MAPPINGS["Wan30GenerateVideo"].INPUT_TYPES()
        self.assertIs(generate["required"]["confirm_spend"][1]["default"], False)
        self.assertNotIn("confirm_spend", nodes.Wan30Estimate.INPUT_TYPES()["required"])

    def test_import_does_not_open_a_client(self):
        def fail(origin=""):
            raise AssertionError("import opened a client")

        session.open_client = fail
        importlib.reload(nodes)
        self.assertIn("Wan30AccountStatus", nodes.NODE_CLASS_MAPPINGS)
        session.open_client = lambda origin="": self.client

    def test_read_nodes_call_the_matching_tool(self):
        account = json.loads(nodes.Wan30AccountStatus().execute()["result"][0])
        self.assertEqual(account["authenticated"], True)
        models = json.loads(nodes.Wan30ListModels().execute(origin="  ")["result"][0])
        self.assertEqual(models[0]["id"], "wan30-text-to-video")
        model = json.loads(
            nodes.Wan30GetModel().execute("wan30-image-to-video")["result"][0]
        )
        self.assertEqual(model["id"], "wan30-image-to-video")
        estimate = nodes.Wan30Estimate().execute(
            model_id="wan30-text-to-video",
            prompt="A paper boat",
        )
        self.assertIn("credits", json.loads(estimate["result"][0]))
        self.assertEqual(
            self.client.calls[3],
            (
                "estimate",
                {"modelId": "wan30-text-to-video", "prompt": "A paper boat"},
            ),
        )
        nodes.Wan30ListTasks().execute()
        nodes.Wan30ListTasks().execute(limit=20)
        nodes.Wan30GetTask().execute("task-1")
        self.assertEqual(self.client.calls[4:], [("tasks", None), ("tasks", 20), ("task", "task-1")])
        self.assertNotIn("generate", [call[0] for call in self.client.calls])
        self.assertTrue(self.client.closed)

    def test_estimate_keeps_explicit_fields(self):
        nodes.Wan30Estimate().execute(
            model_id="wan30-reference-to-video",
            prompt="A paper boat",
            duration_seconds=5,
            resolution="480p",
            aspect_ratio="16:9",
            has_audio="false",
            image_urls="https://cdn.example/a.png,\nhttps://cdn.example/b.png",
        )
        payload = self.client.calls[-1][1]
        self.assertEqual(
            payload,
            {
                "modelId": "wan30-reference-to-video",
                "prompt": "A paper boat",
                "durationSeconds": 5,
                "resolution": "480p",
                "aspectRatio": "16:9",
                "hasAudio": False,
                "imageUrls": [
                    "https://cdn.example/a.png",
                    "https://cdn.example/b.png",
                ],
            },
        )

    def test_generate_stays_closed_without_both_confirmations(self):
        node = nodes.Wan30GenerateVideo()
        fields = dict(
            model_id="wan30-text-to-video",
            prompt="A paper boat",
        )
        with self.assertRaises(RuntimeError) as blocked:
            node.execute(confirm_spend=False, **fields)
        self.assertIn("purchased wan30.video credits", str(blocked.exception))
        self.assertEqual(self.client.calls, [])

        with self.assertRaises(RuntimeError):
            node.execute(confirm_spend=True, **fields)
        self.assertEqual(self.client.calls, [])

        os.environ[nodes.CONFIRM_ENV] = "yes"
        with self.assertRaises(RuntimeError):
            node.execute(confirm_spend=True, **fields)
        self.assertEqual(self.client.calls, [])

        os.environ[nodes.CONFIRM_ENV] = nodes.CONFIRM_VALUE
        with self.assertRaises(RuntimeError):
            node.execute(confirm_spend=False, **fields)
        self.assertEqual(self.client.calls, [])

    def test_generate_sends_the_client_gate_after_both_confirmations(self):
        os.environ[nodes.CONFIRM_ENV] = nodes.CONFIRM_VALUE
        result = nodes.Wan30GenerateVideo().execute(
            model_id="wan30-text-to-video",
            prompt="A paper boat",
            confirm_spend=True,
            request_id="  ",
        )
        self.assertEqual(json.loads(result["result"][0])["taskId"], "task-1")
        kind, payload, request_id, confirm = self.client.calls[-1]
        self.assertEqual(kind, "generate")
        self.assertEqual(payload, {"modelId": "wan30-text-to-video", "prompt": "A paper boat"})
        self.assertNotIn("confirm_spend", payload)
        self.assertIsNone(request_id)
        self.assertIs(confirm, True)
        self.assertTrue(self.client.closed)

    def test_client_error_still_closes(self):
        self.client = RaisingClient()
        session.open_client = lambda origin="": self.client
        with self.assertRaises(RuntimeError):
            nodes.Wan30AccountStatus().execute()
        self.assertTrue(self.client.closed)

    def test_missing_package_message(self):
        saved = sys.modules.get("wan30")
        sys.modules["wan30"] = None
        try:
            with self.assertRaises(RuntimeError) as missing:
                self.original()
        finally:
            if saved is None:
                sys.modules.pop("wan30", None)
            else:
                sys.modules["wan30"] = saved
        self.assertIn("not on PyPI yet", str(missing.exception))

    def test_open_client_uses_environment_without_a_widget_secret(self):
        calls = {}

        class Stub:
            @classmethod
            def from_environment(cls, origin=None):
                calls["origin"] = origin
                return "client"

        import wan30

        original = wan30.WanClient
        wan30.WanClient = Stub
        try:
            self.assertEqual(self.original(""), "client")
            self.assertIsNone(calls["origin"])
            self.assertEqual(self.original(" https://wan30.video "), "client")
            self.assertEqual(calls["origin"], "https://wan30.video")
        finally:
            wan30.WanClient = original

    def test_public_metadata(self):
        text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (
                PACKAGE / "README.md",
                PACKAGE / "pyproject.toml",
                PACKAGE / "requirements.txt",
                PACKAGE / "nodes.py",
            )
        )
        self.assertIn("purchased", text.lower())
        self.assertIn("check-in", text.lower())
        self.assertIn("not an official", (PACKAGE / "README.md").read_text(encoding="utf-8").lower())
        self.assertIn("not on PyPI yet", text)
        self.assertIn('PublisherId = "notusinggithub"', (PACKAGE / "pyproject.toml").read_text())
        self.assertNotRegex(text, r"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}")
        ignore = (PACKAGE / ".comfyignore").read_text(encoding="utf-8")
        self.assertIn("tests/", ignore)


if __name__ == "__main__":
    unittest.main()
