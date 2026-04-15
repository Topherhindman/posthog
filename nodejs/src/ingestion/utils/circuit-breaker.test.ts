import { CircuitBreaker, CircuitOpenError } from './circuit-breaker'

jest.mock('~/utils/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}))

describe('CircuitBreaker', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('initial state', () => {
        it('starts in closed state', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })
            expect(cb.getState()).toBe('closed')
        })

        it('reports not open when closed', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })
            expect(cb.isOpen()).toBe(false)
        })

        it('allows attempts when closed', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })
            expect(cb.shouldAttempt()).toBe(true)
        })
    })

    describe('failure accumulation', () => {
        it('does not trip the circuit below the failure threshold', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })

            expect(cb.recordAllFailed()).toBe(false)
            expect(cb.recordAllFailed()).toBe(false)

            expect(cb.getState()).toBe('closed')
            expect(cb.isOpen()).toBe(false)
        })

        it('returns true and opens the circuit when the failure threshold is reached', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })

            cb.recordAllFailed()
            cb.recordAllFailed()
            const tripped = cb.recordAllFailed()

            expect(tripped).toBe(true)
            expect(cb.getState()).toBe('open')
            expect(cb.isOpen()).toBe(true)
        })

        it.each([
            { failureThreshold: 1, description: 'threshold of 1' },
            { failureThreshold: 5, description: 'threshold of 5' },
            { failureThreshold: 10, description: 'threshold of 10' },
        ])('trips exactly at the threshold for $description', ({ failureThreshold }) => {
            const cb = new CircuitBreaker({ failureThreshold, cooldownMs: 1000 })

            for (let i = 0; i < failureThreshold - 1; i++) {
                expect(cb.recordAllFailed()).toBe(false)
            }

            expect(cb.recordAllFailed()).toBe(true)
            expect(cb.isOpen()).toBe(true)
        })
    })

    describe('open state behavior', () => {
        it('blocks attempts while open and cooldown has not elapsed', () => {
            const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000 })
            cb.recordAllFailed()

            jest.advanceTimersByTime(4999)

            expect(cb.shouldAttempt()).toBe(false)
            expect(cb.getState()).toBe('open')
        })

        it('closes and allows attempts after cooldown elapses', () => {
            const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000 })
            cb.recordAllFailed()

            jest.advanceTimersByTime(5000)

            expect(cb.shouldAttempt()).toBe(true)
            expect(cb.getState()).toBe('closed')
        })

        it('re-opens immediately on failure after cooldown since threshold is already reached', () => {
            const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 })
            cb.recordAllFailed() // trips

            jest.advanceTimersByTime(1000)
            cb.shouldAttempt() // closes for retry

            // Retry fails — consecutive failures still above threshold, re-opens immediately
            const tripped = cb.recordAllFailed()
            expect(tripped).toBe(true)
            expect(cb.isOpen()).toBe(true)
        })
    })

    describe('recordSomeSucceeded', () => {
        it('resets consecutive failures to zero', () => {
            const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 })
            cb.recordAllFailed()
            cb.recordAllFailed()

            cb.recordSomeSucceeded()

            // After reset, two more failures should not trip (threshold is 5)
            cb.recordAllFailed()
            cb.recordAllFailed()
            expect(cb.isOpen()).toBe(false)
        })

        it('closes the circuit after a successful retry', () => {
            const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 })
            cb.recordAllFailed() // trips
            jest.advanceTimersByTime(1000)
            cb.shouldAttempt() // closes for retry

            cb.recordSomeSucceeded()

            expect(cb.getState()).toBe('closed')
            expect(cb.isOpen()).toBe(false)
        })

        it('is a no-op on state when called while already closed', () => {
            const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 })
            cb.recordSomeSucceeded()
            expect(cb.getState()).toBe('closed')
        })
    })

    describe('CircuitOpenError', () => {
        it('has the correct error name', () => {
            const error = new CircuitOpenError()
            expect(error.name).toBe('CircuitOpenError')
        })

        it('is an instance of Error', () => {
            const error = new CircuitOpenError()
            expect(error).toBeInstanceOf(Error)
        })

        it('uses the default message when none is provided', () => {
            const error = new CircuitOpenError()
            expect(error.message).toBe('Circuit breaker open \u2014 service unavailable')
        })

        it('uses a custom message when provided', () => {
            const error = new CircuitOpenError('custom message')
            expect(error.message).toBe('custom message')
        })
    })
})
