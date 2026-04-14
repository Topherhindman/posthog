import { expectLogic } from 'kea-test-utils'

import api from 'lib/api'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'

import { initKeaTests } from '~/test/init'
import { ExternalDataSource, ExternalDataSourceSchema } from '~/types'

import { dataWarehouseSourceSettingsLogic } from './dataWarehouseSourceSettingsLogic'

jest.mock('lib/api')

const makeSchema = (overrides: Partial<ExternalDataSourceSchema> = {}): ExternalDataSourceSchema => ({
    id: 'schema-1',
    name: 'public.events',
    label: null,
    should_sync: false,
    incremental: false,
    sync_type: null,
    sync_time_of_day: null,
    latest_error: null,
    incremental_field: null,
    incremental_field_type: null,
    sync_frequency: '6hour',
    ...overrides,
})

const makeSource = (schemas: ExternalDataSourceSchema[]): ExternalDataSource =>
    ({
        id: 'source-1',
        source_type: 'Postgres',
        prefix: 'warehouse',
        access_method: 'direct',
        schemas,
    }) as ExternalDataSource

describe('dataWarehouseSourceSettingsLogic', () => {
    let logic: ReturnType<typeof dataWarehouseSourceSettingsLogic.build>

    beforeEach(() => {
        initKeaTests()
        featureFlagLogic.mount()

        jest.spyOn(api.externalDataSources, 'wizard').mockResolvedValue({})
        jest.spyOn(api.externalDataSources, 'get').mockResolvedValue(makeSource([makeSchema()]))
        jest.spyOn(api.externalDataSources, 'jobs').mockResolvedValue([])
    })

    afterEach(() => {
        logic?.unmount()
        featureFlagLogic.unmount()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    it('debounces schema saves and only sends the latest queued change', async () => {
        const updateSchemaSpy = jest
            .spyOn(api.externalDataSchemas, 'update')
            .mockImplementation(async (_id, schema) => schema as ExternalDataSourceSchema)

        logic = dataWarehouseSourceSettingsLogic({ id: 'source-1', availableSources: {} })
        logic.mount()

        await expectLogic(logic).toFinishAllListeners()
        jest.useFakeTimers()

        logic.actions.updateSchema(makeSchema({ should_sync: true }))
        logic.actions.updateSchema(makeSchema({ should_sync: false }))

        expect(logic.values.source?.schemas[0].should_sync).toBe(false)
        expect(updateSchemaSpy).not.toHaveBeenCalled()

        await jest.advanceTimersByTimeAsync(1000)

        expect(updateSchemaSpy).toHaveBeenCalledTimes(1)
        expect(updateSchemaSpy).toHaveBeenLastCalledWith('schema-1', expect.objectContaining({ should_sync: false }))
    })

    it('keeps newer queued changes when an older save resolves later', async () => {
        let resolveFirstRequest: ((schema: ExternalDataSourceSchema) => void) | null = null
        const updateSchemaSpy = jest.spyOn(api.externalDataSchemas, 'update').mockImplementation(
            (_id, schema) =>
                new Promise<ExternalDataSourceSchema>((resolve) => {
                    if (!resolveFirstRequest) {
                        resolveFirstRequest = resolve
                        return
                    }

                    resolve(schema as ExternalDataSourceSchema)
                })
        )

        logic = dataWarehouseSourceSettingsLogic({ id: 'source-1', availableSources: {} })
        logic.mount()

        await expectLogic(logic).toFinishAllListeners()
        jest.useFakeTimers()

        logic.actions.updateSchema(makeSchema({ should_sync: true }))
        await jest.advanceTimersByTimeAsync(1000)

        expect(updateSchemaSpy).toHaveBeenCalledTimes(1)
        expect(logic.values.source?.schemas[0].should_sync).toBe(true)

        logic.actions.updateSchema(makeSchema({ should_sync: false }))
        expect(logic.values.source?.schemas[0].should_sync).toBe(false)

        resolveFirstRequest?.(makeSchema({ should_sync: true }))
        await Promise.resolve()

        expect(logic.values.source?.schemas[0].should_sync).toBe(false)

        await jest.advanceTimersByTimeAsync(1000)

        expect(updateSchemaSpy).toHaveBeenCalledTimes(2)
        expect(updateSchemaSpy).toHaveBeenLastCalledWith('schema-1', expect.objectContaining({ should_sync: false }))
        expect(logic.values.source?.schemas[0].should_sync).toBe(false)
    })
})
