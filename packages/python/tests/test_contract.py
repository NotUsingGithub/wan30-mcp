"""The Python client stays on the tool contract shipped in this repository."""

import json
import tomllib
import unittest
from pathlib import Path

from wan30 import __version__
from wan30.validate import MODEL_IDS, REQUEST_ID_RE, TOOL_NAMES

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = Path(__file__).resolve().parents[1]


def _walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


class ContractTests(unittest.TestCase):
    def test_tools_json_matches_the_client(self):
        tools = json.loads((ROOT / "src" / "tools.json").read_text(encoding="utf-8"))
        self.assertEqual(tuple(tool["name"] for tool in tools), TOOL_NAMES)
        model_tool = next(tool for tool in tools if tool["name"] == "get_model")
        self.assertEqual(tuple(model_tool["inputSchema"]["properties"]["modelId"]["enum"]), MODEL_IDS)
        generate = next(tool for tool in tools if tool["name"] == "generate_video")
        self.assertEqual(
            generate["inputSchema"]["properties"]["requestId"]["pattern"],
            REQUEST_ID_RE.pattern,
        )
        self.assertEqual(generate["inputSchema"]["required"], ["input", "requestId"])
        limits = [
            node
            for node in _walk(generate)
            if node.get("minimum") == 2 and node.get("maximum") == 30
        ]
        self.assertTrue(limits)
        resolutions = [
            node for node in _walk(generate) if node.get("enum") == ["480p", "720p", "1080p"]
        ]
        self.assertTrue(resolutions)

    def test_public_metadata_has_no_personal_contact(self):
        pyproject = (PACKAGE / "pyproject.toml").read_text(encoding="utf-8")
        parsed = tomllib.loads(pyproject)
        self.assertEqual(parsed["project"]["version"], __version__)
        self.assertEqual(parsed["project"]["name"], "wan30")
        self.assertEqual(
            [author["name"] for author in parsed["project"]["authors"]],
            ["Wan30", "NotUsingGithub"],
        )
        self.assertNotIn("@", pyproject)
        readme = (PACKAGE / "README.md").read_text(encoding="utf-8")
        self.assertIn("purchased", readme.lower())
        self.assertIn("check-in", readme.lower())
        self.assertIn("not an official", readme.lower())
        for path in PACKAGE.rglob("*"):
            if path.suffix not in {".py", ".md", ".toml"} or "tests" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")


if __name__ == "__main__":
    unittest.main()
