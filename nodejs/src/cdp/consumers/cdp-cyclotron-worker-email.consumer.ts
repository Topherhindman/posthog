import { PluginsServerConfig } from '~/types'

import { CdpConsumerBaseDeps } from './cdp-base.consumer'
import { CdpCyclotronWorkerHogFlow } from './cdp-cyclotron-worker-hogflow.consumer'

export class CdpCyclotronWorkerEmail extends CdpCyclotronWorkerHogFlow {
    protected name = 'CdpCyclotronWorkerEmail'

    constructor(config: PluginsServerConfig, deps: CdpConsumerBaseDeps) {
        super(config, deps)
        this.queue = 'email'
    }

    public async start() {
        const consumerMode = this.config.CYCLOTRON_NODE_DATABASE_URL ? 'postgres-v2' : undefined
        await super.start(consumerMode)
    }
}
