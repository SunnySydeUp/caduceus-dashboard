"""Honcho's declared config surface, as the real plugin declares the fields a test reads (same keys, kinds, groups, storage)."""

from plugins.memory.config_schema import (
    KIND_BOOL, KIND_NUMBER, KIND_SECRET, KIND_SELECT, KIND_TEXT, STORAGE_HONCHO_HOST_BLOCK,
    ProviderConfigSchema, ProviderField, ProviderFieldOption,
)


def _opts(*pairs):
    return tuple(ProviderFieldOption(value, label) for value, label in pairs)


def _field(key, label, kind, description, *, group, **kw):
    return ProviderField(key=key, label=label, kind=kind, description=description, group=group, **kw)


CONFIG_SCHEMA = ProviderConfigSchema(
    name="honcho",
    label="Honcho",
    storage=STORAGE_HONCHO_HOST_BLOCK,
    docs_url="https://docs.honcho.dev/v3/guides/integrations/hermes",
    fields=(
        _field("apiKey", "API key", KIND_SECRET, "Authenticate with Honcho Cloud. Not needed for a self-hosted base URL.",
               env_key="HONCHO_API_KEY", placeholder="Enter Honcho API key", inline=True, group="Connection"),
        _field("baseUrl", "Base URL", KIND_TEXT, "Self-hosted Honcho URL. Overrides the environment when set.",
               aliases=("base_url",), env_fallbacks=("HONCHO_BASE_URL",), placeholder="https://… (self-hosted)",
               inline=True, group="Connection", scope="root"),
        _field("environment", "Environment", KIND_SELECT, "Honcho environment. Ignored when a base URL is set.",
               default="production", env_fallbacks=("HONCHO_ENVIRONMENT",),
               options=_opts(("production", "Cloud"), ("local", "Local")), inline=True, group="Connection"),
        _field("workspace", "Workspace", KIND_TEXT, "Honcho workspace ID. Defaults to the profile host.",
               inline=True, group="Connection"),
        _field("peerName", "Peer name", KIND_TEXT, "Your stable user peer.", placeholder="e.g. eri", inline=True, group="Identity"),
        _field("timeout", "Request timeout", KIND_NUMBER, "Request timeout in seconds for Honcho HTTP calls. Blank uses the default.",
               aliases=("requestTimeout",), env_fallbacks=("HONCHO_TIMEOUT",), placeholder="30", group="Connection", scope="root"),
        _field("pinUserPeer", "Pin user peer", KIND_BOOL, "Pin the user peer to the peer name, ignoring gateway runtime identity.",
               default="false", aliases=("pinPeerName",), group="Identity"),
    ),
)
