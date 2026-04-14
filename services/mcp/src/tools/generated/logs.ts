// AUTO-GENERATED from products/logs/mcp/tools.yaml + OpenAPI — do not edit
import { z } from 'zod'

import type { Schemas } from '@/api/generated'
import {
    LogsAlertsCreateBody,
    LogsAlertsDestroyParams,
    LogsAlertsListQueryParams,
    LogsAlertsPartialUpdateBody,
    LogsAlertsPartialUpdateParams,
    LogsAlertsRetrieveParams,
    LogsAttributesRetrieveQueryParams,
    LogsQueryCreateBody,
    LogsValuesRetrieveQueryParams,
} from '@/generated/logs/api'
import { withPostHogUrl, pickResponseFields, type WithPostHogUrl } from '@/tools/tool-utils'
import type { Context, ToolBase, ZodObjectAny } from '@/tools/types'

const QueryLogsSchema = LogsQueryCreateBody

const queryLogs = (): ToolBase<typeof QueryLogsSchema, unknown> => ({
    name: 'query-logs',
    schema: QueryLogsSchema,
    handler: async (context: Context, params: z.infer<typeof QueryLogsSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const body: Record<string, unknown> = {}
        if (params.query !== undefined) {
            body['query'] = params.query
        }
        const result = await context.api.request<unknown>({
            method: 'POST',
            path: `/api/projects/${projectId}/logs/query/`,
            body,
        })
        const filtered = pickResponseFields(result, ['results']) as typeof result
        return filtered
    },
})

const LogsAttributesListSchema = LogsAttributesRetrieveQueryParams

const logsAttributesList = (): ToolBase<typeof LogsAttributesListSchema, unknown> => ({
    name: 'logs-attributes-list',
    schema: LogsAttributesListSchema,
    handler: async (context: Context, params: z.infer<typeof LogsAttributesListSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const result = await context.api.request<unknown>({
            method: 'GET',
            path: `/api/projects/${projectId}/logs/attributes/`,
            query: {
                attribute_type: params.attribute_type,
                limit: params.limit,
                offset: params.offset,
                search: params.search,
            },
        })
        const filtered = pickResponseFields(result, ['results', 'count']) as typeof result
        return filtered
    },
})

const LogsAttributeValuesListSchema = LogsValuesRetrieveQueryParams

const logsAttributeValuesList = (): ToolBase<typeof LogsAttributeValuesListSchema, unknown> => ({
    name: 'logs-attribute-values-list',
    schema: LogsAttributeValuesListSchema,
    handler: async (context: Context, params: z.infer<typeof LogsAttributeValuesListSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const result = await context.api.request<unknown>({
            method: 'GET',
            path: `/api/projects/${projectId}/logs/values/`,
            query: {
                attribute_type: params.attribute_type,
                key: params.key,
                value: params.value,
            },
        })
        const filtered = pickResponseFields(result, ['results']) as typeof result
        return filtered
    },
})

const LogsAlertsListSchema = LogsAlertsListQueryParams

const logsAlertsList = (): ToolBase<
    typeof LogsAlertsListSchema,
    WithPostHogUrl<Schemas.PaginatedLogsAlertConfigurationList>
> => ({
    name: 'logs-alerts-list',
    schema: LogsAlertsListSchema,
    mcpVersion: 1,
    handler: async (context: Context, params: z.infer<typeof LogsAlertsListSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const result = await context.api.request<Schemas.PaginatedLogsAlertConfigurationList>({
            method: 'GET',
            path: `/api/projects/${projectId}/logs/alerts/`,
            query: {
                limit: params.limit,
                offset: params.offset,
            },
        })
        return await withPostHogUrl(context, result, '/logs')
    },
})

const LogsAlertsCreateSchema = LogsAlertsCreateBody

const logsAlertsCreate = (): ToolBase<typeof LogsAlertsCreateSchema, Schemas.LogsAlertConfiguration> => ({
    name: 'logs-alerts-create',
    schema: LogsAlertsCreateSchema,
    handler: async (context: Context, params: z.infer<typeof LogsAlertsCreateSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const body: Record<string, unknown> = {}
        if (params.name !== undefined) {
            body['name'] = params.name
        }
        if (params.enabled !== undefined) {
            body['enabled'] = params.enabled
        }
        if (params.filters !== undefined) {
            body['filters'] = params.filters
        }
        if (params.threshold_count !== undefined) {
            body['threshold_count'] = params.threshold_count
        }
        if (params.threshold_operator !== undefined) {
            body['threshold_operator'] = params.threshold_operator
        }
        if (params.window_minutes !== undefined) {
            body['window_minutes'] = params.window_minutes
        }
        if (params.evaluation_periods !== undefined) {
            body['evaluation_periods'] = params.evaluation_periods
        }
        if (params.datapoints_to_alarm !== undefined) {
            body['datapoints_to_alarm'] = params.datapoints_to_alarm
        }
        if (params.cooldown_minutes !== undefined) {
            body['cooldown_minutes'] = params.cooldown_minutes
        }
        if (params.snooze_until !== undefined) {
            body['snooze_until'] = params.snooze_until
        }
        const result = await context.api.request<Schemas.LogsAlertConfiguration>({
            method: 'POST',
            path: `/api/projects/${projectId}/logs/alerts/`,
            body,
        })
        return result
    },
})

const LogsAlertsRetrieveSchema = LogsAlertsRetrieveParams.omit({ project_id: true })

const logsAlertsRetrieve = (): ToolBase<typeof LogsAlertsRetrieveSchema, Schemas.LogsAlertConfiguration> => ({
    name: 'logs-alerts-retrieve',
    schema: LogsAlertsRetrieveSchema,
    mcpVersion: 1,
    handler: async (context: Context, params: z.infer<typeof LogsAlertsRetrieveSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const result = await context.api.request<Schemas.LogsAlertConfiguration>({
            method: 'GET',
            path: `/api/projects/${projectId}/logs/alerts/${params.id}/`,
        })
        return result
    },
})

const LogsAlertsPartialUpdateSchema = LogsAlertsPartialUpdateParams.omit({ project_id: true }).extend(
    LogsAlertsPartialUpdateBody.shape
)

const logsAlertsPartialUpdate = (): ToolBase<typeof LogsAlertsPartialUpdateSchema, Schemas.LogsAlertConfiguration> => ({
    name: 'logs-alerts-partial-update',
    schema: LogsAlertsPartialUpdateSchema,
    handler: async (context: Context, params: z.infer<typeof LogsAlertsPartialUpdateSchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const body: Record<string, unknown> = {}
        if (params.name !== undefined) {
            body['name'] = params.name
        }
        if (params.enabled !== undefined) {
            body['enabled'] = params.enabled
        }
        if (params.filters !== undefined) {
            body['filters'] = params.filters
        }
        if (params.threshold_count !== undefined) {
            body['threshold_count'] = params.threshold_count
        }
        if (params.threshold_operator !== undefined) {
            body['threshold_operator'] = params.threshold_operator
        }
        if (params.window_minutes !== undefined) {
            body['window_minutes'] = params.window_minutes
        }
        if (params.evaluation_periods !== undefined) {
            body['evaluation_periods'] = params.evaluation_periods
        }
        if (params.datapoints_to_alarm !== undefined) {
            body['datapoints_to_alarm'] = params.datapoints_to_alarm
        }
        if (params.cooldown_minutes !== undefined) {
            body['cooldown_minutes'] = params.cooldown_minutes
        }
        if (params.snooze_until !== undefined) {
            body['snooze_until'] = params.snooze_until
        }
        const result = await context.api.request<Schemas.LogsAlertConfiguration>({
            method: 'PATCH',
            path: `/api/projects/${projectId}/logs/alerts/${params.id}/`,
            body,
        })
        return result
    },
})

const LogsAlertsDestroySchema = LogsAlertsDestroyParams.omit({ project_id: true })

const logsAlertsDestroy = (): ToolBase<typeof LogsAlertsDestroySchema, unknown> => ({
    name: 'logs-alerts-destroy',
    schema: LogsAlertsDestroySchema,
    handler: async (context: Context, params: z.infer<typeof LogsAlertsDestroySchema>) => {
        const projectId = await context.stateManager.getProjectId()
        const result = await context.api.request<unknown>({
            method: 'DELETE',
            path: `/api/projects/${projectId}/logs/alerts/${params.id}/`,
        })
        return result
    },
})

export const GENERATED_TOOLS: Record<string, () => ToolBase<ZodObjectAny>> = {
    'query-logs': queryLogs,
    'logs-attributes-list': logsAttributesList,
    'logs-attribute-values-list': logsAttributeValuesList,
    'logs-alerts-list': logsAlertsList,
    'logs-alerts-create': logsAlertsCreate,
    'logs-alerts-retrieve': logsAlertsRetrieve,
    'logs-alerts-partial-update': logsAlertsPartialUpdate,
    'logs-alerts-destroy': logsAlertsDestroy,
}
