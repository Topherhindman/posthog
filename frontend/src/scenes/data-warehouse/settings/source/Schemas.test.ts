import type { ExternalDataSourceSchema } from '~/types'

import { groupDirectQuerySourceSchemasBySchema, splitDirectQuerySchemaName } from './Schemas'

const makeSchema = (name: string): ExternalDataSourceSchema => ({
    id: name,
    name,
    label: null,
    should_sync: true,
    incremental: false,
    sync_type: null,
    sync_time_of_day: null,
    latest_error: null,
    incremental_field: null,
    incremental_field_type: null,
    sync_frequency: '6hour',
})

describe('Schemas', () => {
    it('splits a qualified direct query table name into schema and table names', () => {
        expect(splitDirectQuerySchemaName('public.events')).toEqual({
            schemaName: 'public',
            tableName: 'events',
        })
    })

    it('groups direct query source schemas by schema name', () => {
        expect(
            groupDirectQuerySourceSchemasBySchema([
                makeSchema('analytics.pageviews'),
                makeSchema('public.events'),
                makeSchema('analytics.sessions'),
            ])
        ).toEqual([
            {
                schemaName: 'analytics',
                schemas: [makeSchema('analytics.pageviews'), makeSchema('analytics.sessions')],
            },
            {
                schemaName: 'public',
                schemas: [makeSchema('public.events')],
            },
        ])
    })
})
