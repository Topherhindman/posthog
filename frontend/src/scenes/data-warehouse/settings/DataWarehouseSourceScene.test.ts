import { getDefaultDataWarehouseSourceSceneTab, isManagedSourceSceneId } from './DataWarehouseSourceScene'

describe('DataWarehouseSourceScene', () => {
    it('defaults managed source routes to the schemas tab', () => {
        expect(getDefaultDataWarehouseSourceSceneTab('managed-123')).toEqual('schemas')
        expect(getDefaultDataWarehouseSourceSceneTab('019d8b93-b5ba-0000-52e1-99fa41d90d4d')).toEqual('schemas')
    })

    it('defaults self-managed source routes to the configuration tab', () => {
        expect(getDefaultDataWarehouseSourceSceneTab('self-managed-123')).toEqual('configuration')
    })

    it('treats raw source ids as managed source scene ids', () => {
        expect(isManagedSourceSceneId('managed-123')).toEqual(true)
        expect(isManagedSourceSceneId('019d8b93-b5ba-0000-52e1-99fa41d90d4d')).toEqual(true)
        expect(isManagedSourceSceneId('self-managed-123')).toEqual(false)
    })
})
