"""Browser sign-in for the Honcho provider: a loopback listener, the authorization-code flow with PKCE (S256), and a
status a dashboard polls (idle, pending, connected, error). The authorize and token addresses come from
HONCHO_OAUTH_AUTHORIZE_URL and HONCHO_OAUTH_TOKEN_URL, the browser from the BROWSER environment variable."""

import base64
import hashlib
import logging
import os
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from . import oauth
from .client import credential_of, resolve_active_host, resolve_config_path

logger = logging.getLogger(__name__)

_CLIENT_ID = "hermes-agent"
_state = {"state": "idle", "detail": ""}
_lock = threading.Lock()


def _set(state, detail=""):
    with _lock:
        _state.update(state=state, detail=detail)


def get_flow_status():
    with _lock:
        state, detail = _state["state"], _state["detail"]
    auth = credential_of()
    return {"state": state, "detail": detail, "connected": auth is not None, "auth": auth}


def _loopback_server():
    captured = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            params = parse_qs(parsed.query)
            for key in ("code", "state", "error", "error_description"):
                captured[key] = (params.get(key) or [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<!doctype html><title>Honcho</title>You can close this tab.")

        def log_message(self, *args):
            return

    return HTTPServer(("127.0.0.1", 0), Handler), captured


def _authorize(path, host, timeout):
    server, captured = _loopback_server()
    redirect_uri = f"http://127.0.0.1:{server.server_address[1]}/callback"
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(32)
    query = urlencode({
        "client_id": _CLIENT_ID, "redirect_uri": redirect_uri, "scope": "write", "code_challenge": challenge,
        "code_challenge_method": "S256", "response_type": "code", "state": state,
    })
    authorize_url = f"{os.environ['HONCHO_OAUTH_AUTHORIZE_URL']}?{query}"
    threading.Thread(target=lambda: webbrowser.open(authorize_url), daemon=True).start()
    server.timeout = timeout
    try:
        while "code" not in captured and "error" not in captured:
            server.handle_request()
    finally:
        server.server_close()
    if captured.get("error"):
        raise ValueError(f"authorization denied: {captured['error']}")
    if captured.get("state") != state:
        raise ValueError("OAuth state mismatch")
    token_url = os.environ["HONCHO_OAUTH_TOKEN_URL"]
    response = httpx.post(token_url, data={
        "grant_type": "authorization_code", "client_id": _CLIENT_ID, "code": captured["code"],
        "redirect_uri": redirect_uri, "code_verifier": verifier,
    }, timeout=15.0)
    response.raise_for_status()
    oauth.install_grant(path, host, response.json(), client_id=_CLIENT_ID, token_endpoint=token_url)


def start_loopback_flow_background(*, timeout=300.0):
    # Resolved now, under the caller's profile: the worker thread cannot see the override.
    path, host = resolve_config_path(), resolve_active_host()
    with _lock:
        if _state["state"] == "pending":
            return {"state": _state["state"], "detail": _state["detail"]}
        _state.update(state="pending", detail="waiting for browser consent")

    def run():
        try:
            _authorize(path, host, timeout)
            _set("connected", "Honcho connected")
        except Exception as exc:
            logger.warning("Honcho sign-in failed: %s", exc)
            _set("error", str(exc))

    threading.Thread(target=run, name="honcho-oauth-loopback", daemon=True).start()
    return get_flow_status()
