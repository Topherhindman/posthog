import { useActions, useValues } from 'kea'
import { useEffect, useState } from 'react'

import { IconInfo, IconWarning } from '@posthog/icons'
import { LemonButton, LemonCheckbox, LemonCollapse, LemonModal, LemonTable, LemonTag, Tooltip } from '@posthog/lemon-ui'

import { useFloatingContainer } from 'lib/hooks/useFloatingContainerContext'
import { groupBy, pluralize } from 'lib/utils'
import { SyncTypeLabelMap } from 'scenes/data-warehouse/utils'

import { ExternalDataSourceSyncSchema } from '~/types'

import { sourceWizardLogic } from '../../new/sourceWizardLogic'
import { SyncMethodForm } from './SyncMethodForm'

export function splitDirectQueryTableName(
    table: string,
    fallbackSchema?: string | null
): { schemaName: string; tableName: string } {
    const firstDotIndex = table.indexOf('.')

    if (firstDotIndex === -1) {
        const normalizedFallbackSchema = fallbackSchema?.trim()
        return {
            schemaName: normalizedFallbackSchema || 'Tables',
            tableName: table,
        }
    }

    return {
        schemaName: table.slice(0, firstDotIndex),
        tableName: table.slice(firstDotIndex + 1),
    }
}

export function groupDirectQueryTablesBySchema(
    schemas: ExternalDataSourceSyncSchema[],
    fallbackSchema?: string | null
): { schemaName: string; tables: ExternalDataSourceSyncSchema[] }[] {
    return Object.entries(
        groupBy(schemas, (schema) => splitDirectQueryTableName(schema.table, fallbackSchema).schemaName)
    )
        .sort(([schemaA], [schemaB]) => schemaA.localeCompare(schemaB))
        .map(([schemaName, tables]) => ({ schemaName, tables }))
}

export function getDirectQuerySelectionDescription(selectedSchema?: string | null): string {
    const normalizedSchema = selectedSchema?.trim()

    if (normalizedSchema) {
        return `Query selected Postgres tables from within PostHog. Tables stay in the source database and are not synced into the data warehouse. You can't join data from these tables with other data in the PostHog warehouse. Choose which tables from the "${normalizedSchema}" schema should be queryable.`
    }

    return "Query selected Postgres tables from within PostHog. Tables stay in the source database and are not synced into the data warehouse. You can't join data from these tables with other data in the PostHog warehouse. Enable each schema to choose which tables should be queryable."
}

function getSchemaSelectionState(tables: ExternalDataSourceSyncSchema[]): boolean | 'indeterminate' {
    const enabledCount = tables.filter((table) => table.should_sync).length

    if (enabledCount === 0) {
        return false
    }

    if (enabledCount === tables.length) {
        return true
    }

    return 'indeterminate'
}

export default function SchemaForm(): JSX.Element {
    const containerRef = useFloatingContainer()
    const { toggleSchemaShouldSync, openSyncMethodModal, setDatabaseSchemas, toggleAllTables } =
        useActions(sourceWizardLogic)
    const { databaseSchema, tablesAllToggledOn, suggestedTablesMap, isDirectQueryMode, source } =
        useValues(sourceWizardLogic)
    const groupedDatabaseSchema = groupDirectQueryTablesBySchema(databaseSchema, source.payload.schema)
    const groupedSchemaKeys = groupedDatabaseSchema.map((group) => group.schemaName)
    const groupedSchemaKeysFingerprint = groupedSchemaKeys.join('|')
    const [expandedSchemaKeys, setExpandedSchemaKeys] = useState<string[]>([])

    const onClickCheckbox = (schema: ExternalDataSourceSyncSchema, checked: boolean): void => {
        if (!isDirectQueryMode && schema.sync_type === null) {
            openSyncMethodModal(schema)
            return
        }
        toggleSchemaShouldSync(schema, checked)
    }

    const shouldShowSyncColumns = !isDirectQueryMode

    // scroll to top of container
    useEffect(() => {
        containerRef?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    }, [containerRef])

    useEffect(() => {
        if (!isDirectQueryMode) {
            return
        }

        setExpandedSchemaKeys((currentKeys) => {
            const nextKeys = currentKeys.filter((key) => groupedSchemaKeys.includes(key))

            if (
                nextKeys.length > 0 &&
                nextKeys.length === currentKeys.length &&
                nextKeys.every((key, index) => key === currentKeys[index])
            ) {
                return currentKeys
            }

            if (nextKeys.length > 0) {
                return nextKeys
            }

            return groupedSchemaKeys
        })
    }, [groupedSchemaKeysFingerprint, isDirectQueryMode])

    const toggleSchemaGroup = (schemaName: string, shouldSync: boolean): void => {
        setDatabaseSchemas(
            databaseSchema.map((schema) => ({
                ...schema,
                should_sync:
                    splitDirectQueryTableName(schema.table, source.payload.schema).schemaName === schemaName
                        ? shouldSync
                        : schema.should_sync,
            }))
        )
        setExpandedSchemaKeys((currentKeys) =>
            shouldSync
                ? Array.from(new Set([...currentKeys, schemaName]))
                : currentKeys.filter((key) => key !== schemaName)
        )
    }

    const toggleAllSchemaGroups = (checked: boolean): void => {
        toggleAllTables(checked)
        setExpandedSchemaKeys(checked ? groupedSchemaKeys : [])
    }

    const showRows = databaseSchema.some((schema) => schema.rows != null)

    return (
        <>
            <div className="flex flex-col gap-2">
                <div className="max-h-[60vh] overflow-y-auto">
                    {isDirectQueryMode ? (
                        groupedDatabaseSchema.length > 0 ? (
                            <>
                                <div className="flex items-center justify-between gap-2 px-1 pb-2">
                                    <LemonCheckbox checked={tablesAllToggledOn} onChange={toggleAllSchemaGroups}>
                                        Select all
                                    </LemonCheckbox>
                                    <span className="text-sm text-muted-alt">
                                        {databaseSchema.filter((schema) => schema.should_sync).length} of{' '}
                                        {databaseSchema.length} {pluralize(databaseSchema.length, 'table', 'tables')}{' '}
                                        queryable
                                    </span>
                                </div>
                                <div className="border rounded bg-bg-light">
                                    <LemonCollapse
                                        multiple
                                        embedded
                                        activeKeys={expandedSchemaKeys}
                                        onChange={setExpandedSchemaKeys}
                                        panels={groupedDatabaseSchema.map(({ schemaName, tables }) => {
                                            const selectedTablesCount = tables.filter(
                                                (table) => table.should_sync
                                            ).length

                                            return {
                                                key: schemaName,
                                                header: (
                                                    <div className="flex items-center justify-between gap-3 w-full">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <LemonCheckbox
                                                                checked={getSchemaSelectionState(tables)}
                                                                stopPropagation
                                                                onChange={(checked) =>
                                                                    toggleSchemaGroup(schemaName, checked)
                                                                }
                                                            />
                                                            <span className="font-semibold truncate">{schemaName}</span>
                                                        </div>
                                                        <span className="text-xs text-muted-alt whitespace-nowrap">
                                                            {selectedTablesCount} of {tables.length} tables queryable
                                                        </span>
                                                    </div>
                                                ),
                                                content: (
                                                    <div className="bg-bg-light">
                                                        <div>
                                                            {tables.map((schema) => {
                                                                const isSuggested =
                                                                    suggestedTablesMap[schema.table] !== undefined
                                                                const tooltip =
                                                                    suggestedTablesMap[schema.table] ??
                                                                    'This table is suggested to be enabled for this source'
                                                                const { tableName } = splitDirectQueryTableName(
                                                                    schema.table,
                                                                    source.payload.schema
                                                                )

                                                                return (
                                                                    <div
                                                                        key={schema.table}
                                                                        className={`grid items-center border-b last:border-b-0 px-6 py-1 ${
                                                                            showRows
                                                                                ? 'grid-cols-[auto_minmax(0,1fr)_auto] gap-2'
                                                                                : 'grid-cols-[auto_minmax(0,1fr)] gap-2'
                                                                        }`}
                                                                    >
                                                                        <LemonCheckbox
                                                                            checked={schema.should_sync}
                                                                            onChange={(checked) =>
                                                                                onClickCheckbox(schema, checked)
                                                                            }
                                                                        />
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span
                                                                                className="font-mono cursor-pointer truncate"
                                                                                onClick={() =>
                                                                                    onClickCheckbox(
                                                                                        schema,
                                                                                        !schema.should_sync
                                                                                    )
                                                                                }
                                                                            >
                                                                                {tableName}
                                                                            </span>
                                                                            {schema.description && (
                                                                                <Tooltip title={schema.description}>
                                                                                    <IconInfo className="text-muted-alt text-base shrink-0" />
                                                                                </Tooltip>
                                                                            )}
                                                                            {isSuggested && (
                                                                                <Tooltip
                                                                                    title={tooltip}
                                                                                    placement="top"
                                                                                >
                                                                                    <LemonTag
                                                                                        type="primary"
                                                                                        className="cursor-help shrink-0"
                                                                                    >
                                                                                        Suggested
                                                                                    </LemonTag>
                                                                                </Tooltip>
                                                                            )}
                                                                        </div>
                                                                        {showRows && (
                                                                            <span className="text-sm text-muted-alt text-right">
                                                                                {schema.rows != null
                                                                                    ? schema.rows
                                                                                    : 'Unknown'}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                ),
                                            }
                                        })}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="border rounded px-4 py-8 text-center text-muted-alt">No tables found</div>
                        )
                    ) : (
                        <LemonTable
                            emptyState="No schemas found"
                            dataSource={databaseSchema}
                            columns={[
                                {
                                    title: (
                                        <LemonCheckbox
                                            checked={tablesAllToggledOn}
                                            onChange={(checked) => toggleAllTables(checked)}
                                        />
                                    ),
                                    width: 0,
                                    key: 'enabled',
                                    render: function RenderEnabled(_, schema) {
                                        return (
                                            <LemonCheckbox
                                                checked={schema.should_sync}
                                                onChange={(checked) => onClickCheckbox(schema, checked)}
                                            />
                                        )
                                    },
                                },
                                {
                                    title: 'Table',
                                    key: 'table',
                                    render: function RenderTable(_, schema) {
                                        const isSuggested = suggestedTablesMap[schema.table] !== undefined
                                        const tooltip =
                                            suggestedTablesMap[schema.table] ??
                                            'This table is suggested to be enabled for this source'

                                        return (
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="font-mono cursor-pointer"
                                                    onClick={() => onClickCheckbox(schema, !schema.should_sync)}
                                                >
                                                    {schema.table}
                                                </span>
                                                {schema.description && (
                                                    <Tooltip title={schema.description}>
                                                        <IconInfo className="text-muted-alt text-base" />
                                                    </Tooltip>
                                                )}
                                                {isSuggested && (
                                                    <Tooltip title={tooltip} placement="top">
                                                        <LemonTag type="primary" className="cursor-help">
                                                            Suggested
                                                        </LemonTag>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        )
                                    },
                                },
                                {
                                    title: 'Rows',
                                    key: 'rows',
                                    isHidden: !databaseSchema.some((schema) => schema.rows),
                                    render: function RenderRows(_, schema) {
                                        return schema.rows != null ? schema.rows : 'Unknown'
                                    },
                                },
                                {
                                    key: 'sync_field',
                                    title: 'Sync field',
                                    align: 'right',
                                    tooltip:
                                        'Incremental and append-only refresh methods key on a unique field to determine the most up-to-date data.',
                                    isHidden:
                                        !shouldShowSyncColumns || !databaseSchema.some((schema) => schema.sync_type),
                                    render: function RenderSyncType(_, schema) {
                                        if (isDirectQueryMode) {
                                            return (
                                                <span className="text-xs text-muted-foreground">
                                                    Only selected tables are queryable in direct mode
                                                </span>
                                            )
                                        }
                                        if (!schema.incremental_available && !schema.append_available) {
                                            return (
                                                <span className="text-xs text-muted-foreground">
                                                    Incremental sync not supported
                                                </span>
                                            )
                                        }

                                        if (schema.sync_type === 'webhook') {
                                            return <LemonTag type="success">Webhook</LemonTag>
                                        }

                                        if (
                                            schema.sync_type !== 'full_refresh' &&
                                            schema.sync_type !== null &&
                                            schema.incremental_field
                                        ) {
                                            const field =
                                                schema.incremental_fields.find(
                                                    (f) => f.field == schema.incremental_field
                                                ) ?? null

                                            if (field) {
                                                return (
                                                    <div className="flex items-center justify-end">
                                                        {field.nullable && (
                                                            <Tooltip
                                                                title={`This field is nullable. Any rows where ${field.label} is null will not be synced.`}
                                                            >
                                                                <IconWarning className="mr-1 text-warning text-xl" />
                                                            </Tooltip>
                                                        )}
                                                        <span className="leading-5">{field.label}</span>
                                                        <LemonTag className="ml-2" type="success">
                                                            {field.type}
                                                        </LemonTag>
                                                    </div>
                                                )
                                            }
                                        }

                                        return (
                                            <span className="text-xs text-muted-foreground">
                                                No sync field selected
                                            </span>
                                        )
                                    },
                                },
                                {
                                    key: 'sync_type',
                                    title: 'Sync method',
                                    align: 'right',
                                    isHidden: !shouldShowSyncColumns,
                                    tooltip:
                                        'Full refresh will refresh the full table on every sync, whereas incremental will only sync new and updated rows since the last sync',
                                    render: function RenderSyncType(_, schema) {
                                        if (isDirectQueryMode) {
                                            return (
                                                <span className="text-xs text-muted-foreground">
                                                    Only selected tables are queryable in direct mode
                                                </span>
                                            )
                                        }
                                        if (!schema.sync_type) {
                                            return (
                                                <div className="justify-end flex">
                                                    <LemonButton
                                                        className="my-1"
                                                        type="primary"
                                                        onClick={() => openSyncMethodModal(schema)}
                                                        size="small"
                                                    >
                                                        Configure
                                                    </LemonButton>
                                                </div>
                                            )
                                        }

                                        return (
                                            <div className="justify-end flex">
                                                <LemonButton
                                                    className="my-1"
                                                    size="small"
                                                    type="secondary"
                                                    onClick={() => openSyncMethodModal(schema)}
                                                    disabledReason={
                                                        !schema.incremental_available && !schema.append_available
                                                            ? 'Full refresh is the only supported sync method for this table'
                                                            : undefined
                                                    }
                                                >
                                                    {SyncTypeLabelMap[schema.sync_type]}
                                                </LemonButton>
                                            </div>
                                        )
                                    },
                                },
                            ]}
                        />
                    )}
                </div>
            </div>
            <SyncMethodModal />
        </>
    )
}

const SyncMethodModal = (): JSX.Element => {
    const { cancelSyncMethodModal, updateSchemaSyncType, toggleSchemaShouldSync } = useActions(sourceWizardLogic)
    const { syncMethodModalOpen, currentSyncMethodModalSchema } = useValues(sourceWizardLogic)

    if (!currentSyncMethodModalSchema) {
        return <></>
    }

    return (
        <LemonModal
            title={
                <>
                    Sync method for <span className="font-mono">{currentSyncMethodModalSchema.table}</span>
                </>
            }
            isOpen={syncMethodModalOpen}
            onClose={cancelSyncMethodModal}
        >
            <SyncMethodForm
                schema={currentSyncMethodModalSchema}
                onClose={cancelSyncMethodModal}
                isNewSource
                onSave={(syncType, incrementalField, incrementalFieldType, cdcTableMode) => {
                    if (syncType === 'incremental' || syncType === 'append') {
                        updateSchemaSyncType(
                            currentSyncMethodModalSchema,
                            syncType,
                            incrementalField,
                            incrementalFieldType
                        )
                    } else if (syncType === 'cdc') {
                        updateSchemaSyncType(currentSyncMethodModalSchema, syncType, null, null, cdcTableMode)
                    } else {
                        updateSchemaSyncType(currentSyncMethodModalSchema, syncType ?? null, null, null)
                    }

                    toggleSchemaShouldSync(currentSyncMethodModalSchema, true)
                    cancelSyncMethodModal()
                }}
            />
        </LemonModal>
    )
}
