import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [
    str(ROOT / "packages/python/src"),
    str(ROOT / "packages/python/tests"),
    str(ROOT / "packages/langchain-python/src"),
]

from support import Script, access_token, handshake, http_json, tool_result

from langchain_wan30 import get_tools
from wan30 import WanClient, WanClientError
from wan30.validate import TOOL_NAMES

LAKE = {
    "modelId": "wan30-text-to-video",
    "prompt": "A paper boat on a rainy street",
    "durationSeconds": 5,
    "resolution": "480p",
}


def hosted(data):
    script = Script(handshake(tool_result(data)))
    client = WanClient.from_token(access_token(), request=script)
    return client, script


class ToolTests(unittest.TestCase):
    def test_default_tools_cannot_spend(self):
        client, script = hosted({"credits": 3})
        tools = get_tools(client)
        names = tuple(tool.name for tool in tools)
        self.assertEqual(names, tuple(name for name in TOOL_NAMES if name != "generate_video"))
        self.assertNotIn("generate_video", names)
        for tool in tools:
            self.assertIn("Purchased wan30.video credits", tool.description)
            self.assertIn("check-in", tool.description)
        account = next(tool for tool in tools if tool.name == "account_status")
        self.assertEqual(json.loads(account.invoke({})), {"credits": 3})
        self.assertEqual(script.calls[-1].url, "https://wan30.video/api/mcp/")

    def test_estimate_uses_the_same_client_payload(self):
        client, script = hosted({"credits": 10})
        tool = next(tool for tool in get_tools(client) if tool.name == "estimate_generation")
        self.assertIn("Does not spend credits.", tool.description)
        self.assertEqual(json.loads(tool.invoke({"input": LAKE})), {"credits": 10})
        body = json.loads(script.calls[-1].body.decode())
        self.assertEqual(body["params"]["name"], "estimate_generation")
        self.assertEqual(body["params"]["arguments"], {"input": LAKE})

    def test_generate_is_opt_in_and_still_requires_confirm_spend(self):
        client, script = hosted({"taskId": "task-1"})
        hidden = get_tools(client)
        self.assertFalse(any(tool.name == "generate_video" for tool in hidden))
        tool = next(
            tool
            for tool in get_tools(client, include_generate=True)
            if tool.name == "generate_video"
        )
        self.assertIn("confirm_spend", tool.description)
        with self.assertRaises(WanClientError) as caught:
            tool.invoke(
                {"input": LAKE, "requestId": "paper-boat-shot-01", "confirm_spend": False}
            )
        self.assertEqual(caught.exception.code, "SPEND_NOT_CONFIRMED")
        self.assertEqual(script.calls, [])
        self.assertEqual(
            json.loads(
                tool.invoke(
                    {
                        "input": LAKE,
                        "requestId": "paper-boat-shot-01",
                        "confirm_spend": True,
                    }
                )
            ),
            {"taskId": "task-1"},
        )
        body = json.loads(script.calls[-1].body.decode())
        self.assertEqual(
            body["params"],
            {
                "name": "generate_video",
                "arguments": {"input": LAKE, "requestId": "paper-boat-shot-01"},
            },
        )
        self.assertNotIn("confirm_spend", json.dumps(body))

    def test_model_and_task_argument_names_match_the_hosted_tools(self):
        client, script = hosted({"modelId": "wan30-text-to-video"})
        tools = {tool.name: tool for tool in get_tools(client)}
        tools["get_model"].invoke({"modelId": "wan30-text-to-video"})
        self.assertEqual(
            json.loads(script.calls[-1].body.decode())["params"]["arguments"],
            {"modelId": "wan30-text-to-video"},
        )
        script.responses.append(
            http_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": tool_result({"tasks": []}),
                },
            )
        )
        tools["list_tasks"].invoke({})
        arguments = json.loads(script.calls[-1].body.decode())["params"]["arguments"]
        self.assertEqual(arguments, {"limit": 20})
        client.close()
        script.responses.extend(handshake(tool_result({"status": "RUNNING"})))
        tools = {tool.name: tool for tool in get_tools(client)}
        tools["get_task"].invoke({"taskId": "task-1"})
        self.assertEqual(
            json.loads(script.calls[-1].body.decode())["params"]["arguments"],
            {"taskId": "task-1"},
        )


if __name__ == "__main__":
    unittest.main()
