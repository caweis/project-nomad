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
        return inertia.render('settings/apps', {
            system: {
                services
            },
            // Frontend uses this to gate ALL row actions for nomad_ollama
            // (Start / Stop / Restart / Force Reinstall / Update). Each one
            // routes through DockerService.affectService or updateService,
            // both of which refuse with a "manage via CLI" error on native
            // Ollama. Hiding the buttons skips the dead-end UX entirely.
            isNativeOllama: DockerService.isNativeOllama(),
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