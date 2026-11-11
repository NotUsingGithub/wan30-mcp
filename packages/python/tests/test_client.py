import json
import unittest

from support import Script, access_token, body_json, handshake, http_json, tool_result

from wan30 import WanClient, WanClientError, normalize_origin
from wan30.transport import HttpResponse, TransportFailure


ORIGIN = "https://wan30.video"
LAKE = {
    "modelId": "wan30-text-to-video",
    "prompt": "A slow camera pan across a forest lake.",
    "durationSeconds": 5,
    "resolution": "480p",
}


def client(responses, token=None):
    script = Script(responses)
    built = WanClient.from_token(token or access_token(), request=script)
    return built, script


class OriginTests(unittest.TestCase):
    def test_default_and_exact_https_origin(self):
        self.assertEqual(normalize_origin(), ORIGIN)
        self.assertEqual(normalize_origin(ORIGIN), ORIGIN)
        self.assertEqual(normalize_origin("https://example.com:8443"), "https://example.com:8443")

    def test_rejects_non_canonical_origins(self):
        for value in (
            "http://wan30.video",
            "https://wan30.video/",
            "https://wan30.video/api",
            "https://wan30.video?x=1",
            "https://user:pass@wan30.video",
            "https://wan30.video:443",
            "HTTPS://wan30.video",
            "https://Wan30.video",
            "",
            None,
        ):
            with self.subTest(value=value):
                with self.assertRaises(WanClientError) as caught:
                    normalize_origin(value)
                self.assertEqual(caught.exception.code, "INVALID_ORIGIN")


class ProtocolTests(unittest.TestCase):
    def test_account_uses_cli_mcp_messages(self):
        built, script = client(handshake(tool_result({"credits": 4, "access": "purchased"})))
        self.assertEqual(built.account(), {"credits": 4, "access": "purchased"})
        self.assertEqual(
            [call.url for call in script.calls],
            [ORIGIN + "/api/mcp/"] * 3,
        )
        initialize, notified, tool = [body_json(call) for call in script.calls]
        self.assertEqual(
            initialize,
            {
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "wan30-python", "version": "0.1.0"},
                },
                "jsonrpc": "2.0",
                "id": 0,
            },
        )
        self.assertEqual(notified, {"method": "notifications/initialized", "jsonrpc": "2.0"})
        self.assertEqual(
            tool,
            {
                "method": "tools/call",
                "params": {"name": "account_status", "arguments": {}},
                "jsonrpc": "2.0",
                "id": 1,
            },
        )
        self.assertEqual(script.calls[0].timeout, 60)
        self.assertEqual(script.calls[2].timeout, 300)
        self.assertNotIn("mcp-session-id", script.calls[0].headers)
        self.assertNotIn("mcp-protocol-version", script.calls[0].headers)
        self.assertEqual(script.calls[1].headers["mcp-session-id"], "sess-1")
        self.assertEqual(script.calls[1].headers["mcp-protocol-version"], "2025-11-25")
        self.assertTrue(script.calls[0].headers["Authorization"].startswith("Bearer "))
        self.assertEqual(script.calls[0].headers["Accept"], "application/json, text/event-stream")
        self.assertEqual(script.calls[2].method, "POST")

    def test_negotiated_protocol_version_is_sent_next(self):
        built, script = client(
            handshake(tool_result({"models": []}), version="2025-03-26")
        )
        built.models()
        self.assertEqual(script.calls[2].headers["mcp-protocol-version"], "2025-03-26")

    def test_second_call_reuses_the_session(self):
        responses = handshake(tool_result({"credits": 1}))
        responses.append(http_json(200, {"jsonrpc": "2.0", "id": 2, "result": tool_result([])}))
        built, script = client(responses)
        built.account()
        built.models()
        self.assertEqual(len(script.calls), 4)
        self.assertEqual(body_json(script.calls[3])["id"], 2)
        self.assertEqual(body_json(script.calls[3])["params"]["name"], "list_models")

    def test_sse_and_json_charset_responses(self):
        sse = (
            "id: prime\n\n"
            "event: message\n"
            'data: {"jsonrpc":"2.0","id":1,"result":'
            '{"content":[],"structuredContent":{"data":{"credits":10}}}}\n\n'
        ).encode()
        responses = handshake(tool_result({"unused": True}))
        responses[2] = HttpResponse(200, {"content-type": "text/event-stream"}, sse)
        built, _script = client(responses)
        self.assertEqual(built.account(), {"credits": 10})

        responses = handshake(tool_result({"credits": 2}))
        payload = responses[2].body
        responses[2] = HttpResponse(
            200, {"content-type": "application/json; charset=utf-8"}, payload
        )
        built, _script = client(responses)
        self.assertEqual(built.account(), {"credits": 2})

    def test_json_array_response(self):
        responses = handshake(tool_result({"credits": 7}))
        message = json.loads(responses[2].body.decode())
        responses[2] = http_json(200, [message])
        built, _script = client(responses)
        self.assertEqual(built.account(), {"credits": 7})

    def test_tool_error_paths(self):
        cases = (
            (
                {
                    "isError": True,
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {"code": "INVALID_INPUT", "message": "prompt is required"}
                            ),
                        }
                    ],
                },
                "INVALID_INPUT",
                "prompt is required",
            ),
            (
                {"isError": True, "content": [{"type": "text", "text": "nope"}]},
                "TOOL_ERROR",
                "nope",
            ),
            ({"isError": True, "content": []}, "TOOL_ERROR", "Tool call failed."),
        )
        for result, code, message in cases:
            with self.subTest(code=code):
                built, _script = client(handshake(result))
                with self.assertRaises(WanClientError) as caught:
                    built.account()
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(str(caught.exception), message)

    def test_jsonrpc_invalid_params(self):
        responses = handshake(tool_result({}))
        responses[2] = http_json(
            200,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "error": {"code": -32602, "message": "Invalid arguments: prompt is required"},
            },
        )
        built, _script = client(responses)
        with self.assertRaises(WanClientError) as caught:
            built.estimate(LAKE)
        self.assertEqual(caught.exception.code, "PROTOCOL_ERROR")
        self.assertEqual(caught.exception.rpc_code, -32602)
        self.assertIn("Invalid arguments: prompt is required", str(caught.exception))

    def test_http_401_resets_the_session(self):
        responses = handshake(tool_result({"credits": 1}))
        responses.append(HttpResponse(401, {}, b"expired"))
        responses.extend(handshake(tool_result({"credits": 2})))
        built, script = client(responses)
        self.assertEqual(built.account()["credits"], 1)
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertEqual(caught.exception.code, "AUTH_REQUIRED")
        self.assertEqual(caught.exception.status, 401)
        self.assertIn("wan30 auth login", str(caught.exception))
        self.assertEqual(built.account()["credits"], 2)
        methods = [body_json(call)["method"] for call in script.calls]
        self.assertEqual(methods.count("initialize"), 2)

    def test_failed_sign_in_is_retried_without_a_restart(self):
        state = {"ready": False}
        script = Script([HttpResponse(401, {}, b"")])

        def get_token():
            if not state["ready"]:
                raise WanClientError("AUTH_REQUIRED", "Run wan30 auth login.")
            return access_token()

        built = WanClient(get_token=get_token, request=script)
        with self.assertRaises(WanClientError) as first:
            built.account()
        self.assertEqual(first.exception.code, "AUTH_REQUIRED")
        self.assertEqual(script.calls, [])
        state["ready"] = True
        with self.assertRaises(WanClientError) as second:
            built.account()
        self.assertEqual(second.exception.status, 401)
        self.assertEqual(len(script.calls), 1)
        self.assertEqual(script.calls[0].url, ORIGIN + "/api/mcp/")

    def test_redirect_is_not_followed_and_bad_bodies_fail(self):
        built, script = client([HttpResponse(302, {"location": "https://evil.example/"}, b"")])
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertEqual(caught.exception.status, 302)
        self.assertEqual(len(script.calls), 1)

        built, _script = client(
            handshake(tool_result({}))[:2]
            + [HttpResponse(200, {"content-type": "application/json"}, b"")]
        )
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertEqual(str(caught.exception), "The server returned an empty response.")

        built, _script = client(
            handshake(tool_result({}))[:2]
            + [HttpResponse(200, {"content-type": "application/json"}, b"{")]
        )
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertEqual(str(caught.exception), "The server returned an unreadable response.")

    def test_unsupported_protocol_is_not_kept(self):
        bad = http_json(
            200,
            {
                "jsonrpc": "2.0",
                "id": 0,
                "result": {
                    "protocolVersion": "1999-01-01",
                    "capabilities": {},
                    "serverInfo": {"name": "wan30", "version": "0"},
                },
            },
        )
        script = Script([bad, bad])
        built = WanClient.from_token(access_token(), request=script)
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertIn("1999-01-01", str(caught.exception))
        with self.assertRaises(WanClientError):
            built.account()
        self.assertEqual(len(script.calls), 2)
        self.assertEqual(body_json(script.calls[1])["method"], "initialize")

    def test_transport_loss(self):
        built, _script = client([TransportFailure("lost")])
        with self.assertRaises(WanClientError) as caught:
            built.account()
        self.assertEqual(str(caught.exception), "The server response was lost.")

    def test_auth_status_models_and_estimate_payload(self):
        built, script = client(handshake(tool_result({"credits": 1})))
        self.assertEqual(built.auth_status(), {"authenticated": True, "origin": ORIGIN})
        built.close()
        built._mcp  # session object remains; close only drops the handshake
        responses = handshake(tool_result([{"id": "wan30-text-to-video"}]))
        script.responses.extend(responses)
        self.assertEqual(built.models(), [{"id": "wan30-text-to-video"}])
        built.close()
        script.responses.extend(
            handshake(tool_result({"inputSchema": {"type": "object"}}))
        )
        self.assertEqual(
            built.model("wan30-image-to-video"), {"inputSchema": {"type": "object"}}
        )
        self.assertEqual(
            body_json(script.calls[-1])["params"],
            {"name": "get_model", "arguments": {"modelId": "wan30-image-to-video"}},
        )
        built.close()
        script.responses.extend(handshake(tool_result({"credits": 10})))
        self.assertEqual(built.estimate(LAKE), {"credits": 10})
        sent = body_json(script.calls[-1])["params"]["arguments"]["input"]
        self.assertEqual(sent, LAKE)
        self.assertNotIn("aspectRatio", sent)

    def test_tasks_and_unknown_model_do_not_invent_fields(self):
        built, script = client(handshake(tool_result({"tasks": []})))
        self.assertEqual(built.tasks(), {"tasks": []})
        self.assertEqual(body_json(script.calls[-1])["params"]["arguments"], {})
        built.close()
        script.responses.extend(handshake(tool_result({"tasks": []})))
        built.tasks(50)
        self.assertEqual(
            body_json(script.calls[-1])["params"]["arguments"], {"limit": 50}
        )
        for limit in (0, 51, True, 1.5):
            with self.subTest(limit=limit):
                with self.assertRaises(WanClientError) as caught:
                    built.tasks(limit)
                self.assertEqual(caught.exception.code, "INVALID_INPUT")
        with self.assertRaises(WanClientError):
            built.model("wan2.1-t2v")
        with self.assertRaises(WanClientError):
            built.task("")

    def test_generate_requires_explicit_confirmation(self):
        script = Script([])
        built = WanClient.from_token(access_token(), request=script)
        with self.assertRaises(WanClientError) as caught:
            built.generate(LAKE, request_id="forest-lake-shot-001", confirm_spend=False)
        self.assertEqual(caught.exception.code, "SPEND_NOT_CONFIRMED")
        self.assertIn("purchased wan30.video credits", str(caught.exception))
        self.assertIn("check-in", str(caught.exception))
        self.assertEqual(script.calls, [])
        with self.assertRaises(WanClientError) as caught:
            built.generate(LAKE, confirm_spend="true")
        self.assertEqual(caught.exception.code, "SPEND_NOT_CONFIRMED")
        self.assertEqual(script.calls, [])

    def test_generate_sends_request_id_and_not_the_confirmation_flag(self):
        request_id = "forest-lake-shot-001"
        responses = handshake(tool_result({"taskId": "task-1", "status": "PENDING"}))
        responses.append(
            http_json(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "result": tool_result({"taskId": "task-1", "status": "PENDING"}),
                },
            )
        )
        built, script = client(responses)
        created = built.generate(LAKE, request_id=request_id, confirm_spend=True)
        self.assertEqual(created["taskId"], "task-1")
        arguments = body_json(script.calls[-1])["params"]["arguments"]
        self.assertEqual(arguments, {"input": LAKE, "requestId": request_id})
        self.assertNotIn("confirm_spend", arguments)
        self.assertEqual(body_json(script.calls[-1])["params"]["name"], "generate_video")
        again = built.generate(dict(LAKE), request_id=request_id, confirm_spend=True)
        self.assertEqual(again["taskId"], "task-1")
        self.assertEqual(
            body_json(script.calls[-1])["params"]["arguments"]["requestId"], request_id
        )

    def test_generated_request_id_matches_the_published_pattern(self):
        built, script = client(handshake(tool_result({"taskId": "task-2"})))
        built.generate(LAKE, confirm_spend=True)
        request_id = body_json(script.calls[-1])["params"]["arguments"]["requestId"]
        self.assertRegex(request_id, r"^[A-Za-z0-9_-]{16,128}$")

    def test_disconnect_does_not_treat_401_as_a_fresh_login_error(self):
        script = Script([HttpResponse(401, {}, b"")])
        built = WanClient.from_token(access_token(), request=script)
        with self.assertRaises(WanClientError) as caught:
            built.disconnect()
        self.assertEqual(caught.exception.code, "REVOCATION_UNCONFIRMED")
        self.assertEqual(script.calls[0].url, ORIGIN + "/api/mcp/disconnect/")
        self.assertNotIn("mcp-session-id", script.calls[0].headers)
        self.assertEqual(script.calls[0].body, b"")

        script = Script([HttpResponse(204, {}, b"")])
        built = WanClient.from_token(access_token(), request=script)
        built.disconnect()


if __name__ == "__main__":
    unittest.main()
