"""A stand-in for the Hindsight memory provider plugin (vectorize-io/hindsight, hindsight-integrations/hermes).

It has what Hermes's memory routes and Caduceus read of the real one: the provider name, the form
(`get_config_schema`, one `api_url` and `api_key` per mode), the settings file
(`$HERMES_HOME/hindsight/config.json`, written by `save_config`), the key in `.env` as HINDSIGHT_API_KEY,
and `is_available`. It never talks to Hindsight."""

import json
from pathlib import Path

from agent.memory_provider import MemoryProvider
from hermes_constants import get_hermes_home
from utils import atomic_json_write

_CLOUD_URL = "https://api.hindsight.vectorize.io"
_LOCAL_URL = "http://localhost:8888"


def _load_config():
    try:
        data = json.loads((Path(get_hermes_home()) / "hindsight" / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class HindsightMemoryProvider(MemoryProvider):
    @property
    def name(self):
        return "hindsight"

    def is_available(self):
        # The embedded daemon needs a runtime a test home does not have.
        return _load_config().get("mode", "cloud") != "local_embedded"

    def initialize(self, session_id, **kwargs):
        pass

    def get_tool_schemas(self):
        return []

    def save_config(self, values, hermes_home):
        path = Path(hermes_home) / "hindsight" / "config.json"
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            current = {}
        atomic_json_write(path, {**(current if isinstance(current, dict) else {}), **values}, mode=0o600)

    def get_config_schema(self):
        return [
            {"key": "mode", "description": "Connection mode", "default": "cloud", "choices": ["cloud", "local_embedded", "local_external"]},
            {"key": "api_url", "description": "Hindsight Cloud API URL", "default": _CLOUD_URL, "when": {"mode": "cloud"}},
            {"key": "api_key", "description": "Hindsight Cloud API key", "secret": True, "env_var": "HINDSIGHT_API_KEY", "when": {"mode": "cloud"}},
            {"key": "api_url", "description": "Hindsight API URL", "default": _LOCAL_URL, "when": {"mode": "local_external"}},
            {"key": "api_key", "description": "API key (optional)", "secret": True, "env_var": "HINDSIGHT_API_KEY", "when": {"mode": "local_external"}},
            {"key": "bank_id", "description": "Memory bank name (static fallback when bank_id_template is unset)", "default": "hermes"},
            {"key": "bank_id_template", "description": "Optional template to derive bank_id dynamically. Placeholders: {profile}, {workspace}, {project}, {platform}, {user}, {session}.", "default": ""},
            {"key": "recall_budget", "description": "Recall thoroughness", "default": "mid", "choices": ["low", "mid", "high"]},
        ]


def register(ctx):
    ctx.register_memory_provider(HindsightMemoryProvider())
