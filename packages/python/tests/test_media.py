import os
import stat
import tempfile
import unittest
from unittest import mock

from support import Script, access_token, handshake, http_json, tool_result

from wan30 import WanClient, WanClientError
from wan30.media import MAX_BYTES
from wan30.transport import TransportFailure


class DownloadResponse:
    def __init__(self, status, headers, chunks):
        self.status = status
        self.headers = headers
        self._chunks = chunks
        self.closed = False

    def iter_chunks(self):
        return iter(self._chunks)

    def close(self):
        self.closed = True


class MediaTests(unittest.TestCase):
    def test_wait_returns_terminal_tasks_and_does_not_cancel(self):
        calls = {"n": 0}

        class Tasks:
            def task(self, task_id):
                calls["n"] += 1
                self.last = task_id
                if calls["n"] == 1:
                    return {"status": "RUNNING", "taskId": task_id}
                return {"status": "FAILED", "taskId": task_id}

        clock = {"t": 0}

        def now():
            return clock["t"]

        def sleep(ms):
            clock["t"] += ms
            slept.append(ms)

        slept = []
        client = Tasks()
        task = client
        from wan30.media import wait_for_task

        found = wait_for_task(task, "task-1", timeout_ms=20_000, now=now, sleep=sleep)
        self.assertEqual(found["status"], "FAILED")
        self.assertEqual(slept, [5000])

        calls["n"] = 0

        class Running:
            def task(self, task_id):
                return {"status": "RUNNING", "taskId": task_id}

        clock["t"] = 0
        with self.assertRaises(WanClientError) as caught:
            wait_for_task(
                Running(),
                "task-9",
                timeout_ms=6000,
                now=now,
                sleep=sleep,
            )
        self.assertEqual(caught.exception.code, "WAIT_TIMEOUT")
        self.assertIn("the task continues", str(caught.exception))
        self.assertNotIn("cancel", str(caught.exception).lower())
        with self.assertRaises(WanClientError) as caught:
            wait_for_task(Running(), "task-9", timeout_ms=0, now=now, sleep=sleep)
        self.assertEqual(caught.exception.code, "INVALID_INPUT")

    def test_download_checks_status_type_and_refuses_to_overwrite(self):
        from wan30 import media as media_module

        task_body = {
            "status": "SAVED_TO_R2",
            "outputs": [
                "https://cdn.example/one.mp4",
                "https://cdn.example/two.mp4",
            ],
        }
        script = Script(handshake(tool_result(task_body)))
        client = WanClient.from_token(access_token(), request=script)
        urls = []

        def open_https(url):
            urls.append(url)
            if url.endswith("/one.mp4"):
                return DownloadResponse(
                    302,
                    {"location": "https://cdn.example/final.mp4"},
                    [],
                )
            return DownloadResponse(200, {"content-type": "video/mp4; charset=binary"}, [b"mp", b"4"])

        with tempfile.TemporaryDirectory() as directory:
            target = os.path.join(directory, "lake.mp4")
            saved = client.download("task-1", target, open_https=open_https)
            self.assertEqual(saved["bytes"], 3)
            self.assertEqual(saved["contentType"], "video/mp4")
            with open(target, "rb") as handle:
                self.assertEqual(handle.read(), b"mp4")
            self.assertEqual(stat.S_IMODE(os.stat(target).st_mode) & 0o077, 0)
            self.assertEqual(urls, ["https://cdn.example/one.mp4", "https://cdn.example/final.mp4"])
            script.responses.append(
                http_json(200, {"jsonrpc": "2.0", "id": 2, "result": tool_result(task_body)})
            )
            with self.assertRaises(WanClientError) as caught:
                client.download("task-1", target, open_https=open_https)
            self.assertEqual(caught.exception.code, "INVALID_INPUT")
            with open(target, "rb") as handle:
                self.assertEqual(handle.read(), b"mp4")

        script.responses.extend(handshake(tool_result({"status": "RUNNING", "outputs": []})))
        client.close()
        with self.assertRaises(WanClientError) as caught:
            client.download("task-1", "ignored.mp4", open_https=lambda url: (_ for _ in ()).throw(AssertionError(url)))
        self.assertEqual(caught.exception.code, "TASK_NOT_READY")
        self.assertIn("RUNNING", str(caught.exception))

        script.responses.extend(
            handshake(tool_result({"status": "COMPLETED", "outputs": ["http://cdn.example/a.mp4"]}))
        )
        client.close()
        with self.assertRaises(WanClientError) as caught:
            client.download("task-1", "ignored.mp4", open_https=lambda url: (_ for _ in ()).throw(AssertionError(url)))
        self.assertEqual(str(caught.exception), "Task has no output.")

        script.responses.extend(
            handshake(
                tool_result(
                    {"status": "COMPLETED", "outputs": ["https://cdn.example/page.html"]}
                )
            )
        )
        client.close()
        with self.assertRaises(WanClientError) as caught:
            client.download(
                "task-1",
                os.path.join(tempfile.gettempdir(), "wan30-not-written.mp4"),
                open_https=lambda url: DownloadResponse(200, {"content-type": "text/html"}, [b"<html>"]),
            )
        self.assertEqual(str(caught.exception), "Unexpected media type.")

        script.responses.extend(
            handshake(tool_result({"status": "COMPLETED", "outputs": ["https://cdn.example/big.mp4"]}))
        )
        client.close()
        original = media_module.MAX_BYTES
        media_module.MAX_BYTES = 4
        try:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(WanClientError) as caught:
                    client.download(
                        "task-1",
                        os.path.join(directory, "big.mp4"),
                        open_https=lambda url: DownloadResponse(
                            200, {"content-type": "video/mp4"}, [b"12345"]
                        ),
                    )
                self.assertEqual(str(caught.exception), "Media is too large.")
                self.assertFalse(os.path.exists(os.path.join(directory, "big.mp4")))
        finally:
            media_module.MAX_BYTES = original
        self.assertEqual(MAX_BYTES, 512 * 1024 * 1024)

    def test_public_download_transport_sends_no_authorization(self):
        chunks = [b"abcd"]

        class FakeResponse:
            status = 200

            def getheaders(self):
                return [("Content-Type", "video/mp4")]

            def read(self, size):
                if chunks:
                    return chunks.pop(0)
                return b""

        class FakeConnection:
            def __init__(self, host, port=None, timeout=None, **kwargs):
                self.host = host
                self.timeout = timeout

            def request(self, method, path, body=None, headers=None):
                self.method = method
                self.path = path
                self.headers = headers
                captured.update(headers=headers, path=path, host=self.host, method=method)

            def getresponse(self):
                return FakeResponse()

            def close(self):
                captured["closed"] = True

        captured = {}
        with mock.patch("wan30.transport.http.client.HTTPSConnection", FakeConnection):
            from wan30.transport import open_public_https

            response = open_public_https("https://cdn.example/lake.mp4")
            data = b"".join(response.iter_chunks())
            response.close()
        self.assertEqual(data, b"abcd")
        self.assertEqual(captured["host"], "cdn.example")
        self.assertEqual(captured["path"], "/lake.mp4")
        self.assertNotIn("Authorization", captured["headers"])
        self.assertTrue(captured["closed"])

        class Redirected:
            def __init__(self, host, port=None, timeout=None, **kwargs):
                raise AssertionError("redirect was followed")

        class Once:
            created = 0

            def __init__(self, host, port=None, timeout=None, **kwargs):
                Once.created += 1

            def request(self, method, path, body=None, headers=None):
                self.headers = headers

            def getresponse(self):
                return type(
                    "Response",
                    (),
                    {
                        "status": 302,
                        "getheaders": lambda self: [("Location", "https://elsewhere.example/x")],
                        "read": lambda self, n: b"",
                    },
                )()

            def close(self):
                pass

        with mock.patch("wan30.transport.http.client.HTTPSConnection", Once):
            from wan30.transport import https_request

            response = https_request(
                "https://wan30.video/api/mcp/",
                method="POST",
                headers={"Authorization": "Bearer secret"},
                body=b"{}",
                timeout=5,
                max_bytes=100,
            )
        self.assertEqual(response.status, 302)
        self.assertEqual(Once.created, 1)
        self.assertEqual(response.headers["location"], "https://elsewhere.example/x")

    def test_download_transport_failure(self):
        script = Script(
            handshake(tool_result({"status": "COMPLETED", "outputs": ["https://cdn.example/a.mp4"]}))
        )
        client = WanClient.from_token(access_token(), request=script)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(WanClientError) as caught:
                client.download(
                    "task-1",
                    os.path.join(directory, "a.mp4"),
                    open_https=lambda url: (_ for _ in ()).throw(TransportFailure("reset")),
                )
            self.assertEqual(caught.exception.code, "DOWNLOAD_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
