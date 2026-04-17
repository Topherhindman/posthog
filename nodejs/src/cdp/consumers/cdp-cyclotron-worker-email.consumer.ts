import { DateTime } from 'luxon'
import { Counter, Gauge } from 'prom-client'

import { PluginsServerConfig } from '~/types'

import { logger } from '../../utils/logger'
import { HogRateLimiterService } from '../services/monitoring/hog-rate-limiter.service'
import { CyclotronJobInvocation, CyclotronJobInvocationResult } from '../types'
import { createInvocationResult } from '../utils/invocation-utils'
import { CdpConsumerBaseDeps } from './cdp-base.consumer'
import { CdpCyclotronWorkerHogFlow } from './cdp-cyclotron-worker-hogflow.consumer'

const emailRateLimitedTotal = new Counter({
    name: 'cdp_email_rate_limited_total',
    help: 'Total emails deferred by global rate limiting',
})

const emailRateLimitTokensAvailable = new Gauge({
    name: 'cdp_email_rate_limit_tokens_available',
    help: 'Available tokens in the global email rate limit bucket',
})

const RATE_LIMIT_RETRY_BASE_MS = 500
const RATE_LIMIT_JITTER_MS = 200

export class CdpCyclotronWorkerEmail extends CdpCyclotronWorkerHogFlow {
    protected name = 'CdpCyclotronWorkerEmail'
    private emailRateLimiter: HogRateLimiterService | null = null

    constructor(config: PluginsServerConfig, deps: CdpConsumerBaseDeps) {
        super(config, deps)
        this.queue = 'email'

        if (config.CDP_EMAIL_GLOBAL_RATE_LIMIT_BUCKET_SIZE > 0 && config.CDP_EMAIL_GLOBAL_RATE_LIMIT_REFILL_RATE > 0) {
            this.emailRateLimiter = new HogRateLimiterService(
                {
                    bucketSize: config.CDP_EMAIL_GLOBAL_RATE_LIMIT_BUCKET_SIZE,
                    refillRate: config.CDP_EMAIL_GLOBAL_RATE_LIMIT_REFILL_RATE,
                    ttl: 60 * 60 * 24,
                },
                this.redis
            )
        }
    }

    public async start() {
        const consumerMode = this.config.CYCLOTRON_NODE_DATABASE_URL ? 'postgres-v2' : undefined
        await super.start(consumerMode)
    }

    public async processInvocations(invocations: CyclotronJobInvocation[]): Promise<CyclotronJobInvocationResult[]> {
        if (!this.emailRateLimiter || invocations.length === 0) {
            return super.processInvocations(invocations)
        }

        // Pre-flight rate limit: check how many emails we can process this batch
        const [[, rateLimit]] = await this.emailRateLimiter.rateLimitMany([['global-email', 0]])
        const availableTokens = Math.max(0, Math.floor(rateLimit.tokens))
        emailRateLimitTokensAvailable.set(availableTokens)

        if (availableTokens >= invocations.length) {
            // Enough tokens — consume them and process the full batch
            await this.emailRateLimiter.rateLimitMany([['global-email', invocations.length]])
            return super.processInvocations(invocations)
        }

        // Not enough tokens — split the batch
        const toProcess = invocations.slice(0, availableTokens)
        const toDefer = invocations.slice(availableTokens)

        logger.info('Email rate limit applied', {
            batchSize: invocations.length,
            processing: toProcess.length,
            deferred: toDefer.length,
            availableTokens,
        })

        if (toProcess.length > 0) {
            await this.emailRateLimiter.rateLimitMany([['global-email', toProcess.length]])
        }

        // Process what we can
        const results = toProcess.length > 0 ? await super.processInvocations(toProcess) : []

        // Defer the rest with staggered delays
        for (let i = 0; i < toDefer.length; i++) {
            const jitterMs = Math.floor(Math.random() * RATE_LIMIT_JITTER_MS)
            const delayMs = RATE_LIMIT_RETRY_BASE_MS + jitterMs
            results.push(
                createInvocationResult(
                    toDefer[i],
                    { queueScheduledAt: DateTime.now().plus({ milliseconds: delayMs }) },
                    { finished: false }
                )
            )
            emailRateLimitedTotal.inc()
        }

        return results
    }
}
