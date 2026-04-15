import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { env } from 'cloudflare:workers'
import { track } from 'mcpcat'

type MaybePromise<T> = T | Promise<T>

type McpCatResolvedContext = {
    organizationId?: string
    projectId?: string
    projectUuid?: string
    projectName?: string
}

/** Provider interface for resolving user/session identity. */
export type McpCatIdentityProvider = {
    getDistinctId: () => Promise<string>
    getSessionUuid: () => Promise<string | undefined>
    getMcpClientName: () => MaybePromise<string | undefined>
    getMcpClientVersion: () => MaybePromise<string | undefined>
    getMcpProtocolVersion: () => MaybePromise<string | undefined>
    getRegion: () => MaybePromise<string | undefined>
    getResolvedContext: () => MaybePromise<McpCatResolvedContext | undefined>
    getClientUserAgent: () => MaybePromise<string | undefined>
    getVersion: () => MaybePromise<number | undefined>
    getOAuthClientName: () => MaybePromise<string | undefined>
    getReadOnly: () => MaybePromise<boolean | undefined>
    getTransport: () => MaybePromise<string | undefined>
}

export function redactSensitiveInformation(text: string): string {
    return text.replace(/Bearer\s?[\w\-.]+/g, '<redacted>')
}

export async function initMcpCatObservability(server: McpServer, identity: McpCatIdentityProvider): Promise<void> {
    // MCPCat initialization must never block MCP server startup
    // and we don't even need to do anything if the API key or host is not set
    // This is properly set in production where we care about analytics
    const posthogApiKey = env.POSTHOG_ANALYTICS_API_KEY
    const posthogHost = env.POSTHOG_ANALYTICS_HOST
    if (!posthogApiKey || !posthogHost) {
        return
    }

    // For tags, we need to override MCPcat's default $session_id and $ai_session_id with our own
    // PostHog session UUID. $session_id drives Session Replay; $ai_session_id is what LLM Analytics
    // groups traces by — without overriding it, MCPcat's exporter falls back to `mcpcat_<ksuid>`.
    // Compute the distinct ID only once and include with every single event
    const distinctId = await identity.getDistinctId()
    const identifyResult = { userId: distinctId }

    try {
        // If the MCP_CAT_PROJECT_ID is not set, use null. This will disable sending events to MCPcat.
        // For production, we'll set this to the correct project ID.
        track(server, env.MCP_CAT_PROJECT_ID ?? null, {
            enableReportMissing: false,
            enableToolCallContext: false,
            enableTracing: true, // Tracks tools and usage patterns
            identify: async () => identifyResult,
            eventTags: async () => {
                const sessionUuid = await identity.getSessionUuid()
                if (!sessionUuid) {
                    return {}
                }

                return {
                    $session_id: sessionUuid,
                    $ai_session_id: sessionUuid,
                }
            },
            eventProperties: async () => {
                const [
                    mcpVersion,
                    clientUserAgent,
                    mcpClientName,
                    mcpClientVersion,
                    mcpProtocolVersion,
                    mcpRegion,
                    resolvedContext,
                    oauthClientName,
                    readOnly,
                    transport,
                ] = await Promise.all([
                    identity.getVersion(),
                    identity.getClientUserAgent(),
                    identity.getMcpClientName(),
                    identity.getMcpClientVersion(),
                    identity.getMcpProtocolVersion(),
                    identity.getRegion(),
                    identity.getResolvedContext(),
                    identity.getOAuthClientName(),
                    identity.getReadOnly(),
                    identity.getTransport(),
                ])

                const groups = {
                    ...(resolvedContext?.organizationId ? { organization: resolvedContext.organizationId } : {}),
                    ...(resolvedContext?.projectUuid ? { project: resolvedContext.projectUuid } : {}),
                }

                return {
                    ai_product: 'mcp',
                    mcp_version: mcpVersion,
                    client_user_agent: clientUserAgent,
                    mcp_client_name: mcpClientName,
                    mcp_client_version: mcpClientVersion,
                    mcp_protocol_version: mcpProtocolVersion,
                    mcp_region: mcpRegion,
                    organization_id: resolvedContext?.organizationId,
                    project_id: resolvedContext?.projectId,
                    project_uuid: resolvedContext?.projectUuid,
                    project_name: resolvedContext?.projectName,
                    mcp_oauth_client_name: oauthClientName,
                    read_only: readOnly,
                    mcp_transport: transport,
                    ...(Object.keys(groups).length > 0 ? { $groups: groups } : {}),
                }
            },
            redactSensitiveInformation: (text) => Promise.resolve(redactSensitiveInformation(text)),
            exporters: {
                posthog: {
                    type: 'posthog',
                    apiKey: posthogApiKey,
                    host: posthogHost,
                    enableAITracing: true,
                },
            },
        })
    } catch {
        // MCPCat initialization must never block MCP server startup
    }
}
