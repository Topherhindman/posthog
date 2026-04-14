import { groupDirectConnectionTableNodesBySchema } from './queryDatabaseLogic'

describe('queryDatabaseLogic', () => {
    it('groups direct connection tables into schema folders', () => {
        const grouped = groupDirectConnectionTableNodesBySchema(
            [
                {
                    id: 'table-system.query_log',
                    name: 'system.query_log',
                    type: 'node',
                    record: {
                        type: 'table',
                        table: { name: 'system.query_log' },
                    },
                },
                {
                    id: 'table-system.checkpoints',
                    name: 'system.checkpoints',
                    type: 'node',
                    record: {
                        type: 'table',
                        table: { name: 'system.checkpoints' },
                    },
                },
                {
                    id: 'table-public.accounts',
                    name: 'public.accounts',
                    type: 'node',
                    record: {
                        type: 'table',
                        table: { name: 'public.accounts' },
                    },
                },
            ] as any,
            false
        )

        expect(grouped.map((item) => item.name)).toEqual(['public', 'system'])
        expect(grouped[0].children?.map((item) => item.name)).toEqual(['public.accounts'])
        expect(grouped[1].children?.map((item) => item.name)).toEqual(['system.checkpoints', 'system.query_log'])
    })

    it('uses the selected source schema when table names are unqualified', () => {
        const grouped = groupDirectConnectionTableNodesBySchema(
            [
                {
                    id: 'table-accounts',
                    name: 'accounts',
                    type: 'node',
                    record: {
                        type: 'table',
                        table: { name: 'accounts' },
                    },
                },
                {
                    id: 'table-events',
                    name: 'events',
                    type: 'node',
                    record: {
                        type: 'table',
                        table: { name: 'events' },
                    },
                },
            ] as any,
            false,
            'analytics'
        )

        expect(grouped.map((item) => item.name)).toEqual(['analytics'])
        expect(grouped[0].children?.map((item) => item.name)).toEqual(['accounts', 'events'])
    })
})
