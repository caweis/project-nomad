import KVStore from '#models/kv_store'
import { SystemService } from '#services/system_service'
import { setPinSchema } from '#validators/settings'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class HomeController {
    constructor(
        private systemService: SystemService,
    ) { }

    async index({ response }: HttpContext) {
        // Redirect / to /home
        return response.redirect().toPath('/home');
    }

    async home({ inertia }: HttpContext) {
        const services = await this.systemService.getServices({ installedOnly: true });
        // Per-app pin overrides (issue #44). Default {} so an install with no
        // saved pins renders the home exactly as the display_order rule dictates.
        const pins = (await KVStore.getValue('home.pins')) ?? {};
        return inertia.render('home', {
            system: {
                services
            },
            pins,
        })
    }

    // Toggle a single app's pin override (issue #44). Reads the current
    // home.pins map (default {}), sets pins[key] = pinned, and persists it.
    // The home only shows pinned items, so the on-card use is "unpin", but the
    // endpoint is symmetric (Supply Depot pins/unpins via the same call).
    async setPin({ request, response }: HttpContext) {
        const { key, pinned } = await request.validateUsing(setPinSchema);
        const pins = (await KVStore.getValue('home.pins')) ?? {};
        pins[key] = pinned;
        await KVStore.setValue('home.pins', pins);
        return response.status(200).send({ success: true });
    }
}