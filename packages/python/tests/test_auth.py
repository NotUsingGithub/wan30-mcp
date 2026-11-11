import hashlib
import json
import os
import socket
import stat
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import parse_qs

from support import access_token

from wan30 import CredentialManager, FileVault, WanClientError, credential_name, token_identity
from wan30.auth import (
    CLIENT_ID,
    SCOPES,
    build_authorize_url,
    code_challenge,
    evaluate_callback,
    receive_authorization,
)
from wan30.transport import HttpResponse, TransportFailure

ORIGIN = "https://wan30.video"
IDENTITY = "22d8c01ae2e59432cb8c35362d60ea6777adaeeedd7eb09bbe2ecdf3ae539eee"
CREDENTIAL_HASH = "583d36f2ebd7588300b0b4bf3a0544714cf50023a33a92698dcca6561460eb46"


def token_response(**overrides):
    payload = {
        "token_type": "Bearer",
        "access_token": access_token(),
        "refresh_token": "refresh-token-1",
        "expires_in": 3600,
    }
    payload.update(overrides)
    return payload


class TokenIdentityTests(unittest.TestCase):
    def test_identity_matches_the_cli_claim_hash(self):
        self.assertEqual(token_identity(access_token(), ORIGIN), IDENTITY)
        self.assertEqual(
            credential_name(ORIGIN),
            f"credentials-{CREDENTIAL_HASH}.json",
        )
        self.assertEqual(
            hashlib.sha256(ORIGIN.encode("utf-8")).hexdigest(),
            CREDENTIAL_HASH,
        )

    def test_pkce_s256_uses_the_rfc_7636_vector(self):
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        self.assertEqual(code_challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")

    def test_rejects_tokens_that_are_not_wan30_authorizations(self):
        samples = [
            "not-a-jwt",
            access_token(aud="https://example.com/api/mcp"),
            access_token(sub=""),
            access_token(grant_id=""),
            "aaa.%%%not-json%%%.sig",
            "a" * 32_769,
        ]
        # A token with a non-string subject is built directly.
        samples.append(self._token({"sub": 1, "grant_id": "g", "aud": ORIGIN + "/api/mcp"}))
        for token in samples:
            with self.subTest(token=token[:40]):
                with self.assertRaises(WanClientError) as caught:
                    token_identity(token, ORIGIN)
                self.assertEqual(caught.exception.code, "INVALID_TOKEN")

    def _token(self, claims):
        from support import jwt

        return jwt(claims)


class AuthorizeUrlTests(unittest.TestCase):
    def test_query_matches_the_cli(self):
        url = build_authorize_url(
            origin=ORIGIN,
            redirect_uri="http://127.0.0.1:8787/oauth/callback",
            state="state-1",
            verifier="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        )
        parts = urllib.parse.urlsplit(url)
        self.assertEqual(parts.scheme + "://" + parts.netloc + parts.path, ORIGIN + "/api/auth/oauth2/authorize/")
        query = parse_qs(parts.query)
        self.assertEqual(query["client_id"], [CLIENT_ID])
        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["resource"], [ORIGIN + "/api/mcp"])
        self.assertEqual(query["scope"], [SCOPES])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["redirect_uri"], ["http://127.0.0.1:8787/oauth/callback"])
        self.assertNotIn("/", query["resource"][0].split("/api/mcp")[-1])


class CallbackTests(unittest.TestCase):
    def test_callback_decisions(self):
        redirect = "http://127.0.0.1:8787/oauth/callback"
        ok = evaluate_callback(
            method="GET",
            target="/oauth/callback?code=abc&state=state-1",
            host="127.0.0.1:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(ok[0], "finish")
        self.assertEqual(ok[2], "abc")
        denied = evaluate_callback(
            method="GET",
            target="/oauth/callback?error=access_denied&state=state-1",
            host="127.0.0.1:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(denied[1], "denied")
        ignored = evaluate_callback(
            method="GET",
            target="/oauth/callback?code=abc&state=other",
            host="127.0.0.1:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(ignored[0], "ignore")
        wrong_host = evaluate_callback(
            method="GET",
            target="/oauth/callback?code=abc&state=state-1",
            host="localhost:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(wrong_host[0], "ignore")
        posted = evaluate_callback(
            method="POST",
            target="/oauth/callback?code=abc&state=state-1",
            host="127.0.0.1:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(posted[0], "ignore")
        long_code = "a" * 4097
        too_long = evaluate_callback(
            method="GET",
            target=f"/oauth/callback?code={long_code}&state=state-1",
            host="127.0.0.1:8787",
            state="state-1",
            redirect_uri=redirect,
        )
        self.assertEqual(too_long[1], "denied")

    def test_loopback_server_ignores_a_bad_callback_then_accepts(self):
        captured = {}

        def launch(url):
            query = parse_qs(urllib.parse.urlsplit(url).query)
            redirect = query["redirect_uri"][0]
            state = query["state"][0]
            captured["challenge"] = query["code_challenge"][0]
            bad = redirect + "?code=abc&state=nope"
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(bad, timeout=5)
            self.assertEqual(caught.exception.code, 400)
            good = redirect + "?" + urllib.parse.urlencode({"code": "from-browser", "state": state})
            with urllib.request.urlopen(good, timeout=5) as response:
                self.assertIn(b"Authorization received", response.read())

        result = receive_authorization(
            origin=ORIGIN,
            launch=launch,
            report=lambda _value: None,
            port=0,
            timeout_s=5,
        )
        self.assertEqual(result["code"], "from-browser")
        self.assertEqual(code_challenge(result["verifier"]), captured["challenge"])
        self.assertTrue(result["redirectUri"].endswith("/oauth/callback"))

    def test_timeout_and_busy_port(self):
        with self.assertRaises(WanClientError) as caught:
            receive_authorization(
                origin=ORIGIN,
                launch=lambda _url: None,
                report=lambda _value: None,
                port=0,
                timeout_s=0.2,
            )
        self.assertEqual(caught.exception.code, "AUTH_TIMEOUT")
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        try:
            with self.assertRaises(WanClientError) as caught:
                receive_authorization(
                    origin=ORIGIN,
                    launch=lambda _url: None,
                    report=lambda _value: None,
                    port=sock.getsockname()[1],
                    timeout_s=1,
                )
            self.assertEqual(caught.exception.code, "CALLBACK_UNAVAILABLE")
            self.assertIn("8787", str(caught.exception))
        finally:
            sock.close()


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = FileVault(self.tmp.name)
        self.now_ms = 1_700_000_000_000

    def tearDown(self):
        self.tmp.cleanup()

    def manager(self, request, **kwargs):
        return CredentialManager(
            origin=ORIGIN,
            files=self.vault,
            request=request,
            access_token=None,
            now=lambda: self.now_ms,
            **kwargs,
        )

    def test_login_exchanges_the_code_and_stores_a_private_file(self):
        seen = {}

        def request(url, *, method, headers, body, timeout, max_bytes):
            seen["url"] = url
            seen["body"] = body.decode()
            seen["headers"] = headers
            seen["timeout"] = timeout
            return HttpResponse(
                200,
                {"content-type": "application/json"},
                json.dumps(token_response()).encode(),
            )

        def receive(**_kwargs):
            return {
                "code": "code-1",
                "verifier": "verifier-1",
                "redirectUri": "http://127.0.0.1:8787/oauth/callback",
            }

        result = self.manager(request, receive=receive).login(
            launch=lambda _url: None, report=lambda _value: None
        )
        self.assertEqual(result, {"authenticated": True, "origin": ORIGIN})
        self.assertEqual(seen["url"], ORIGIN + "/api/auth/oauth2/token/")
        self.assertEqual(seen["timeout"], 30)
        self.assertEqual(seen["headers"]["Content-Type"], "application/x-www-form-urlencoded")
        form = parse_qs(seen["body"])
        self.assertEqual(form["client_id"], [CLIENT_ID])
        self.assertEqual(form["resource"], [ORIGIN + "/api/mcp"])
        self.assertEqual(form["grant_type"], ["authorization_code"])
        self.assertEqual(form["code"], ["code-1"])
        self.assertEqual(form["code_verifier"], ["verifier-1"])
        stored = self.vault.read(credential_name(ORIGIN))
        self.assertEqual(stored["refreshToken"], "refresh-token-1")
        self.assertFalse(stored["refreshUncertain"])
        info = os.stat(self.vault.target(credential_name(ORIGIN)))
        self.assertEqual(stat.S_IMODE(info.st_mode) & 0o077, 0)
        self.assertEqual(stat.S_IMODE(os.stat(self.vault.directory).st_mode) & 0o077, 0)

    def test_environment_token_blocks_interactive_login(self):
        manager = CredentialManager(
            origin=ORIGIN,
            files=self.vault,
            access_token=access_token(),
            request=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("network")),
        )
        self.assertEqual(manager.token(), access_token())
        with self.assertRaises(WanClientError) as caught:
            manager.login(launch=lambda _url: None, report=lambda _value: None)
        self.assertEqual(caught.exception.code, "INVALID_INPUT")
        self.assertIn("WAN30_ACCESS_TOKEN", str(caught.exception))

    def test_refresh_marks_uncertainty_before_the_request(self):
        name = credential_name(ORIGIN)
        original = {
            "origin": ORIGIN,
            "accessToken": access_token(),
            "refreshToken": "refresh-old",
            "expiresAt": 1,
            "refreshUncertain": False,
        }
        self.vault.write(name, original)
        during = {}

        def request(url, *, method, headers, body, timeout, max_bytes):
            during["stored"] = self.vault.read(name)
            during["body"] = body.decode()
            return HttpResponse(
                429,
                {"content-type": "application/json"},
                json.dumps({"error": "slow_down", "refresh_token_unchanged": True}).encode(),
            )

        manager = self.manager(request)
        with self.assertRaises(WanClientError) as caught:
            manager.token()
        self.assertEqual(caught.exception.code, "AUTH_RETRY_LATER")
        self.assertEqual(caught.exception.status, 429)
        self.assertTrue(during["stored"]["refreshUncertain"])
        self.assertIn("refresh_token=refresh-old", during["body"])
        restored = self.vault.read(name)
        self.assertFalse(restored["refreshUncertain"])
        self.assertEqual(restored["refreshToken"], "refresh-old")

    def test_lost_or_rejected_refresh_is_not_retried(self):
        name = credential_name(ORIGIN)
        self.vault.write(
            name,
            {
                "origin": ORIGIN,
                "accessToken": access_token(),
                "refreshToken": "refresh-old",
                "expiresAt": 1,
                "refreshUncertain": False,
            },
        )
        calls = {"n": 0}

        def request(url, *, method, headers, body, timeout, max_bytes):
            calls["n"] += 1
            raise TransportFailure("socket")

        manager = self.manager(request)
        with self.assertRaises(WanClientError) as caught:
            manager.token()
        self.assertEqual(caught.exception.code, "AUTH_OUTCOME_UNKNOWN")
        self.assertIn("do not retry the same refresh token", str(caught.exception))
        self.assertTrue(self.vault.read(name)["refreshUncertain"])
        with self.assertRaises(WanClientError) as caught:
            manager.token()
        self.assertEqual(caught.exception.code, "AUTH_REQUIRED")
        self.assertEqual(calls["n"], 1)

    def test_other_429_does_not_clear_uncertainty(self):
        name = credential_name(ORIGIN)
        self.vault.write(
            name,
            {
                "origin": ORIGIN,
                "accessToken": access_token(),
                "refreshToken": "refresh-old",
                "expiresAt": 1,
                "refreshUncertain": False,
            },
        )

        def request(url, *, method, headers, body, timeout, max_bytes):
            return HttpResponse(429, {"content-type": "application/json"}, b'{"error":"rate_limited"}')

        manager = self.manager(request)
        with self.assertRaises(WanClientError) as caught:
            manager.token()
        self.assertEqual(caught.exception.code, "AUTH_REQUIRED")
        self.assertTrue(self.vault.read(name)["refreshUncertain"])

    def test_successful_refresh_replaces_the_grant_once(self):
        name = credential_name(ORIGIN)
        self.vault.write(
            name,
            {
                "origin": ORIGIN,
                "accessToken": access_token(),
                "refreshToken": "refresh-old",
                "expiresAt": 1,
                "refreshUncertain": False,
            },
        )
        calls = {"n": 0}
        new_token = access_token(grant_id="grant-2")

        def request(url, *, method, headers, body, timeout, max_bytes):
            calls["n"] += 1
            return HttpResponse(
                200,
                {"content-type": "application/json"},
                json.dumps(
                    token_response(access_token=new_token, refresh_token="refresh-new")
                ).encode(),
            )

        manager = self.manager(request)
        self.assertEqual(manager.token(), new_token)
        self.assertEqual(manager.token(), new_token)
        self.assertEqual(calls["n"], 1)
        stored = self.vault.read(name)
        self.assertEqual(stored["refreshToken"], "refresh-new")
        self.assertFalse(stored["refreshUncertain"])

    def test_invalid_token_responses(self):
        samples = [
            token_response(expires_in=0),
            token_response(expires_in=86_401),
            token_response(expires_in=True),
            token_response(expires_in=30.0),
            token_response(token_type="mac"),
            token_response(refresh_token=""),
            token_response(refresh_token="r" * 32_769),
            token_response(access_token=access_token(aud="https://evil.example/api/mcp")),
        ]
        for payload in samples:
            with self.subTest(payload=sorted(payload)):
                def request(url, *, method, headers, body, timeout, max_bytes, payload=payload):
                    return HttpResponse(
                        200,
                        {"content-type": "application/json"},
                        json.dumps(payload).encode(),
                    )

                manager = self.manager(request, receive=lambda **_kwargs: {
                    "code": "c",
                    "verifier": "v",
                    "redirectUri": "http://127.0.0.1:8787/oauth/callback",
                })
                with self.assertRaises(WanClientError) as caught:
                    manager.login(launch=lambda _url: None, report=lambda _value: None)
                self.assertIn(caught.exception.code, {"INVALID_RESPONSE", "INVALID_TOKEN"})
                self.assertIsNone(self.vault.read(credential_name(ORIGIN)))

    def test_private_file_checks(self):
        name = credential_name(ORIGIN)
        self.vault.write(name, {"origin": ORIGIN})
        os.chmod(self.vault.target(name), 0o644)
        with self.assertRaises(WanClientError) as caught:
            self.vault.read(name)
        self.assertEqual(caught.exception.code, "UNSAFE_CONFIG")
        os.chmod(self.vault.target(name), 0o600)
        outside = os.path.join(self.tmp.name, "outside.json")
        with open(outside, "w", encoding="utf-8") as handle:
            handle.write('{"accessToken":"secret"}')
        os.unlink(self.vault.target(name))
        os.symlink(outside, self.vault.target(name))
        with self.assertRaises(WanClientError) as caught:
            self.vault.read(name)
        self.assertEqual(caught.exception.code, "UNSAFE_CONFIG")

    def test_busy_lock_is_not_taken_over(self):
        name = credential_name(ORIGIN)
        self.vault.write(f"{name}.lock", {"pid": 1}, exclusive=True)
        with self.assertRaises(WanClientError) as caught:
            self.vault.lock(name, lambda: None, timeout_s=0)
        self.assertEqual(caught.exception.code, "BUSY")
        self.assertIn("No refresh was retried", str(caught.exception))

    def test_logout_messages(self):
        class Remote:
            def __init__(self, fail=False):
                self.fail = fail
                self.calls = 0

            def disconnect(self):
                self.calls += 1
                if self.fail:
                    raise WanClientError("REVOCATION_UNCONFIRMED", "Could not disconnect.")

        name = credential_name(ORIGIN)
        self.vault.write(name, {"origin": ORIGIN, "refreshToken": "refresh-old"})
        manager = self.manager(lambda **_kwargs: None)
        remote = Remote()
        self.assertEqual(manager.logout(remote), {"revoked": True, "origin": ORIGIN})
        self.assertEqual(remote.calls, 1)
        self.assertIsNone(self.vault.read(name))

        self.vault.write(name, {"origin": ORIGIN, "refreshToken": "refresh-old"})
        manager = self.manager(lambda **_kwargs: None)
        with self.assertRaises(WanClientError) as caught:
            manager.logout(Remote(fail=True))
        self.assertEqual(caught.exception.code, "REVOCATION_UNCONFIRMED")
        self.assertIn("Local credentials removed", str(caught.exception))
        self.assertIsNone(self.vault.read(name))

        env = CredentialManager(
            origin=ORIGIN,
            files=self.vault,
            access_token=access_token(),
            request=lambda **_kwargs: None,
        )
        self.vault.write(name, {"origin": ORIGIN, "refreshToken": "keep"})
        with self.assertRaises(WanClientError) as caught:
            env.logout(Remote(fail=True))
        self.assertIn("unset WAN30_ACCESS_TOKEN", str(caught.exception))
        self.assertEqual(self.vault.read(name)["refreshToken"], "keep")


if __name__ == "__main__":
    unittest.main()
