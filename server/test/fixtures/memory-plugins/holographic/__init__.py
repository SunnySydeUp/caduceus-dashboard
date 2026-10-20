"""A stand-in for the Holographic memory provider plugin: what Hermes's memory routes read of it. Its settings live
under `plugins.hermes-memory-store` in config.yaml (Hermes reads that section for this provider by name), its form
is the provider's own `get_config_schema`, and it is always available. It stores nothing."""

from pathlib import Path

from agent.memory_provider import MemoryProvider
from hermes_cli.config import save_config

_DEFAULT_DB_PATH = "$HERMES_HOME/memory_store.db"


class HolographicMemoryProvider(MemoryProvider):
    @property
    def name(self):
        return "holographic"

    def is_available(self):
        return True

    def initialize(self, session_id, **kwargs):
        pass

    def get_tool_schemas(self):
        return []

    def save_config(self, values, hermes_home):
        values = dict(values)
        db_path = values.get("db_path")
        if isinstance(db_path, str) and Path(db_path).expanduser() == Path(hermes_home) / "memory_store.db":
            values["db_path"] = _DEFAULT_DB_PATH
        save_config({"plugins": {"hermes-memory-store": values}}, merge_existing=True)

    def get_config_schema(self):
        return [
            {"key": "db_path", "description": "SQLite database path", "default": _DEFAULT_DB_PATH},
            {"key": "auto_extract", "description": "Auto-extract facts at session end", "default": "false", "choices": ["true", "false"]},
            {"key": "default_trust", "description": "Default trust score for new facts", "default": "0.5"},
            {"key": "hrr_dim", "description": "HRR vector dimensions", "default": "1024"},
        ]


def register(ctx):
    ctx.register_memory_provider(HolographicMemoryProvider())
