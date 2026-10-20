"""The guards around Honcho's settings file that Hermes's save route takes, and the way a grant is stored."""

import json
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from utils import atomic_json_write

from .client import _host_block

ACCESS_TOKEN_PREFIX = "hch-at-"
REFRESH_TOKEN_PREFIX = "hch-rt-"

_refresh_lock = threading.Lock()
_file_locks = {}


@contextmanager
def _config_refresh_lock(path):
    lock = _file_locks.setdefault(str(path), threading.Lock())
    with lock:
        yield


def _read_config_strict(path):
    """{} when the file is absent; a file that exists but does not parse raises."""
    path = Path(path)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    return data


def install_grant(path, host, grant, *, client_id, token_endpoint):
    """Stores a token grant in the host block: the access token where the key goes, the rest under `oauth`."""
    with _refresh_lock, _config_refresh_lock(path):
        cfg = _read_config_strict(path)
        hosts = cfg.get("hosts")
        cfg["hosts"] = hosts = hosts if isinstance(hosts, dict) else {}
        block = hosts.setdefault(host, _host_block(cfg, host))
        block["apiKey"] = grant["access_token"]
        block["oauth"] = {
            "clientId": client_id,
            "tokenEndpoint": token_endpoint,
            "refreshToken": grant.get("refresh_token", ""),
            "expiresAt": time.time() + float(grant.get("expires_in", 3600)),
        }
        atomic_json_write(Path(path), cfg, mode=0o600)
