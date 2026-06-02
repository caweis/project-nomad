import KVStore from '#models/kv_store';
import { BenchmarkService } from '#services/benchmark_service';
import { DockerService } from '#services/docker_service';
import { MapService } from '#services/map_service';
import { OllamaService } from '#services/ollama_service';
import { SystemService } from '#services/system_service';
import { getSettingSchema, updateSettingSchema } from '#validators/settings';
import env from '#start/env';
import { inject } from '@adonisjs/core';
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class SettingsController {
    constructor(
        private systemService: SystemService,
        private mapService: MapService,
        private benchmarkService: BenchmarkService,
        private ollamaService: OllamaService
    ) { }

    async system({ inertia }: HttpContext) {
        const systemInfo = await this.systemService.getSystemInfo();
        return inertia.render('settings/system', {
            system: {
                info: systemInfo
            },
            // Frontend uses this to hide container-management buttons that
            // wouldn't work against a native Homebrew Ollama install
            // (configured via the OLLAMA_HOST env var on the macOS distro).
            isNativeOllama: DockerService.isNativeOllama(),
        });
    }

    async apps({ inertia }: HttpContext) {
        const services = await this.systemService.getServices({ installedOnly: false });
        const isNativeOllama = DockerService.isNativeOllama();
        const aiBackend = env.get('NOMAD_AI_BACKEND') ?? 'ollama';
        // The "AI Assistant" Version cell can't use the seeder's container-image
        // tag (ollama/ollama:0.15.2): on 'omlx' chat runs on Apple MLX (wrong
        // engine) and on 'ollama' the real version is the host daemon's, not the
        // bundled tag. On the host-Ollama backend, probe the native daemon's
        // /api/version so the page shows the actual installed version; on omlx
        // the frontend shows the engine name ("Apple MLX") so we skip the probe
        // entirely (it would answer for the embeddings sidecar, not the chat
        // engine). null/undefined when unreachable — the frontend shows a
        // neutral placeholder rather than a stale number.
        const aiAssistantVersion = (isNativeOllama && aiBackend === 'ollama')
            ? (await this.ollamaService.getNativeServerVersion()) ?? undefined
            : undefined;
        return inertia.render('settings/apps', {
            system: {
                services
            },
            // Frontend uses this to gate ALL row actions for nomad_ollama
            // (Start / Stop / Restart / Force Reinstall / Update). Each one
            // routes through DockerService.affectService or updateService,
            // both of which refuse with a "manage via CLI" error on native
            // Ollama. Hiding the buttons skips the dead-end UX entirely.
            isNativeOllama,
            // Which backend the host CLI selected ('omlx' | 'ollama'). Both set
            // OLLAMA_HOST (so isNativeOllama is true for both), so the page needs
            // this to tell them apart on the "AI Assistant" card: on 'omlx' chat
            // runs on Apple MLX and Ollama is only the embeddings sidecar, so an
            // Ollama "Update" must NOT be offered (it wouldn't touch the chat
            // engine); on 'ollama' the host-side Ollama upgrade IS the chat-engine
            // update. Defaults to 'ollama'.
            aiBackend,
            // Real native-daemon version for the host-Ollama backend (see above).
            aiAssistantVersion,
        });
    }
    
    async legal({ inertia }: HttpContext) {
        return inertia.render('settings/legal');
    }

    async support({ inertia }: HttpContext) {
        return inertia.render('settings/support');
    }

    async maps({ inertia }: HttpContext) {
        const baseAssetsCheck = await this.mapService.ensureBaseAssets();
        const regionFiles = await this.mapService.listRegions();
        return inertia.render('settings/maps', {
            maps: {
                baseAssetsExist: baseAssetsCheck,
                regionFiles: regionFiles.files
            }
        });
    }

    async models({ inertia }: HttpContext) {
        const availableModels = await this.ollamaService.getAvailableModels({ sort: 'pulls', recommendedOnly: false, query: null, limit: 15 });
        const installedModels = await this.ollamaService.getModels();
        const chatSuggestionsEnabled = await KVStore.getValue('chat.suggestionsEnabled')
        const aiAssistantCustomName = await KVStore.getValue('ai.assistantCustomName')
        return inertia.render('settings/models', {
            models: {
                availableModels: availableModels?.models || [],
                installedModels: installedModels || [],
                settings: {
                    chatSuggestionsEnabled: chatSuggestionsEnabled ?? false,
                    aiAssistantCustomName: aiAssistantCustomName ?? '',
                }
            },
            // Frontend uses this to hide the GPU-passthrough-failed "Reinstall
            // AI Assistant" banner + button. Forcing a Docker reinstall against
            // a native Homebrew Ollama install just produces a misleading error.
            isNativeOllama: DockerService.isNativeOllama(),
            // Which backend the host CLI selected ('omlx' | 'ollama'). Both set
            // OLLAMA_HOST (so isNativeOllama is true for both), but only the
            // 'ollama' backend serves chat from Ollama — on 'omlx', chat runs on
            // Apple MLX and Ollama is just the embeddings sidecar. The page uses
            // this to label the banner accurately. Defaults to 'ollama'.
            aiBackend: env.get('NOMAD_AI_BACKEND') ?? 'ollama',
        });
    }

    async update({ inertia }: HttpContext) {
        const updateInfo = await this.systemService.checkLatestVersion();
        return inertia.render('settings/update', {
            system: {
                updateAvailable: updateInfo.updateAvailable,
                latestVersion: updateInfo.latestVersion,
                currentVersion: updateInfo.currentVersion
            },
            // Frontend uses this to hide the self-update Start button on the
            // macOS distro. Admin's built-in update path tries to rewrite
            // compose.yaml image tags but only knows the
            // ghcr.io/crosstalk-solutions/* tag pattern — it can't update
            // caweis/* images, so it silently fails ("Failed to update
            // compose.yml image tag — check logs"). The right path on the
            // macOS distro is `nomad upgrade compose` on the host.
            isNativeOllama: DockerService.isNativeOllama(),
        });
    }

    async zim({ inertia }: HttpContext) {
        return inertia.render('settings/zim/index')
    }

    async zimRemote({ inertia }: HttpContext) {
        return inertia.render('settings/zim/remote-explorer');
    }

    async benchmark({ inertia }: HttpContext) {
        const latestResult = await this.benchmarkService.getLatestResult();
        const status = this.benchmarkService.getStatus();
        return inertia.render('settings/benchmark', {
            benchmark: {
                latestResult,
                status: status.status,
                currentBenchmarkId: status.benchmarkId
            }
        });
    }

    async getSetting({ request, response }: HttpContext) {
        // Validate `key` against SETTINGS_KEYS enum so the endpoint can't be
        // used to probe arbitrary KV keys. Ports upstream b183bc6.
        const { key } = await getSettingSchema.validate({ key: request.qs().key });
        const value = await KVStore.getValue(key);
        return response.status(200).send({ key, value });
    }

    async updateSetting({ request, response }: HttpContext) {
        const reqData = await request.validateUsing(updateSettingSchema);
        await this.systemService.updateSetting(reqData.key, reqData.value);
        return response.status(200).send({ success: true, message: 'Setting updated successfully' });
    }
}