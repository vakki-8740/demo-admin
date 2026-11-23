#!/usr/bin/env python3
"""Local static-file server + OS keychain bridge for GitHub Project Manager.
Binds to loopback only. Credentials are never written to project files.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote
import json
import os
import sys

try:
    import keyring
except ImportError:
    print("Missing dependency. Run: python -m pip install -r requirements.txt", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8765
SERVICE = "ArenaGitHubProjectManager"
ACCOUNT = "credentials-v1"
ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
ALLOWED_KEYRING_MODULES = (
    "keyring.backends.Windows", "keyring.backends.macOS",
    "keyring.backends.SecretService", "keyring.backends.kwallet",
)


def keyring_backend():
    backend = keyring.get_keyring()
    module = type(backend).__module__
    if getattr(backend, "priority", 0) <= 0 or not module.startswith(ALLOWED_KEYRING_MODULES):
        raise RuntimeError(
            "No supported OS keychain is available. Enable Windows Credential Manager, "
            "macOS Keychain, or Linux Secret Service/KWallet, then restart this app. "
            f"Detected backend: {module}.{type(backend).__name__}"
        )
    return backend


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        # Avoid writing paths, request bodies, or account data to a log file.
        print("[local-ui] " + fmt % args)

    def _security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://api.github.com https://api.openai.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'")

    def end_headers(self):
        self._security_headers()
        super().end_headers()

    def _local_request_ok(self, write=False):
        if self.headers.get("Host", "").lower() not in ALLOWED_HOSTS:
            return False
        if self.headers.get("X-Local-App") != "GitHubManager":
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            return parsed.scheme == "http" and parsed.netloc.lower() in ALLOWED_HOSTS
        return not write

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _credentials(self):
        value = keyring.get_password(SERVICE, ACCOUNT)
        return json.loads(value) if value else None

    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self._local_request_ok():
                return self._json(403, {"error": "Local app origin is not allowed."})
            if urlparse(self.path).path == "/api/status":
                try:
                    backend = keyring_backend()
                    return self._json(200, {"ok": True, "keychain": type(backend).__name__})
                except Exception as exc:
                    return self._json(503, {"ok": False, "error": str(exc)})
            if urlparse(self.path).path == "/api/credentials":
                try:
                    value = self._credentials()
                    return self._json(200, {"configured": bool(value), "credentials": value or {"username": "", "token": "", "openaiKey": ""}})
                except Exception as exc:
                    return self._json(503, {"error": str(exc)})
            return self._json(404, {"error": "Unknown local API route."})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/credentials" or not self._local_request_ok(write=True):
            return self._json(403, {"error": "Local app origin is not allowed."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 16384:
                return self._json(413, {"error": "Invalid credentials request size."})
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            username = str(data.get("username", "")).strip()
            token = str(data.get("token", "")).strip()
            openai_key = str(data.get("openaiKey", "")).strip()
            if not username or not token:
                return self._json(400, {"error": "GitHub username and token are required."})
            keyring_backend()
            keyring.set_password(SERVICE, ACCOUNT, json.dumps({"username": username, "token": token, "openaiKey": openai_key}, ensure_ascii=False))
            return self._json(200, {"ok": True})
        except Exception as exc:
            return self._json(503, {"error": str(exc)})

    def do_DELETE(self):
        if urlparse(self.path).path != "/api/credentials" or not self._local_request_ok(write=True):
            return self._json(403, {"error": "Local app origin is not allowed."})
        try:
            keyring_backend()
            try:
                keyring.delete_password(SERVICE, ACCOUNT)
            except keyring.errors.PasswordDeleteError:
                pass
            return self._json(200, {"ok": True})
        except Exception as exc:
            return self._json(503, {"error": str(exc)})


if __name__ == "__main__":
    try:
        backend = keyring_backend()
        print(f"GitHub Project Manager running at http://localhost:{PORT}")
        print(f"Credentials use OS keychain: {type(backend).__name__}")
        print("Keep this terminal open while using the app. Stop with Ctrl+C.")
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except Exception as exc:
        print(f"Cannot start secure keychain helper: {exc}", file=sys.stderr)
        sys.exit(1)
