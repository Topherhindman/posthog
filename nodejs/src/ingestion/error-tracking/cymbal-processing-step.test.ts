import { createTestPluginEvent } from '~/tests/helpers/plugin-event'
import { createTestTeam } from '~/tests/helpers/team'

import { PipelineResultType, isDropResult, isOkResult } from '../pipelines/results'
import { createCymbalProcessingStep } from './cymbal-processing-step'
import { CymbalClient, CymbalEventResult } from './cymbal/client'
import { CymbalResponse } from './cymbal/types'

/** Wrap a CymbalResponse (or null) into a CymbalEventResult for mocking. */
const toResult = (response: CymbalResponse | null): CymbalEventResult => ({
    status: 'success',
    response,
})

describe('createCymbalProcessingStep', () => {
    let mockCymbalClient: jest.Mocked<CymbalClient>
    let step: ReturnType<typeof createCymbalProcessingStep>

    const team = createTestTeam({ id: 123 })

    const createInput = (overrides: Partial<ReturnType<typeof createTestPluginEvent>> = {}) => ({
        event: createTestPluginEvent({
            event: '$exception',
            uuid: 'event-uuid-1',
            distinct_id: 'user-123',
            properties: {
                $exception_list: [{ type: 'Error', value: 'Test error' }],
            },
            ...overrides,
        }),
        team,
    })

    const createResponse = (overrides: Partial<CymbalResponse> = {}): CymbalResponse => ({
        uuid: 'event-uuid-1',
        event: '$exception',
        team_id: 123,
        timestamp: '2024-01-01T00:00:00Z',
        properties: {
            $exception_list: [{ type: 'Error', value: 'Test error' }],
            $exception_fingerprint: 'test-fingerprint',
            $exception_issue_id: 'test-issue-id',
        },
        ...overrides,
    })

    beforeEach(() => {
        mockCymbalClient = {
            processExceptions: jest.fn(),
            healthCheck: jest.fn(),
        } as unknown as jest.Mocked<CymbalClient>
        step = createCymbalProcessingStep(mockCymbalClient)
    })

    it('processes a batch of events through Cymbal', async () => {
        const inputs = [createInput({ uuid: 'uuid-1' }), createInput({ uuid: 'uuid-2' })]

        const responses = [
            createResponse({ uuid: 'uuid-1', properties: { $exception_fingerprint: 'fp-1' } }),
            createResponse({ uuid: 'uuid-2', properties: { $exception_fingerprint: 'fp-2' } }),
        ]

        mockCymbalClient.processExceptions.mockResolvedValueOnce(responses.map(toResult))

        const results = await step(inputs)

        expect(results).toHaveLength(2)
        expect(results[0].type).toBe(PipelineResultType.OK)
        expect(results[1].type).toBe(PipelineResultType.OK)

        // Verify Cymbal request format
        expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
            expect.objectContaining({
                estimatedSize: expect.any(Number),
                request: expect.objectContaining({
                    uuid: 'uuid-1',
                    event: '$exception',
                    team_id: 123,
                }),
            }),
            expect.objectContaining({
                estimatedSize: expect.any(Number),
                request: expect.objectContaining({
                    uuid: 'uuid-2',
                    event: '$exception',
                    team_id: 123,
                }),
            }),
        ])
    })

    it('enriches events with Cymbal response data', async () => {
        const input = createInput({
            properties: {
                $exception_list: [{ type: 'Error', value: 'Test error' }],
                existing: 'property',
            },
        })

        const response = createResponse({
            properties: {
                $exception_list: [{ type: 'Error', value: 'Test error', resolved: true } as any],
                $exception_fingerprint: 'computed-fingerprint',
                $exception_issue_id: 'issue-123',
                $exception_resolved: true,
            },
        })

        mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(response)])

        const results = await step([input])

        expect(results[0].type).toBe(PipelineResultType.OK)
        if (isOkResult(results[0])) {
            // Cymbal replaces properties entirely
            expect(results[0].value.event.properties).toEqual(response.properties)
        }
    })

    it('drops events when Cymbal returns null (suppressed)', async () => {
        const inputs = [createInput({ uuid: 'uuid-1' }), createInput({ uuid: 'uuid-2' })]

        mockCymbalClient.processExceptions.mockResolvedValueOnce([
            toResult(null), // Suppressed
            toResult(createResponse({ uuid: 'uuid-2', properties: { $exception_fingerprint: 'fp-2' } })),
        ])

        const results = await step(inputs)

        expect(results).toHaveLength(2)
        expect(results[0].type).toBe(PipelineResultType.DROP)
        expect(isDropResult(results[0])).toBe(true)
        expect(results[1].type).toBe(PipelineResultType.OK)
    })

    it('preserves ordering across mixed success, failed, and suppressed results', async () => {
        const inputs = [
            createInput({ uuid: 'uuid-0' }),
            createInput({ uuid: 'uuid-1' }),
            createInput({ uuid: 'uuid-2' }),
            createInput({ uuid: 'uuid-3' }),
        ]

        mockCymbalClient.processExceptions.mockResolvedValueOnce([
            toResult(createResponse({ uuid: 'uuid-0', properties: { $exception_fingerprint: 'fp-0' } })),
            { status: 'failed' as const, reason: 'retries exhausted' },
            toResult(null), // suppressed
            toResult(createResponse({ uuid: 'uuid-3', properties: { $exception_fingerprint: 'fp-3' } })),
        ])

        const results = await step(inputs)

        expect(results).toHaveLength(4)
        expect(results[0].type).toBe(PipelineResultType.OK)
        expect(results[1].type).toBe(PipelineResultType.REDIRECT)
        expect(results[2].type).toBe(PipelineResultType.DROP)
        expect(results[3].type).toBe(PipelineResultType.OK)

        // Verify the OK results have the right event data at the right positions
        expect(isOkResult(results[0])).toBe(true)
        expect(isOkResult(results[3])).toBe(true)
        if (isOkResult(results[0]) && isOkResult(results[3])) {
            expect(results[0].value.event.properties!.$exception_fingerprint).toBe('fp-0')
            expect(results[3].value.event.properties!.$exception_fingerprint).toBe('fp-3')
        }
    })

    it('passes all properties to Cymbal including GeoIP', async () => {
        const input = createInput({
            properties: {
                $exception_list: [{ type: 'Error', value: 'Test' }],
                $geoip_country_code: 'US',
                $geoip_city_name: 'San Francisco',
                $geoip_subdivision_1_code: 'CA',
                $geoip_subdivision_1_name: 'California',
            },
        })

        mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

        await step([input])

        expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
            expect.objectContaining({
                estimatedSize: expect.any(Number),
                request: expect.objectContaining({
                    properties: expect.objectContaining({
                        $geoip_country_code: 'US',
                        $geoip_city_name: 'San Francisco',
                        $geoip_subdivision_1_code: 'CA',
                        $geoip_subdivision_1_name: 'California',
                    }),
                }),
            }),
        ])
    })

    it('includes group properties in request properties', async () => {
        const input = createInput({
            properties: {
                $exception_list: [{ type: 'Error', value: 'Test' }],
                $group_0: 'company-1',
                $group_1: 'project-1',
            },
        })

        mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

        await step([input])

        // Group properties are passed through in the properties object
        expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
            expect.objectContaining({
                estimatedSize: expect.any(Number),
                request: expect.objectContaining({
                    properties: expect.objectContaining({
                        $group_0: 'company-1',
                        $group_1: 'project-1',
                    }),
                }),
            }),
        ])
    })

    it('handles empty batch', async () => {
        const results = await step([])

        expect(results).toEqual([])
        expect(mockCymbalClient.processExceptions).not.toHaveBeenCalled()
    })

    it('preserves team in output', async () => {
        const input = createInput()

        mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

        const results = await step([input])

        expect(results[0].type).toBe(PipelineResultType.OK)
        if (isOkResult(results[0])) {
            expect(results[0].value.team).toBe(team)
        }
    })

    it('passes properties even when $exception_list is missing', async () => {
        const input = createInput({
            properties: { some_prop: 'value' }, // No $exception_list
        })

        mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

        await step([input])

        expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
            expect.objectContaining({
                estimatedSize: expect.any(Number),
                request: expect.objectContaining({
                    properties: { some_prop: 'value' },
                }),
            }),
        ])
    })

    describe('timestamp validation', () => {
        it('uses timestamp from event when valid', async () => {
            const input = createInput()
            input.event.timestamp = '2024-01-15T10:30:00.000Z'

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

            await step([input])

            expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
                expect.objectContaining({
                    estimatedSize: expect.any(Number),
                    request: expect.objectContaining({
                        timestamp: '2024-01-15T10:30:00.000Z',
                    }),
                }),
            ])
        })

        it('falls back to current time when timestamp is missing', async () => {
            jest.useFakeTimers()
            jest.setSystemTime(new Date('2024-01-20T12:00:00.000Z'))

            try {
                const input = createInput()
                input.event.timestamp = undefined as any

                mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

                await step([input])

                expect(mockCymbalClient.processExceptions).toHaveBeenCalledWith([
                    expect.objectContaining({
                        estimatedSize: expect.any(Number),
                        request: expect.objectContaining({
                            timestamp: '2024-01-20T12:00:00.000Z',
                        }),
                    }),
                ])
            } finally {
                jest.useRealTimers()
            }
        })

        it('stores validated timestamp back on event for downstream steps', async () => {
            const input = createInput()
            input.event.timestamp = '2024-01-15T10:30:00.000Z'

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                // The validated timestamp should be stored on event.timestamp
                expect(results[0].value.event.timestamp).toBe('2024-01-15T10:30:00.000Z')
            }
        })

        it('emits warning for invalid timestamp and falls back to current time', async () => {
            const input = createInput()
            input.event.timestamp = 'not-a-valid-timestamp' as any

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(createResponse())])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                // Should have a timestamp warning
                expect(results[0].warnings.length).toBeGreaterThanOrEqual(1)
                expect(results[0].warnings.some((w) => w.type.includes('timestamp'))).toBe(true)
            }
        })
    })

    it('sends all events to DLQ on non-retriable Cymbal error', async () => {
        const inputs = [createInput({ uuid: 'uuid-1' }), createInput({ uuid: 'uuid-2' })]

        mockCymbalClient.processExceptions.mockRejectedValueOnce(new Error('Cymbal unavailable'))

        const results = await step(inputs)

        expect(results).toHaveLength(2)
        expect(results[0].type).toBe(PipelineResultType.DLQ)
        expect(results[1].type).toBe(PipelineResultType.DLQ)
    })

    describe('ingestion warnings', () => {
        it('emits warning when Cymbal returns $cymbal_errors', async () => {
            const input = createInput({ uuid: 'event-with-errors' })

            const response = createResponse({
                uuid: 'event-with-errors',
                properties: {
                    $exception_list: [{ type: 'Error', value: 'Test error' }],
                    $exception_fingerprint: 'test-fingerprint',
                    $cymbal_errors: ['No sourcemap found for source url: https://example.com/app.js'],
                },
            })

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(response)])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                expect(results[0].warnings).toHaveLength(1)
                expect(results[0].warnings[0]).toEqual({
                    type: 'error_tracking_exception_processing_errors',
                    details: {
                        eventUuid: 'event-with-errors',
                        errors: ['No sourcemap found for source url: https://example.com/app.js'],
                    },
                    key: 'event-with-errors',
                })
            }
        })

        it('emits warning with multiple errors', async () => {
            const input = createInput({ uuid: 'event-multiple-errors' })

            const response = createResponse({
                uuid: 'event-multiple-errors',
                properties: {
                    $exception_list: [{ type: 'Error', value: 'Test error' }],
                    $cymbal_errors: [
                        'No sourcemap found for source url: https://example.com/app.js',
                        'Invalid source map: failed to parse',
                    ],
                },
            })

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(response)])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                expect(results[0].warnings).toHaveLength(1)
                expect(results[0].warnings[0].details.errors).toEqual([
                    'No sourcemap found for source url: https://example.com/app.js',
                    'Invalid source map: failed to parse',
                ])
            }
        })

        it('does not emit warning when $cymbal_errors is empty', async () => {
            const input = createInput({ uuid: 'event-no-errors' })

            const response = createResponse({
                uuid: 'event-no-errors',
                properties: {
                    $exception_list: [{ type: 'Error', value: 'Test error' }],
                    $exception_fingerprint: 'test-fingerprint',
                    $cymbal_errors: [],
                },
            })

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(response)])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                expect(results[0].warnings).toHaveLength(0)
            }
        })

        it('does not emit warning when $cymbal_errors is absent', async () => {
            const input = createInput({ uuid: 'event-no-errors-field' })

            const response = createResponse({
                uuid: 'event-no-errors-field',
                properties: {
                    $exception_list: [{ type: 'Error', value: 'Test error' }],
                    $exception_fingerprint: 'test-fingerprint',
                    // No $cymbal_errors field
                },
            })

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(response)])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.OK)
            if (isOkResult(results[0])) {
                expect(results[0].warnings).toHaveLength(0)
            }
        })

        it('does not emit warning for suppressed events', async () => {
            const input = createInput({ uuid: 'suppressed-event' })

            mockCymbalClient.processExceptions.mockResolvedValueOnce([toResult(null)])

            const results = await step([input])

            expect(results[0].type).toBe(PipelineResultType.DROP)
            // Drop results also have warnings array but it should be empty
            expect(results[0].warnings).toHaveLength(0)
        })
    })
})
