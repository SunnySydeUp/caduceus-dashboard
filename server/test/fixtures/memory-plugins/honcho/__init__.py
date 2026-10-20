"""A stand-in for the Honcho memory provider plugin (plastic-labs/honcho, hermes-plugin-honcho).

It has what Hermes's memory routes and OAuth routes use of the real one: the provider name, `is_available`, a
`config_schema.py` (the form Hermes builds for it), a `client` module that says where Honcho's settings file and
this profile's host block are, an `oauth` module that guards that file, and an `oauth_flow` module that signs in
through the browser. It never talks to Honcho itself: the sign-in's authorization server is the one a test starts."""

from agent.memory_provider import MemoryProvider


class HonchoMemoryProvider(MemoryProvider):
    @property
    def name(self):
        return "honcho"

    def is_available(self):
        from .client import credential_of
        return credential_of() is not None

    def initialize(self, session_id, **kwargs):
        pass

    def get_tool_schemas(self):
        return []

    def get_config_schema(self):
        return [
            {"key": "api_key", "description": "Honcho API key", "secret": True, "env_var": "HONCHO_API_KEY", "url": "https://app.honcho.dev"},
            {"key": "baseUrl", "description": "Honcho base URL (for self-hosted)"},
        ]


def register(ctx):
    ctx.register_memory_provider(HonchoMemoryProvider())
