from django.db import migrations

# The curated set of MCP servers we previously hard-coded in
# `products/mcp_store/backend/models.py::RECOMMENDED_SERVERS`. We seed these
# as inactive templates and re-point any matching installations at them; an
# operator fills in real OAuth client credentials via Django admin and
# flips `is_active=True` to open the template up for new installs.
CURATED_TEMPLATES = [
    {
        "name": "Attio",
        "url": "https://mcp.attio.com/mcp",
        "description": "Manage Attio CRM contacts, companies, and deals.",
        "auth_type": "oauth",
    },
    {
        "name": "Canva",
        "url": "https://mcp.canva.com/mcp",
        "description": "Create, edit, and manage Canva designs and assets.",
        "auth_type": "oauth",
    },
    {
        "name": "Atlassian",
        "url": "https://mcp.atlassian.com/v1/mcp",
        "description": "Integrate with Atlassian products like Jira and Confluence.",
        "auth_type": "oauth",
    },
    {
        "name": "Linear",
        "url": "https://mcp.linear.app/mcp",
        "description": "Manage Linear issues, projects, and teams.",
        "auth_type": "oauth",
    },
    {
        "name": "Monday",
        "url": "https://mcp.monday.com/mcp",
        "description": "Manage Monday.com boards, items, and workflows.",
        "auth_type": "oauth",
    },
    {
        "name": "Notion",
        "url": "https://mcp.notion.com/mcp",
        "description": "Search and manage Notion pages, databases, and knowledge base content.",
        "auth_type": "oauth",
    },
]


def seed_templates_and_backfill_installations(apps, schema_editor):
    MCPServerTemplate = apps.get_model("mcp_store", "MCPServerTemplate")
    MCPServerInstallation = apps.get_model("mcp_store", "MCPServerInstallation")

    templates_by_url: dict[str, object] = {}
    for template_def in CURATED_TEMPLATES:
        template, _ = MCPServerTemplate.objects.get_or_create(
            url=template_def["url"],
            defaults={
                "name": template_def["name"],
                "description": template_def["description"],
                "auth_type": template_def["auth_type"],
                "icon_key": template_def["name"],
                "is_active": False,  # Activated after an operator fills in client credentials.
            },
        )
        templates_by_url[template.url] = template

    # For each existing installation, either re-point it at its curated template
    # (and force a reconnect so it stops using the shared DCR client) or migrate
    # the shared server's creds onto the installation itself.
    curated_urls = set(templates_by_url.keys())
    for installation in MCPServerInstallation.objects.select_related("server").iterator():
        sensitive = dict(installation.sensitive_configuration or {})

        if installation.url in curated_urls:
            template = templates_by_url[installation.url]
            installation.template = template
            # Clean cutover: force the user to reconnect through the shared template
            # client on next use. Their old tokens keep working until they expire;
            # at that point the refresh flips to template creds.
            if installation.auth_type == "oauth":
                sensitive["needs_reauth"] = True
            installation.sensitive_configuration = sensitive
            installation.save(update_fields=["template", "sensitive_configuration", "updated_at"])
            continue

        # Truly custom install — copy the old MCPServer's creds onto the installation
        # so each user ends up with their own per-installation DCR state.
        legacy_server = installation.server
        if legacy_server is None:
            continue
        legacy_metadata = legacy_server.oauth_metadata or {}
        legacy_client_id = legacy_server.oauth_client_id or ""

        if legacy_metadata and not installation.oauth_metadata:
            installation.oauth_metadata = dict(legacy_metadata)
        if legacy_server.url and not installation.oauth_issuer_url:
            installation.oauth_issuer_url = legacy_server.url
        if legacy_client_id:
            sensitive.setdefault("dcr_client_id", legacy_client_id)
            sensitive.setdefault("dcr_is_user_provided", False)

        installation.sensitive_configuration = sensitive
        installation.save(
            update_fields=[
                "oauth_issuer_url",
                "oauth_metadata",
                "sensitive_configuration",
                "updated_at",
            ]
        )


def reverse_noop(apps, schema_editor):
    # Data migration is one-way: we don't attempt to restore the pre-template
    # state because backfilled installations already own their creds now.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("mcp_store", "0006_mcpservertemplate_installation_fields_and_tools"),
    ]

    operations = [
        migrations.RunPython(
            seed_templates_and_backfill_installations,
            reverse_code=reverse_noop,
        ),
        # Phase 1: drop the legacy `server` FKs from Django's state only. The
        # DB columns stay (server_id on both tables) so the previous deploy
        # — which still has the field in its ORM — continues to work during
        # the rolling deploy. Phase 2 (migration 0008, follow-up PR) DROPs
        # the columns and the mcp_store_mcpserver table entirely.
        #
        # The columns are already nullable (declared null=True since 0006),
        # so new inserts from the post-this-migration code path work without
        # a DEFAULT.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(
                    model_name="mcpserverinstallation",
                    name="server",
                ),
                migrations.RemoveField(
                    model_name="mcpoauthstate",
                    name="server",
                ),
            ],
            database_operations=[],
        ),
    ]
