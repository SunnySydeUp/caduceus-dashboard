"""Where Honcho's settings are: `$HERMES_HOME/honcho.json`, with one host block per profile."""

import json
import os
from pathlib import Path

from hermes_constants import get_hermes_home

HOST = "hermes"


def _host_block(raw, host):
    hosts = raw.get("hosts") or {}
    block = hosts.get(host, {})
    if block or not host.startswith(f"{HOST}_"):
        return block
    return hosts.get(f"{HOST}.{host[len(HOST) + 1:]}", {})


def resolve_active_host():
    try:
        from hermes_cli.profiles import get_active_profile_name
        name = get_active_profile_name()
    except Exception:
        name = "default"
    return HOST if name in ("", "default", "custom") else f"{HOST}_{name}"


def resolve_config_path():
    return Path(get_hermes_home()) / "honcho.json"


def read_config():
    path = resolve_config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def credential_of():
    """'oauth', 'apikey', or None: what this profile's host block holds."""
    raw = read_config()
    block = _host_block(raw, resolve_active_host())
    if block.get("oauth"):
        return "oauth"
    if block.get("apiKey") or raw.get("baseUrl") or os.environ.get("HONCHO_API_KEY"):
        return "apikey"
    return None
