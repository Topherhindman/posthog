import { mockFetch } from '~/tests/helpers/mocks/request.mock'

import { DateTime } from 'luxon'

import { createCdpConsumerDeps } from '~/tests/helpers/cdp'
import { getFirstTeam, resetTestDatabase } from '~/tests/helpers/sql'

import { Hub, Team } from '../../types'
import { closeHub, createHub } from '../../utils/db/hub'
import { HOG_EXAMPLES, HOG_FILTERS_EXAMPLES, HOG_INPUTS_EXAMPLES } from '../_tests/examples'
import {
    createExampleInvocation,
    createHogExecutionGlobals,
    createHogFunction,
    insertHogFunction,
} from '../_tests/fixtures'
import { CyclotronJobInvocationHogFunction, HogFunctionInvocationGlobalsWithInputs, HogFunctionType } from '../types'
import { CdpCyclotronWorkerEmail } from './cdp-cyclotron-worker-email.consumer'

jest.setTimeout(5000)

describe('CdpCyclotronWorkerEmail', () => {
    let hub: Hub
    let team: Team
    let emailWorker: CdpCyclotronWorkerEmail
    let fn: HogFunctionType
    let globals: HogFunctionInvocationGlobalsWithInputs
    let invocation: CyclotronJobInvocationHogFunction

    beforeEach(async () => {
        await resetTestDatabase()
        hub = await createHub()
        team = await getFirstTeam(hub.postgres)
        emailWorker = new CdpCyclotronWorkerEmail(hub, createCdpConsumerDeps(hub))

        fn = await insertHogFunction(
            hub.postgres,
            team.id,
            createHogFunction({
                ...HOG_EXAMPLES.simple_fetch,
                ...HOG_INPUTS_EXAMPLES.simple_fetch,
                ...HOG_FILTERS_EXAMPLES.pageview_or_autocapture_filter,
                template_id: 'template-webhook',
            })
        )

        globals = {
            ...createHogExecutionGlobals({}),
            inputs: {
                url: 'https://posthog.com',
            },
        }

        invocation = createExampleInvocation(fn, globals)
        invocation.queue = 'email'
        invocation.queueSource = 'postgres-v2'
    })

    afterEach(async () => {
        jest.setTimeout(10000)
        await closeHub(hub)
    })

    describe('processInvocations', () => {
        beforeEach(() => {
            const fixedTime = DateTime.fromObject({ year: 2025, month: 1, day: 1 }, { zone: 'UTC' })
            jest.spyOn(Date, 'now').mockReturnValue(fixedTime.toMillis())

            mockFetch.mockResolvedValue({
                status: 200,
                json: () => Promise.resolve({}),
                text: () => Promise.resolve(JSON.stringify({})),
                headers: {},
            } as any)
        })

        it('should process a fetch invocation and route it back to hogflow', async () => {
            // The email worker picks up a job with a fetch — it should route back to hogflow
            const results = await emailWorker.processInvocations([invocation])
            const result = results[0]

            // Fetch should route to hogflow since we're on the email worker
            expect(result.invocation.queue).not.toBe('email')
            expect(result.finished).toBe(false)
        })

        it('should send email inline when on the email queue', async () => {
            // Set up an email invocation on the email queue
            invocation.queueParameters = {
                type: 'email',
                to: { email: 'user@example.com' },
                from: { email: 'noreply@posthog.com', integrationId: 1 },
                subject: 'Test',
                text: 'Hello',
                html: '<p>Hello</p>',
            }

            jest.spyOn(emailWorker['emailService'], 'executeSendEmail').mockResolvedValue({
                invocation: invocation,
                finished: true,
                logs: [],
                metrics: [],
                capturedPostHogEvents: [],
                warehouseWebhookPayloads: [],
            })

            const results = await emailWorker.processInvocations([invocation])
            const result = results[0]

            expect(emailWorker['emailService'].executeSendEmail).toHaveBeenCalled()
            expect(result.finished).toBe(true)
        })
    })
})
