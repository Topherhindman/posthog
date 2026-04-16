"""Helpers for fetching and caching the tools an upstream MCP server exposes.

The proxy enforces per-tool approval (`approved` / `needs_approval` / `do_not_use`)
against these cached rows — so they need to stay reasonably fresh. Refresh happens
on successful install/reconnect and on-demand via the UI's "Refresh tools" button.
"""

import json
from typing import Any

from django.utils import timezone

import httpx
import structlog

from posthog.security.url_validation import is_url_allowed

from .models import MCPServerInstallation, MCPServerInstallationTool
from .oauth import TokenRefreshError, is_token_expiring, refresh_installation_token
from .proxy import UPSTREAM_TIMEOUT, build_upstream_auth_headers

logger = structlog.get_logger(__name__)

# JSON-RPC id isn't meaningful for a one-off tools/list call, but upstream
# servers expect a value so they can correlate the response.
_TOOLS_LIST_ID = 1


class ToolsFetchError(Exception):
    pass


def _ensure_valid_token_for_fetch(installation: MCPServerInstallation) -> None:
    if installation.auth_type != "oauth":
        return
    sensitive = installation.sensitive_configuration or {}
    if not is_token_expiring(sensitive):
        return
    try:
        refresh_installation_token(installation)
    except TokenRefreshError as exc:
        raise ToolsFetchError(f"Token refresh failed: {exc}") from exc


def fetch_upstream_tools(installation: MCPServerInstallation) -> list[dict[str, Any]]:
    """Send a JSON-RPC ``tools/list`` to the upstream MCP server and return its tool array.

    Shares the proxy's SSRF guard + timeout + auth-header builder so behavior stays
    consistent between proxy traffic and sync traffic.
    """
    allowed, reason = is_url_allowed(installation.url)
    if not allowed:
        raise ToolsFetchError(f"URL not allowed: {reason}")

    _ensure_valid_token_for_fetch(installation)

    auth_headers = build_upstream_auth_headers(installation)
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        **auth_headers,
    }

    body = json.dumps({"jsonrpc": "2.0", "id": _TOOLS_LIST_ID, "method": "tools/list", "params": {}}).encode()

    try:
        with httpx.Client(timeout=UPSTREAM_TIMEOUT) as client:
            response = client.post(installation.url, content=body, headers=headers)
    except httpx.ConnectError as exc:
        raise ToolsFetchError("Upstream MCP server unreachable") from exc
    except httpx.TimeoutException as exc:
        raise ToolsFetchError("Upstream MCP server timed out") from exc

    if response.status_code >= 400:
        logger.warning(
            "tools/list request returned error",
            url=installation.url,
            status_code=response.status_code,
            body=response.text[:500],
        )
        raise ToolsFetchError(f"Upstream returned status {response.status_code}")

    try:
        payload = response.json()
    except ValueError as exc:
        raise ToolsFetchError("Upstream tools/list response was not JSON") from exc

    if isinstance(payload, dict) and payload.get("error"):
        raise ToolsFetchError(f"Upstream tools/list returned error: {payload['error']}")

    result = (payload or {}).get("result") if isinstance(payload, dict) else None
    tools = (result or {}).get("tools") if isinstance(result, dict) else None
    if not isinstance(tools, list):
        raise ToolsFetchError("tools/list response missing 'result.tools' array")

    return [t for t in tools if isinstance(t, dict) and t.get("name")]


def sync_installation_tools(installation: MCPServerInstallation) -> list[MCPServerInstallationTool]:
    """Upsert tool rows for an installation against the latest upstream ``tools/list``.

    - New tools are inserted with ``approval_state="needs_approval"`` (explicit opt-in).
    - Existing tools keep their approval state; name/description/schema/last_seen_at are updated.
    - Tools that disappear upstream get ``removed_at`` set (approval state preserved for later).
    - Tools that reappear get ``removed_at`` cleared.
    """
    upstream_tools = fetch_upstream_tools(installation)
    now = timezone.now()

    existing_by_name = {t.tool_name: t for t in installation.tools.all()}
    seen_names: set[str] = set()

    for tool in upstream_tools:
        tool_name = tool["name"]
        seen_names.add(tool_name)
        display_name = tool.get("title") or tool.get("displayName") or ""
        description = tool.get("description") or ""
        input_schema = tool.get("inputSchema") or {}

        row = existing_by_name.get(tool_name)
        if row is None:
            MCPServerInstallationTool.objects.create(
                installation=installation,
                tool_name=tool_name,
                display_name=display_name,
                description=description,
                input_schema=input_schema,
                # New tools default to needs_approval so adoption stays explicit.
                approval_state="needs_approval",
                last_seen_at=now,
                removed_at=None,
            )
        else:
            row.display_name = display_name
            row.description = description
            row.input_schema = input_schema
            row.last_seen_at = now
            # A previously-removed tool reappeared; preserve approval_state but clear the flag.
            row.removed_at = None
            row.save(
                update_fields=[
                    "display_name",
                    "description",
                    "input_schema",
                    "last_seen_at",
                    "removed_at",
                    "updated_at",
                ]
            )

    # Mark anything we didn't see as removed; keep their approval_state intact.
    for tool_name, row in existing_by_name.items():
        if tool_name in seen_names:
            continue
        if row.removed_at is not None:
            continue
        row.removed_at = now
        row.save(update_fields=["removed_at", "updated_at"])

    return list(installation.tools.all())
