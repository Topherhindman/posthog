import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/api/client'
import { MemoryCache } from '@/lib/cache/MemoryCache'
import { StateManager } from '@/lib/StateManager'
import type { ApiRedactedPersonalApiKey, ApiUser } from '@/schema/api'
import type { State } from '@/tools/types'

const createProject = (overrides: Record<string, unknown> = {}): any =>
    ({
        id: 456,
        organization: 'org-1',
        name: 'Test project',
        created_at: '2026-01-01T00:00:00.000Z',
        effective_membership_level: null,
        has_group_types: false,
        group_types: [],
        live_events_token: null,
        updated_at: '2026-01-01T00:00:00.000Z',
        uuid: 'project-uuid-456',
        api_token: 'phc_test',
        ingested_event: false,
        ...overrides,
    }) as any

describe('StateManager', () => {
    let stateManager: StateManager
    let cache: MemoryCache<State>
    const mockUser: ApiUser = {
        distinct_id: 'distinct-123',
        organizations: [{ id: 'org-1' }, { id: 'org-2' }],
        team: { id: 456, organization: 'org-1' },
        organization: { id: 'org-1' },
    }

    const mockApiKey: ApiRedactedPersonalApiKey = {
        scopes: ['user:read', 'insight:write'],
        scoped_organizations: [],
        scoped_teams: [],
    }

    beforeEach(async () => {
        cache = new MemoryCache('test-user')
        await cache.clear()
        stateManager = new StateManager(cache, {} as ApiClient)
    })

    describe('getUser', () => {
        it('should fetch and cache user on first call', async () => {
            const fetchUserSpy = vi.spyOn(stateManager as any, '_fetchUser').mockResolvedValue(mockUser)

            const result = await stateManager.getUser()

            expect(result).toEqual(mockUser)
            expect(fetchUserSpy).toHaveBeenCalledOnce()
        })

        it('should return cached user on subsequent calls', async () => {
            const fetchUserSpy = vi.spyOn(stateManager as any, '_fetchUser').mockResolvedValue(mockUser)

            await stateManager.getUser()
            const result = await stateManager.getUser()

            expect(result).toEqual(mockUser)
            expect(fetchUserSpy).toHaveBeenCalledOnce()
        })

        it('should throw error when user fetch fails', async () => {
            const error = new Error('API error')
            vi.spyOn(stateManager as any, '_fetchUser').mockRejectedValue(error)

            await expect(stateManager.getUser()).rejects.toThrow('API error')
        })
    })

    describe('getDistinctId', () => {
        it('should get distinct ID from cache if available', async () => {
            await cache.set('distinctId', 'cached-distinct-id')

            const result = await stateManager.getDistinctId()

            expect(result).toBe('cached-distinct-id')
        })

        it('should fetch user and cache distinct ID if not in cache', async () => {
            const getUserSpy = vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            const result = await stateManager.getDistinctId()

            expect(result).toBe('distinct-123')
            expect(await cache.get('distinctId')).toBe('distinct-123')
            expect(getUserSpy).toHaveBeenCalledOnce()
        })
    })

    describe('setDefaultOrganizationAndProject', () => {
        it('should handle team-scoped API key with single team', async () => {
            const teamScopedApiKey = {
                ...mockApiKey,
                scoped_teams: [456],
            }

            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(teamScopedApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            const result = await stateManager.setDefaultOrganizationAndProject()

            expect(result.projectId).toBe(456)
            expect(result.organizationId).toBeUndefined()
        })

        it('should throw error for team-scoped API key with multiple teams', async () => {
            const multiTeamApiKey = {
                ...mockApiKey,
                scoped_teams: [123, 456],
            }

            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(multiTeamApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            await expect(stateManager.setDefaultOrganizationAndProject()).rejects.toThrow(
                'API key has access to multiple projects'
            )
        })

        it("should use user's active org and team when no scoped restrictions", async () => {
            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(mockApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            const result = await stateManager.setDefaultOrganizationAndProject()

            expect(result.organizationId).toBe('org-1')
            expect(result.projectId).toBe(456)
            expect(await cache.get('orgId')).toBe('org-1')
            expect(await cache.get('projectId')).toBe('456')
        })

        it("should use user's active org and team when org is in scoped list", async () => {
            const scopedOrgApiKey = {
                ...mockApiKey,
                scoped_organizations: ['org-2', 'org-1'],
            }

            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(scopedOrgApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            const result = await stateManager.setDefaultOrganizationAndProject()

            expect(result.organizationId).toBe('org-1')
            expect(result.projectId).toBe(456)
        })

        it("should use first scoped org when user's active org not in scoped list", async () => {
            const scopedOrgApiKey = {
                ...mockApiKey,
                scoped_organizations: ['org-3'],
            }

            const mockApi = stateManager as any
            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(scopedOrgApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            // Mock the API client organization projects list call
            mockApi._api = {
                organizations: () => ({
                    projects: () => ({
                        list: vi.fn().mockResolvedValue({
                            success: true,
                            data: [789],
                        }),
                    }),
                }),
            }

            const result = await stateManager.setDefaultOrganizationAndProject()

            expect(result.organizationId).toBe('org-3')
            expect(result.projectId).toBe(789)
        })

        it('should throw error when no projects available for scoped org', async () => {
            const scopedOrgApiKey = {
                ...mockApiKey,
                scoped_organizations: ['org-3'],
            }

            const mockApi = stateManager as any
            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(scopedOrgApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            // Mock the API client organization projects list call
            mockApi._api = {
                organizations: () => ({
                    projects: () => ({
                        list: vi.fn().mockResolvedValue({
                            success: true,
                            data: [],
                        }),
                    }),
                }),
            }

            await expect(stateManager.setDefaultOrganizationAndProject()).rejects.toThrow(
                'API key does not have access to any projects'
            )
        })

        it('should throw error when projects fetch fails', async () => {
            const scopedOrgApiKey = {
                ...mockApiKey,
                scoped_organizations: ['org-3'],
            }

            const mockApi = stateManager as any
            vi.spyOn(stateManager, 'getApiKey').mockResolvedValue(scopedOrgApiKey)
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            // Mock the API client organization projects list call
            const mockError = new Error('Projects fetch failed')
            mockApi._api = {
                organizations: () => ({
                    projects: () => ({
                        list: vi.fn().mockResolvedValue({
                            success: false,
                            error: mockError,
                        }),
                    }),
                }),
            }

            await expect(stateManager.setDefaultOrganizationAndProject()).rejects.toThrow(mockError)
        })
    })

    describe('getOrgID', () => {
        it('should return cached orgId if available', async () => {
            await cache.set('orgId', 'cached-org-id')

            const result = await stateManager.getOrgID()

            expect(result).toBe('cached-org-id')
        })

        it('should call setDefaultOrganizationAndProject when not cached', async () => {
            const spy = vi.spyOn(stateManager, 'setDefaultOrganizationAndProject').mockResolvedValue({
                organizationId: 'default-org',
                projectId: 123,
            })

            const result = await stateManager.getOrgID()

            expect(result).toBe('default-org')
            expect(spy).toHaveBeenCalledOnce()
        })

        it('should backfill org and project UUID from cached project', async () => {
            await cache.set('projectId', '456')
            const fetchProjectSpy = vi.spyOn(stateManager as any, '_fetchProject').mockResolvedValue(createProject())

            const result = await stateManager.getOrgID()

            expect(result).toBe('org-1')
            expect(fetchProjectSpy).toHaveBeenCalledWith('456')
            expect(await cache.get('orgId')).toBe('org-1')
            expect(await cache.get('projectUuid')).toBe('project-uuid-456')
        })
    })

    describe('getProjectId', () => {
        it('should return cached projectId if available', async () => {
            await cache.set('projectId', 'cached-project-id')

            const result = await stateManager.getProjectId()

            expect(result).toBe('cached-project-id')
        })

        it('should call setDefaultOrganizationAndProject when not cached', async () => {
            const spy = vi.spyOn(stateManager, 'setDefaultOrganizationAndProject').mockResolvedValue({
                organizationId: 'default-org',
                projectId: 789,
            })

            const result = await stateManager.getProjectId()

            expect(result).toBe('789')
            expect(spy).toHaveBeenCalledOnce()
        })

        it('should resolve and cache a project from the active organization', async () => {
            await cache.set('orgId', 'org-1')
            vi.spyOn(stateManager, 'getUser').mockResolvedValue(mockUser)

            ;(stateManager as any)._api = {
                organizations: () => ({
                    projects: () => ({
                        list: vi.fn().mockResolvedValue({
                            success: true,
                            data: [
                                createProject({ id: 123, uuid: 'project-uuid-123' }),
                                createProject({ id: 456, uuid: 'project-uuid-456' }),
                            ],
                        }),
                    }),
                }),
            }

            const result = await stateManager.getProjectId()

            expect(result).toBe('456')
            expect(await cache.get('projectId')).toBe('456')
            expect(await cache.get('projectUuid')).toBe('project-uuid-456')
        })
    })

    describe('getResolvedProjectContext', () => {
        it('should use cached org and project UUID when available', async () => {
            await cache.set('orgId', 'org-1')
            await cache.set('projectId', '456')
            await cache.set('projectUuid', 'project-uuid-456')
            const fetchProjectSpy = vi.spyOn(stateManager as any, '_fetchProject')

            const result = await stateManager.getResolvedProjectContext()

            expect(result).toEqual({
                organizationId: 'org-1',
                projectId: '456',
                projectUuid: 'project-uuid-456',
            })
            expect(fetchProjectSpy).not.toHaveBeenCalled()
        })

        it('should fetch project details when project UUID is missing', async () => {
            await cache.set('orgId', 'org-1')
            await cache.set('projectId', '456')
            vi.spyOn(stateManager as any, '_fetchProject').mockResolvedValue(createProject())

            const result = await stateManager.getResolvedProjectContext()

            expect(result).toEqual({
                organizationId: 'org-1',
                projectId: '456',
                projectUuid: 'project-uuid-456',
                projectName: 'Test project',
            })
        })
    })

    describe('switchToProject', () => {
        it('should cache project, UUID, and invalidate consent when org changes', async () => {
            await cache.set('orgId', 'org-1')
            await cache.set('aiConsentGiven', true)
            await cache.set('aiConsentFetchedAt', 123)
            vi.spyOn(stateManager as any, '_fetchProject').mockResolvedValue(
                createProject({
                    id: 789,
                    organization: 'org-2',
                    name: 'Org 2 project',
                    uuid: 'project-uuid-789',
                })
            )
            const invalidateSpy = vi.spyOn(stateManager, 'invalidateAiConsent')

            const result = await stateManager.switchToProject('789')

            expect(result).toEqual({
                organizationId: 'org-2',
                projectId: '789',
                projectUuid: 'project-uuid-789',
                projectName: 'Org 2 project',
            })
            expect(invalidateSpy).toHaveBeenCalledOnce()
            expect(await cache.get('orgId')).toBe('org-2')
            expect(await cache.get('projectId')).toBe('789')
            expect(await cache.get('projectUuid')).toBe('project-uuid-789')
            expect(await cache.get('aiConsentGiven')).toBeUndefined()
            expect(await cache.get('aiConsentFetchedAt')).toBeUndefined()
        })
    })

    describe('switchToOrganization', () => {
        it('should keep the preferred project when it exists in the target org', async () => {
            await cache.set('orgId', 'org-1')
            await cache.set('projectId', '222')

            ;(stateManager as any)._api = {
                organizations: () => ({
                    projects: () => ({
                        list: vi.fn().mockResolvedValue({
                            success: true,
                            data: [
                                createProject({
                                    id: 222,
                                    organization: 'org-2',
                                    name: 'Preferred project',
                                    uuid: 'project-uuid-222',
                                }),
                                createProject({
                                    id: 333,
                                    organization: 'org-2',
                                    name: 'Fallback project',
                                    uuid: 'project-uuid-333',
                                }),
                            ],
                        }),
                    }),
                }),
            }
            const invalidateSpy = vi.spyOn(stateManager, 'invalidateAiConsent')

            const result = await stateManager.switchToOrganization('org-2')

            expect(result).toEqual({
                organizationId: 'org-2',
                projectId: '222',
                projectUuid: 'project-uuid-222',
                projectName: 'Preferred project',
            })
            expect(invalidateSpy).toHaveBeenCalledOnce()
            expect(await cache.get('orgId')).toBe('org-2')
            expect(await cache.get('projectId')).toBe('222')
            expect(await cache.get('projectUuid')).toBe('project-uuid-222')
        })
    })
})
