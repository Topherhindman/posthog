import uuid

import pytest
from posthog.test.base import APIBaseTest, ClickhouseTestMixin
from unittest.mock import MagicMock, patch

from django.utils import timezone

import httpx

from products.mcp_store.backend.models import MCPServerInstallation, MCPServerInstallationTool
from products.mcp_store.backend.tools import ToolsFetchError, fetch_upstream_tools, sync_installation_tools


class TestFetchUpstreamTools(ClickhouseTestMixin, APIBaseTest):
    def _installation(self, **overrides) -> MCPServerInstallation:
        defaults = {
            "team": self.team,
            "user": self.user,
            "url": f"https://mcp-{uuid.uuid4().hex[:8]}.example.com/mcp",
            "display_name": "Test",
            "auth_type": "api_key",
            "sensitive_configuration": {"api_key": "sk-test"},
        }
        defaults.update(overrides)
        return MCPServerInstallation.objects.create(**defaults)

    @patch("products.mcp_store.backend.tools.is_url_allowed", return_value=(True, None))
    @patch("products.mcp_store.backend.tools.httpx.Client")
    def test_fetch_upstream_tools_parses_result(self, mock_client_cls, _allow):
        installation = self._installation()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [
                    {"name": "alpha", "description": "A", "inputSchema": {"type": "object"}},
                    {"name": "beta", "title": "Beta!", "description": "B"},
                    {"description": "no name"},  # invalid — dropped
                ]
            },
        }
        client = MagicMock()
        client.post.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = client

        tools = fetch_upstream_tools(installation)
        assert [t["name"] for t in tools] == ["alpha", "beta"]
        _, kwargs = client.post.call_args
        assert kwargs["headers"]["Authorization"] == "Bearer sk-test"

    @patch("products.mcp_store.backend.tools.is_url_allowed", return_value=(False, "Private IP"))
    def test_fetch_upstream_tools_raises_on_blocked_url(self, _allow):
        installation = self._installation()
        with pytest.raises(ToolsFetchError, match="URL not allowed"):
            fetch_upstream_tools(installation)

    @patch("products.mcp_store.backend.tools.is_url_allowed", return_value=(True, None))
    @patch("products.mcp_store.backend.tools.httpx.Client")
    def test_fetch_upstream_tools_raises_on_connect_error(self, mock_client_cls, _allow):
        installation = self._installation()
        client = MagicMock()
        client.post.side_effect = httpx.ConnectError("nope")
        mock_client_cls.return_value.__enter__.return_value = client

        with pytest.raises(ToolsFetchError, match="unreachable"):
            fetch_upstream_tools(installation)

    @patch("products.mcp_store.backend.tools.is_url_allowed", return_value=(True, None))
    @patch("products.mcp_store.backend.tools.httpx.Client")
    def test_fetch_upstream_tools_raises_when_result_missing(self, mock_client_cls, _allow):
        installation = self._installation()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"jsonrpc": "2.0", "id": 1, "result": {}}
        client = MagicMock()
        client.post.return_value = mock_response
        mock_client_cls.return_value.__enter__.return_value = client

        with pytest.raises(ToolsFetchError, match="missing 'result.tools'"):
            fetch_upstream_tools(installation)


class TestSyncInstallationTools(ClickhouseTestMixin, APIBaseTest):
    def _installation(self) -> MCPServerInstallation:
        return MCPServerInstallation.objects.create(
            team=self.team,
            user=self.user,
            url=f"https://mcp-{uuid.uuid4().hex[:8]}.example.com/mcp",
            display_name="Test",
            auth_type="api_key",
            sensitive_configuration={"api_key": "sk-test"},
        )

    @patch("products.mcp_store.backend.tools.fetch_upstream_tools")
    def test_new_tools_default_to_needs_approval(self, mock_fetch):
        installation = self._installation()
        mock_fetch.return_value = [{"name": "search", "description": "Search something"}]

        sync_installation_tools(installation)
        tool = installation.tools.get(tool_name="search")
        assert tool.approval_state == "needs_approval"
        assert tool.description == "Search something"
        assert tool.removed_at is None

    @patch("products.mcp_store.backend.tools.fetch_upstream_tools")
    def test_disappeared_tool_marked_removed_state_preserved(self, mock_fetch):
        installation = self._installation()
        mock_fetch.return_value = [{"name": "search"}]
        sync_installation_tools(installation)

        tool = installation.tools.get(tool_name="search")
        tool.approval_state = "approved"
        tool.save(update_fields=["approval_state"])

        mock_fetch.return_value = []  # upstream dropped the tool
        sync_installation_tools(installation)
        tool.refresh_from_db()
        assert tool.removed_at is not None
        # Approval survives a disappearance so a returning tool isn't quietly downgraded.
        assert tool.approval_state == "approved"

    @patch("products.mcp_store.backend.tools.fetch_upstream_tools")
    def test_reappearing_tool_clears_removed_and_keeps_state(self, mock_fetch):
        installation = self._installation()
        # Seed a removed tool with a manually-chosen approval state.
        MCPServerInstallationTool.objects.create(
            installation=installation,
            tool_name="write",
            description="old",
            approval_state="do_not_use",
            last_seen_at=timezone.now(),
            removed_at=timezone.now(),
        )

        mock_fetch.return_value = [{"name": "write", "description": "updated"}]
        sync_installation_tools(installation)

        tool = installation.tools.get(tool_name="write")
        assert tool.removed_at is None
        # Returning tools keep whatever the user set last.
        assert tool.approval_state == "do_not_use"
        assert tool.description == "updated"

    @patch("products.mcp_store.backend.tools.fetch_upstream_tools")
    def test_existing_tool_metadata_updates_but_approval_preserved(self, mock_fetch):
        installation = self._installation()
        MCPServerInstallationTool.objects.create(
            installation=installation,
            tool_name="search",
            description="old description",
            input_schema={"type": "object"},
            approval_state="approved",
            last_seen_at=timezone.now(),
        )

        mock_fetch.return_value = [
            {
                "name": "search",
                "description": "new description",
                "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
            }
        ]
        sync_installation_tools(installation)

        tool = installation.tools.get(tool_name="search")
        assert tool.description == "new description"
        assert "properties" in tool.input_schema
        assert tool.approval_state == "approved"
