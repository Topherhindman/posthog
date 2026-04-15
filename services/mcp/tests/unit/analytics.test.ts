import { describe, expect, it } from 'vitest'

import { buildMCPAnalyticsGroups, buildMCPGroupProperties } from '@/lib/analytics'

describe('MCP analytics helpers', () => {
    it('builds PostHog groups from resolved organization and project context', () => {
        expect(
            buildMCPAnalyticsGroups({
                organizationId: 'org-1',
                projectId: '123',
                projectUuid: 'project-uuid-123',
            })
        ).toEqual({
            organization: 'org-1',
            project: 'project-uuid-123',
        })
    })

    it('builds group identify properties for organization and project', () => {
        expect(
            buildMCPGroupProperties({
                organizationId: 'org-1',
                projectId: '123',
                projectUuid: 'project-uuid-123',
                projectName: 'Core project',
            })
        ).toEqual({
            organization: {
                id: 'org-1',
            },
            project: {
                id: '123',
                uuid: 'project-uuid-123',
                name: 'Core project',
                organization_id: 'org-1',
            },
        })
    })

    it('omits absent organization and project context', () => {
        expect(buildMCPAnalyticsGroups({})).toEqual({})
        expect(buildMCPGroupProperties({ projectId: '123' })).toEqual({})
    })
})
