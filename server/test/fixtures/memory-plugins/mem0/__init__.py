"""A stand-in for the Mem0 memory provider plugin: what Hermes's memory routes read of it. Settings are in
`$HERMES_HOME/mem0.json`, the key in `.env` as MEM0_API_KEY, the form is the provider's own `get_config_schema`
(the key is required), and the provider is available once it has a key or a host. It talks to nothing."""

import json
from pathlib import Path

from agent.memory_provider import MemoryProvider
from hermes_constants import get_hermes_home
from utils import atomic_json_write


def _load_config():
    try:
        data = json.loads((Path(get_hermes_home()) / "mem0.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class Mem0MemoryProvider(MemoryProvider):
    @property
    def name(self):
        return "mem0"

    def is_available(self):
        import os
        cfg = _load_config()
        return bool(cfg.get("api_key") or cfg.get("host") or os.environ.get("MEM0_API_KEY"))

    def initialize(self, session_id, **kwargs):
        pass

    def get_tool_schemas(self):
        return []

    def save_config(self, values, hermes_home):
        path = Path(hermes_home) / "mem0.json"
        atomic_json_write(path, {**_load_config(), **values}, mode=0o600)

    def get_config_schema(self):
        return [
            {"key": "api_key", "description": "Mem0 Platform API key", "secret": True, "required": True, "env_var": "MEM0_API_KEY", "url": "https://app.mem0.ai"},
            {"key": "host", "description": "Self-hosted Mem0 server URL (leave blank for cloud)", "required": False, "env_var": "MEM0_HOST"},
            {"key": "user_id", "description": "User identifier", "default": "hermes-user"},
            {"key": "agent_id", "description": "Agent identifier", "default": "hermes"},
            {"key": "rerank", "description": "Enable reranking for recall", "default": "false", "choices": ["true", "false"]},
        ]


def register(ctx):
    ctx.register_memory_provider(Mem0MemoryProvider())
