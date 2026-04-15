import { env } from 'cloudflare:workers'
import { PostHog } from 'posthog-node'

let _client: PostHog | undefined

export enum AnalyticsEvent {
    MCP_INIT = 'mcp init',
    MCP_PROJECT_SWITCHED = 'mcp project switched',
    MCP_ORGANIZATION_SWITCHED = 'mcp organization switched',
}

export type MCPAnalyticsContext = {
    organizationId?: string
    projectId?: string
    projectUuid?: string
    projectName?: string
}

export const buildMCPAnalyticsGroups = ({
    organizationId,
    projectUuid,
}: MCPAnalyticsContext): Record<string, string> => ({
    ...(organizationId ? { organization: organizationId } : {}),
    ...(projectUuid ? { project: projectUuid } : {}),
})

export const buildMCPGroupProperties = ({
    organizationId,
    projectId,
    projectUuid,
    projectName,
}: MCPAnalyticsContext): Record<string, Record<string, unknown>> => ({
    ...(organizationId
        ? {
              organization: {
                  id: organizationId,
              },
          }
        : {}),
    ...(projectUuid
        ? {
              project: {
                  ...(projectId ? { id: projectId } : {}),
                  uuid: projectUuid,
                  ...(projectName ? { name: projectName } : {}),
                  ...(organizationId ? { organization_id: organizationId } : {}),
              },
          }
        : {}),
})

export const getPostHogClient = (): PostHog => {
    if (!_client) {
        _client = new PostHog(env.POSTHOG_ANALYTICS_API_KEY, {
            disabled: !env.POSTHOG_ANALYTICS_API_KEY || !env.POSTHOG_ANALYTICS_HOST, // Disable if the API key or host is not set
            host: env.POSTHOG_ANALYTICS_HOST,
            flushAt: 1,
            flushInterval: 0,
        })
    }

    return _client
}

export async function isFeatureFlagEnabled(flagKey: string, distinctId: string): Promise<boolean> {
    try {
        const client = getPostHogClient()
        const result = await client.isFeatureEnabled(flagKey, distinctId)
        return result === true
    } catch {
        return false
    }
}
