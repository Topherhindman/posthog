import { actions, afterMount, beforeUnmount, connect, kea, key, listeners, path, props, reducers, selectors } from 'kea'
import { forms } from 'kea-forms'
import { loaders } from 'kea-loaders'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'

import api from 'lib/api'
import { FEATURE_FLAGS } from 'lib/constants'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { objectsEqual } from 'lib/utils'
import { availableSourcesDataLogic } from 'scenes/data-warehouse/new/availableSourcesDataLogic'
import {
    SSH_FIELD,
    buildKeaFormDefaultFromSourceDetails,
    getErrorsForFields,
} from 'scenes/data-warehouse/new/sourceWizardLogic'

import { SourceConfig, SourceFieldConfig } from '~/queries/schema/schema-general'
import {
    ExternalDataJob,
    ExternalDataJobStatus,
    ExternalDataSchemaStatus,
    ExternalDataSource,
    ExternalDataSourceSchema,
} from '~/types'

import { externalDataSourcesLogic } from '../../externalDataSourcesLogic'
import { dataWarehouseSourceSceneLogic } from '../DataWarehouseSourceScene'
import type { dataWarehouseSourceSettingsLogicType } from './dataWarehouseSourceSettingsLogicType'

export interface DataWarehouseSourceSettingsLogicProps {
    id: string
    availableSources: Record<string, SourceConfig>
}

const REFRESH_INTERVAL = 5000
const SCHEMA_UPDATE_DEBOUNCE_MS = 1000

interface PendingSchemaUpdate {
    revision: number
    schema: ExternalDataSourceSchema
}

interface SchemaUpdateCache {
    pendingSchemaUpdates?: Record<string, PendingSchemaUpdate>
    inFlightSchemaUpdates?: Record<string, PendingSchemaUpdate>
    schemaUpdateRevisions?: Record<string, number>
    schemaUpdateTimers?: Record<string, ReturnType<typeof setTimeout>>
    reapplyingOptimisticSource?: boolean
}

function applySchemaToSource(
    source: ExternalDataSource | null,
    schema: ExternalDataSourceSchema
): ExternalDataSource | null {
    if (!source) {
        return source
    }

    const clonedSource = JSON.parse(JSON.stringify(source)) as ExternalDataSource
    const schemaIndex = clonedSource.schemas.findIndex((item) => item.id === schema.id)

    if (schemaIndex === -1) {
        return source
    }

    clonedSource.schemas[schemaIndex] = schema
    return clonedSource
}

function applyPendingSchemaUpdatesToSource(
    source: ExternalDataSource | null,
    pendingSchemaUpdates: Record<string, PendingSchemaUpdate>
): ExternalDataSource | null {
    if (!source) {
        return source
    }

    return Object.values(pendingSchemaUpdates).reduce<ExternalDataSource | null>(
        (currentSource, pendingUpdate) => applySchemaToSource(currentSource, pendingUpdate.schema),
        source
    )
}

function getSchemaUpdateCache(cache: SchemaUpdateCache): Required<SchemaUpdateCache> {
    cache.pendingSchemaUpdates ??= {}
    cache.inFlightSchemaUpdates ??= {}
    cache.schemaUpdateRevisions ??= {}
    cache.schemaUpdateTimers ??= {}
    cache.reapplyingOptimisticSource ??= false

    return cache as Required<SchemaUpdateCache>
}

function getOptimisticSchemaUpdates(cache: Required<SchemaUpdateCache>): Record<string, PendingSchemaUpdate> {
    return {
        ...cache.inFlightSchemaUpdates,
        ...cache.pendingSchemaUpdates,
    }
}

function hasOptimisticSchemaChanges(
    source: ExternalDataSource | null,
    optimisticSchemaUpdates: Record<string, PendingSchemaUpdate>
): boolean {
    if (!source) {
        return false
    }

    return Object.values(optimisticSchemaUpdates).some(({ schema }) => {
        const currentSchema = source.schemas.find((item) => item.id === schema.id)
        return !!currentSchema && !objectsEqual(currentSchema, schema)
    })
}

const isSensitiveCredentialField = (field: SourceFieldConfig): boolean => {
    return field.type === 'password' || field.name === 'private_key'
}

const removeEmptySensitiveValues = (fields: SourceFieldConfig[], valueObj: Record<string, any>): void => {
    for (const field of fields) {
        if (field.type === 'switch-group') {
            const groupValue = valueObj[field.name]
            if (groupValue && typeof groupValue === 'object') {
                removeEmptySensitiveValues(field.fields, groupValue)
            }
            continue
        }

        if (field.type === 'select') {
            const hasOptionFields = !!field.options.filter((option) => (option.fields?.length ?? 0) > 0).length
            if (!hasOptionFields) {
                continue
            }
            const selectValue = valueObj[field.name]
            if (selectValue && typeof selectValue === 'object') {
                const selection = selectValue.selection
                const selectedOptionFields = field.options.find((option) => option.value === selection)?.fields ?? []
                removeEmptySensitiveValues(selectedOptionFields, selectValue)
            }
            continue
        }

        if (field.type === 'ssh-tunnel') {
            const tunnelValue = valueObj[field.name]
            if (tunnelValue && typeof tunnelValue === 'object') {
                removeEmptySensitiveValues(SSH_FIELD.fields, tunnelValue)
            }
            continue
        }

        if (isSensitiveCredentialField(field) && valueObj[field.name] === '') {
            delete valueObj[field.name]
        }
    }
}

export const dataWarehouseSourceSettingsLogic = kea<dataWarehouseSourceSettingsLogicType>([
    path(['scenes', 'data-warehouse', 'settings', 'source', 'dataWarehouseSourceSettingsLogic']),
    props({} as DataWarehouseSourceSettingsLogicProps),
    key(({ id }) => id),
    connect(() => ({
        values: [availableSourcesDataLogic, ['availableSources']],
        actions: [externalDataSourcesLogic, ['updateSource']],
    })),
    actions({
        setSourceId: (id: string) => ({ id }),
        reloadSchema: (schema: ExternalDataSourceSchema) => ({ schema }),
        resyncSchema: (schema: ExternalDataSourceSchema) => ({ schema }),
        cancelSchema: (schema: ExternalDataSourceSchema) => ({ schema }),
        deleteTable: (schema: ExternalDataSourceSchema) => ({ schema }),
        setCanLoadMoreJobs: (canLoadMoreJobs: boolean) => ({ canLoadMoreJobs }),
        setIsProjectTime: (isProjectTime: boolean) => ({ isProjectTime }),
        setSelectedSchemas: (schemaNames: string[]) => ({ schemaNames }),
        setShowEnabledSchemasOnly: (showEnabledSchemasOnly: boolean) => ({ showEnabledSchemasOnly }),
        setSchemaNameFilter: (schemaNameFilter: string) => ({ schemaNameFilter }),
        syncNow: true,
        setSyncingNow: (syncing: boolean) => ({ syncing }),
        refreshSchemas: true,
        setRefreshingSchemas: (refreshing: boolean) => ({ refreshing }),
        updateSchema: (schema: ExternalDataSourceSchema) => schema,
        updateSchemaSuccess: (source: ExternalDataSource | null, payload?: ExternalDataSourceSchema) => ({
            source,
            payload,
        }),
        updateSchemaFailure: (error: string, errorObject?: any) => ({ error, errorObject }),
    }),
    loaders(({ actions, values }) => ({
        source: [
            null as ExternalDataSource | null,
            {
                loadSource: async () => {
                    return await api.externalDataSources.get(values.sourceId)
                },
            },
        ],
        jobs: [
            [] as ExternalDataJob[],
            {
                loadJobs: async () => {
                    const schemas = values.selectedSchemas.length > 0 ? values.selectedSchemas : undefined

                    if (values.jobs.length === 0) {
                        return await api.externalDataSources.jobs(values.sourceId, null, null, schemas)
                    }

                    // Re-fetch recent jobs without an `after` filter to get updated statuses.
                    // The API returns up to 50 jobs sorted by created_at desc, so this
                    // will refresh the status of recent jobs (e.g. Running -> Completed).
                    const freshJobs = await api.externalDataSources.jobs(values.sourceId, null, null, schemas)

                    // Merge fresh jobs with existing jobs, preferring the fresh data
                    const jobsById = new Map(values.jobs.map((job) => [job.id, job]))
                    for (const job of freshJobs) {
                        jobsById.set(job.id, job)
                    }

                    // Sort by created_at descending (newest first)
                    return Array.from(jobsById.values()).sort(
                        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    )
                },
                loadMoreJobs: async () => {
                    const schemas = values.selectedSchemas.length > 0 ? values.selectedSchemas : undefined
                    const hasJobs = values.jobs.length > 0
                    if (hasJobs) {
                        const lastJobCreatedAt = values.jobs[values.jobs.length - 1].created_at
                        const oldJobs = await api.externalDataSources.jobs(
                            values.sourceId,
                            lastJobCreatedAt,
                            null,
                            schemas
                        )

                        if (oldJobs.length === 0) {
                            actions.setCanLoadMoreJobs(false)
                            return values.jobs
                        }

                        return [...values.jobs, ...oldJobs]
                    }

                    return values.jobs
                },
            },
        ],
    })),
    reducers(({ props }) => ({
        sourceId: [
            props.id,
            {
                setSourceId: (_, { id }) => id,
            },
        ],
        canLoadMoreJobs: [
            true as boolean,
            {
                setCanLoadMoreJobs: (_, { canLoadMoreJobs }) => canLoadMoreJobs,
                setSourceId: () => true,
            },
        ],
        isProjectTime: [
            false as boolean,
            {
                setIsProjectTime: (_, { isProjectTime }) => isProjectTime,
            },
        ],
        selectedSchemas: [
            [] as string[],
            {
                setSelectedSchemas: (_, { schemaNames }) => schemaNames,
            },
        ],
        showEnabledSchemasOnly: [
            false as boolean,
            { persist: true },
            {
                setShowEnabledSchemasOnly: (_, { showEnabledSchemasOnly }) => showEnabledSchemasOnly,
            },
        ],
        schemaNameFilter: [
            '' as string,
            {
                setSchemaNameFilter: (_, { schemaNameFilter }) => schemaNameFilter,
            },
        ],
        syncingNow: [
            false as boolean,
            {
                setSyncingNow: (_, { syncing }) => syncing,
                syncNow: () => true,
            },
        ],
        refreshingSchemas: [
            false as boolean,
            {
                setRefreshingSchemas: (_, { refreshing }) => refreshing,
                refreshSchemas: () => true,
            },
        ],
        sourceConfigLoading: [
            false as boolean,
            {
                submitSourceConfigRequest: () => true,
                submitSourceConfigSuccess: () => false,
                submitSourceConfigFailure: () => false,
            },
        ],
    })),
    selectors({
        sourceFieldConfig: [
            (s) => [s.source, s.availableSources],
            (source, availableSources) => {
                if (!source || !availableSources) {
                    return null
                }

                return availableSources[source.source_type]
            },
        ],
        filteredSchemas: [
            (s) => [s.source, s.showEnabledSchemasOnly, s.schemaNameFilter],
            (source, showEnabledSchemasOnly, schemaNameFilter): ExternalDataSourceSchema[] => {
                if (!source?.schemas) {
                    return []
                }
                let schemas = source.schemas
                if (showEnabledSchemasOnly) {
                    schemas = schemas.filter((schema) => schema.should_sync)
                }
                if (schemaNameFilter) {
                    const filter = schemaNameFilter.toLowerCase()
                    schemas = schemas.filter((schema) => (schema.label ?? schema.name).toLowerCase().includes(filter))
                }
                return schemas
            },
        ],
    }),
    forms(({ values, actions, props }) => ({
        sourceConfig: {
            defaults: buildKeaFormDefaultFromSourceDetails(props.availableSources),
            errors: (sourceValues) => {
                return getErrorsForFields(values.sourceFieldConfig?.fields ?? [], sourceValues as any, {
                    allowBlankSensitiveFields: true,
                })
            },
            submit: async ({ payload = {}, description, prefix, access_method }) => {
                const sanitizedPayload = JSON.parse(JSON.stringify(payload)) as Record<string, any>
                if (values.sourceFieldConfig?.fields) {
                    removeEmptySensitiveValues(values.sourceFieldConfig.fields, sanitizedPayload)
                }

                const newJobInputs = {
                    ...values.source?.job_inputs,
                    ...sanitizedPayload,
                }

                // Handle file uploads
                const sourceFieldConfig = values.sourceFieldConfig
                if (sourceFieldConfig?.fields) {
                    for (const field of sourceFieldConfig.fields) {
                        if (field.type === 'file-upload' && sanitizedPayload[field.name]) {
                            try {
                                // Assumes we're loading a JSON file
                                const loadedFile: string = await new Promise((resolve, reject) => {
                                    const fileReader = new FileReader()
                                    fileReader.onload = (e) => resolve(e.target?.result as string)
                                    fileReader.onerror = (e) => reject(e)
                                    fileReader.readAsText(sanitizedPayload[field.name][0])
                                })
                                newJobInputs[field.name] = JSON.parse(loadedFile)
                            } catch {
                                lemonToast.error('File is not valid')
                                return
                            }
                        }
                    }
                }

                try {
                    await externalDataSourcesLogic.asyncActions.updateSource({
                        ...values.source!,
                        job_inputs: newJobInputs,
                        prefix: prefix !== undefined ? prefix : values.source?.prefix,
                        access_method: access_method !== undefined ? access_method : values.source?.access_method,
                        description: description !== '' ? description : (values.source?.description ?? null),
                    })
                    actions.loadSource()
                    lemonToast.success('Source updated')
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error('Cant update source at this time')
                    }
                }
            },
        },
    })),
    listeners(({ values, actions, props, cache }) => {
        const schemaUpdateCache = getSchemaUpdateCache(cache)

        const scheduleSchemaUpdateFlush = (schemaId: string): void => {
            const existingTimer = schemaUpdateCache.schemaUpdateTimers[schemaId]
            if (existingTimer) {
                clearTimeout(existingTimer)
            }

            schemaUpdateCache.schemaUpdateTimers[schemaId] = setTimeout(() => {
                delete schemaUpdateCache.schemaUpdateTimers[schemaId]

                if (schemaUpdateCache.inFlightSchemaUpdates[schemaId]) {
                    scheduleSchemaUpdateFlush(schemaId)
                    return
                }

                const pendingUpdate = schemaUpdateCache.pendingSchemaUpdates[schemaId]
                if (!pendingUpdate) {
                    return
                }

                delete schemaUpdateCache.pendingSchemaUpdates[schemaId]
                schemaUpdateCache.inFlightSchemaUpdates[schemaId] = pendingUpdate

                void (async () => {
                    try {
                        const updatedSchema = await api.externalDataSchemas.update(schemaId, pendingUpdate.schema)
                        const latestPendingUpdate = schemaUpdateCache.pendingSchemaUpdates[schemaId]

                        delete schemaUpdateCache.inFlightSchemaUpdates[schemaId]
                        actions.updateSchemaSuccess(values.source, updatedSchema)

                        if (latestPendingUpdate && latestPendingUpdate.revision > pendingUpdate.revision) {
                            scheduleSchemaUpdateFlush(schemaId)
                            return
                        }

                        const nextSource = applySchemaToSource(values.source, updatedSchema)
                        if (nextSource) {
                            actions.loadSourceSuccess(nextSource)
                        }
                    } catch (error: any) {
                        delete schemaUpdateCache.inFlightSchemaUpdates[schemaId]

                        const latestPendingUpdate = schemaUpdateCache.pendingSchemaUpdates[schemaId]
                        if (latestPendingUpdate && latestPendingUpdate.revision > pendingUpdate.revision) {
                            scheduleSchemaUpdateFlush(schemaId)
                            return
                        }

                        actions.updateSchemaFailure(error?.message || "Can't update schema at this time", error)
                        actions.loadSource()
                        lemonToast.error(error?.message || "Can't update schema at this time")
                    }
                })()
            }, SCHEMA_UPDATE_DEBOUNCE_MS)
        }

        return {
            updateSchema: (schema) => {
                const nextRevision = (schemaUpdateCache.schemaUpdateRevisions[schema.id] ?? 0) + 1

                schemaUpdateCache.schemaUpdateRevisions[schema.id] = nextRevision
                schemaUpdateCache.pendingSchemaUpdates[schema.id] = { schema, revision: nextRevision }

                const optimisticSource = applyPendingSchemaUpdatesToSource(
                    values.source,
                    getOptimisticSchemaUpdates(schemaUpdateCache)
                )
                if (optimisticSource) {
                    schemaUpdateCache.reapplyingOptimisticSource = true
                    actions.loadSourceSuccess(optimisticSource)
                }

                scheduleSchemaUpdateFlush(schema.id)
            },
            loadSourceSuccess: () => {
                const optimisticSchemaUpdates = getOptimisticSchemaUpdates(schemaUpdateCache)

                if (schemaUpdateCache.reapplyingOptimisticSource) {
                    schemaUpdateCache.reapplyingOptimisticSource = false
                } else if (hasOptimisticSchemaChanges(values.source, optimisticSchemaUpdates)) {
                    const optimisticSource = applyPendingSchemaUpdatesToSource(values.source, optimisticSchemaUpdates)
                    if (optimisticSource) {
                        schemaUpdateCache.reapplyingOptimisticSource = true
                        actions.loadSourceSuccess(optimisticSource)
                        return
                    }
                }

                const isDirectQueryEnabled =
                    !!featureFlagLogic.values.featureFlags[FEATURE_FLAGS.DWH_POSTGRES_DIRECT_QUERY]
                const breadcrumbName =
                    isDirectQueryEnabled && values.source?.access_method === 'direct'
                        ? values.source?.prefix || values.source?.source_type || 'Source'
                        : values.source?.source_type || 'Source'
                cache.disposables.add(() => {
                    const timerId = setTimeout(() => {
                        actions.loadSource()
                    }, REFRESH_INTERVAL)
                    return () => clearTimeout(timerId)
                }, 'sourceRefreshTimeout')

                const mountedSceneLogic =
                    dataWarehouseSourceSceneLogic.findMounted({ id: props.id }) ??
                    dataWarehouseSourceSceneLogic.findMounted({ id: `managed-${props.id}` })

                mountedSceneLogic?.actions.setBreadcrumbName(breadcrumbName)
            },
            loadSourceFailure: () => {
                cache.disposables.add(() => {
                    const timerId = setTimeout(() => {
                        actions.loadSource()
                    }, REFRESH_INTERVAL)
                    return () => clearTimeout(timerId)
                }, 'sourceRefreshTimeout')
            },
            refreshSchemas: async () => {
                try {
                    const { added = 0, deleted = 0 } = await api.externalDataSources.refreshSchemas(values.sourceId)
                    actions.loadSource()
                    posthog.capture('schemas refreshed', {
                        sourceType: values.source?.source_type,
                        added,
                        deleted,
                    })
                    const parts = ['Schemas refreshed']
                    if (added > 0 || deleted > 0) {
                        parts.push(
                            [added > 0 ? `${added} added` : null, deleted > 0 ? `${deleted} deleted` : null]
                                .filter(Boolean)
                                .join(' / ')
                        )
                    }
                    lemonToast.success(parts.join(', '))
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error("Can't refresh schemas at this time")
                    }
                } finally {
                    actions.setRefreshingSchemas(false)
                }
            },
            setSelectedSchemas: () => {
                // Reset jobs so loadJobs fetches fresh data for the new filter
                // instead of merging with stale results from a different selection
                actions.loadJobsSuccess([])
                actions.setCanLoadMoreJobs(true)
                actions.loadJobs()
            },
            loadJobsSuccess: () => {
                cache.disposables.add(() => {
                    const timerId = setTimeout(() => {
                        actions.loadJobs()
                    }, REFRESH_INTERVAL)
                    return () => clearTimeout(timerId)
                }, 'jobsRefreshTimeout')
            },
            loadJobsFailure: () => {
                cache.disposables.add(() => {
                    const timerId = setTimeout(() => {
                        actions.loadJobs()
                    }, REFRESH_INTERVAL)
                    return () => clearTimeout(timerId)
                }, 'jobsRefreshTimeout')
            },
            syncNow: async () => {
                try {
                    await api.externalDataSources.reload(values.sourceId)
                    actions.loadSource()
                    actions.loadJobs()
                    lemonToast.success('Sync started')
                    posthog.capture('sync now triggered', { sourceType: values.source?.source_type })
                } catch (e: any) {
                    lemonToast.error(e.message || "Can't start sync at this time")
                } finally {
                    actions.setSyncingNow(false)
                }
            },
            reloadSchema: async ({ schema }) => {
                // Optimistic UI updates before sending updates to the backend
                const clonedSource = JSON.parse(JSON.stringify(values.source)) as ExternalDataSource
                const schemaIndex = clonedSource.schemas.findIndex((n) => n.id === schema.id)
                clonedSource.status = ExternalDataJobStatus.Running
                clonedSource.schemas[schemaIndex].status = ExternalDataSchemaStatus.Running

                actions.loadSourceSuccess(clonedSource)

                try {
                    await api.externalDataSchemas.reload(schema.id)

                    posthog.capture('schema reloaded', { sourceType: clonedSource.source_type })
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error('Cant reload schema at this time')
                    }
                }
            },
            resyncSchema: async ({ schema }) => {
                // Optimistic UI updates before sending updates to the backend
                const clonedSource = JSON.parse(JSON.stringify(values.source)) as ExternalDataSource
                const schemaIndex = clonedSource.schemas.findIndex((n) => n.id === schema.id)
                clonedSource.status = ExternalDataJobStatus.Running
                clonedSource.schemas[schemaIndex].status = ExternalDataSchemaStatus.Running

                actions.loadSourceSuccess(clonedSource)

                try {
                    await api.externalDataSchemas.resync(schema.id)

                    posthog.capture('schema resynced', { sourceType: clonedSource.source_type })
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error('Cant refresh schema at this time')
                    }
                }
            },
            cancelSchema: async ({ schema }) => {
                try {
                    await api.externalDataSchemas.cancel(schema.id)

                    actions.loadSource()
                    posthog.capture('schema sync cancelled', { sourceType: values.source?.source_type })
                    lemonToast.success('Sync cancelled')
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error("Can't cancel sync at this time")
                    }
                }
            },
            deleteTable: async ({ schema }) => {
                // Optimistic UI updates before sending updates to the backend
                const clonedSource = JSON.parse(JSON.stringify(values.source)) as ExternalDataSource
                const schemaIndex = clonedSource.schemas.findIndex((n) => n.id === schema.id)
                if (schemaIndex === -1) {
                    lemonToast.error('Schema not found')
                    return
                }
                clonedSource.schemas[schemaIndex].table = undefined
                clonedSource.schemas[schemaIndex].status = undefined
                clonedSource.schemas[schemaIndex].last_synced_at = undefined
                actions.loadSourceSuccess(clonedSource)

                try {
                    await api.externalDataSchemas.delete_data(schema.id)

                    posthog.capture('schema data deleted', { sourceType: clonedSource.source_type })
                    lemonToast.success(`Data for ${schema.label ?? schema.name} has been deleted`)
                } catch (e: any) {
                    if (e.message) {
                        lemonToast.error(e.message)
                    } else {
                        lemonToast.error("Can't delete data at this time")
                    }
                }
            },
        }
    }),
    afterMount(({ actions }) => {
        actions.loadSource()
        actions.loadJobs()
    }),

    beforeUnmount(({ cache }) => {
        const schemaUpdateCache = getSchemaUpdateCache(cache)

        Object.values(schemaUpdateCache.schemaUpdateTimers).forEach(clearTimeout)
    }),
])
