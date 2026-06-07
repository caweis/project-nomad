/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/
import BenchmarkController from '#controllers/benchmark_controller'
import ChatsController from '#controllers/chats_controller'
import DocsController from '#controllers/docs_controller'
import DownloadsController from '#controllers/downloads_controller'
import EasySetupController from '#controllers/easy_setup_controller'
import HomeController from '#controllers/home_controller'
import InventoryController from '#controllers/inventory_controller'
import MapsController from '#controllers/maps_controller'
import OllamaController from '#controllers/ollama_controller'
import ReadinessController from '#controllers/readiness_controller'
import ScenarioPlanController from '#controllers/scenario_plan_controller'
import HostCommandsController from '#controllers/host_commands_controller'
import RagController from '#controllers/rag_controller'
import SettingsController from '#controllers/settings_controller'
import SystemController from '#controllers/system_controller'
import CollectionUpdatesController from '#controllers/collection_updates_controller'
import ZimController from '#controllers/zim_controller'
import WorkshopController from '#controllers/workshop_controller'
import router from '@adonisjs/core/services/router'
import transmit from '@adonisjs/transmit/services/main'
import { middleware } from './kernel.js'

transmit.registerRoutes()

router.get('/', [HomeController, 'index'])
router.get('/home', [HomeController, 'home'])
router.on('/about').renderInertia('about')
router.get('/chat', [ChatsController, 'inertia'])
router.get('/maps', [MapsController, 'index'])
router.get('/workshop', [WorkshopController, 'index'])
router.get('/workshop/:id', [WorkshopController, 'show'])
router
  .group(() => {
    router.patch('/files/:id', [WorkshopController, 'update'])
    router.delete('/files/:id', [WorkshopController, 'destroy'])
    // Batch metadata edit / recategorize / delete. Ungated like update/destroy
    // above — it's a metadata + DB surface, not a file upload.
    router.post('/batch', [WorkshopController, 'batch'])
    router.get('/files/:id/download', [WorkshopController, 'download'])
    router.get('/files/:id/thumbnail', [WorkshopController, 'thumbnail'])
    router.post('/scan', [WorkshopController, 'scan'])
    router.post('/acknowledge-rights', [WorkshopController, 'acknowledgeRights'])
    // Permission probe is intentionally NOT gated — the UI calls it from any
    // origin so it can render either the drop zone or the LAN-only note.
    router.get('/upload-permitted', [WorkshopController, 'uploadPermitted'])
    // The actual upload IS gated. The middleware enforces the same policy
    // the UI uses to decide whether to show the drop zone, so a client that
    // bypasses the UI still hits a 403 here.
    router.post('/upload', [WorkshopController, 'upload']).use(middleware.localNetworkOnly())
    // Manual thumbnail upload writes a PNG to disk, so gate it like /upload.
    router
      .post('/files/:id/thumbnail-upload', [WorkshopController, 'uploadThumbnail'])
      .use(middleware.localNetworkOnly())
  })
  .prefix('/api/workshop')

// Self-Reliance Suite — Inventory (Phase 1). Page GETs unguarded; the mutation
// group writes only DB rows (no files), so it is ungated like the Workshop
// single-row update/destroy.
router.get('/inventory', [InventoryController, 'index'])
router.get('/inventory/new', [InventoryController, 'new'])
router.get('/inventory/:id', [InventoryController, 'show'])
router
  .group(() => {
    router.post('/', [InventoryController, 'store'])
    router.patch('/:id', [InventoryController, 'update'])
    router.delete('/:id', [InventoryController, 'destroy'])
  })
  .prefix('/api/inventory')

// Self-Reliance Suite — Readiness Calculator (Phase 2). Read-only page; it
// stores no new stock (reads Inventory) and persists its household config via
// the existing PATCH /api/system/settings KV endpoint, so there is no new
// mutation route here. Ungated like the Inventory/Workshop page GETs.
router.get('/readiness', [ReadinessController, 'index'])

// Self-Reliance Suite — Scenario Plans (Phase 3). Editable, checkable
// per-scenario plans whose steps cross-link to inventory items, STL files, or
// ZIM articles. Page GETs unguarded; the mutation group writes only DB rows (no
// files), so it is ungated like the Inventory/Workshop single-row mutations.
// `/plans/new` precedes `/plans/:id` so the literal route wins over the param.
router.get('/plans', [ScenarioPlanController, 'index'])
router.get('/plans/new', [ScenarioPlanController, 'new'])
router.get('/plans/:id', [ScenarioPlanController, 'show'])
router
  .group(() => {
    // Plan mutations.
    router.post('/', [ScenarioPlanController, 'store'])
    router.patch('/:id', [ScenarioPlanController, 'update'])
    router.delete('/:id', [ScenarioPlanController, 'destroy'])
    // Step mutations, scoped under their plan.
    router.post('/:planId/steps', [ScenarioPlanController, 'storeStep'])
    router.patch('/:planId/steps/:id', [ScenarioPlanController, 'updateStep'])
    router.patch('/:planId/steps/:id/toggle', [ScenarioPlanController, 'toggleStep'])
    router.delete('/:planId/steps/:id', [ScenarioPlanController, 'destroyStep'])
  })
  .prefix('/api/plans')

router.on('/knowledge-base').redirectToPath('/chat?knowledge_base=true') // redirect for legacy knowledge-base links

router.get('/easy-setup', [EasySetupController, 'index'])
router.get('/easy-setup/complete', [EasySetupController, 'complete'])
router.get('/api/easy-setup/curated-categories', [EasySetupController, 'listCuratedCategories'])
router.post('/api/manifests/refresh', [EasySetupController, 'refreshManifests'])
router
  .group(() => {
    router.post('/check', [CollectionUpdatesController, 'checkForUpdates'])
    router.post('/apply', [CollectionUpdatesController, 'applyUpdate'])
    router.post('/apply-all', [CollectionUpdatesController, 'applyAllUpdates'])
  })
  .prefix('/api/content-updates')

router
  .group(() => {
    router.get('/system', [SettingsController, 'system'])
    router.get('/apps', [SettingsController, 'apps'])
    router.get('/legal', [SettingsController, 'legal'])
    router.get('/maps', [SettingsController, 'maps'])
    router.get('/models', [SettingsController, 'models'])
    router.get('/update', [SettingsController, 'update'])
    router.get('/zim', [SettingsController, 'zim'])
    router.get('/zim/remote-explorer', [SettingsController, 'zimRemote'])
    router.get('/benchmark', [SettingsController, 'benchmark'])
    router.get('/support', [SettingsController, 'support'])
  })
  .prefix('/settings')

router
  .group(() => {
    router.get('/:slug', [DocsController, 'show'])
    router.get('/', ({ response }) => {
      // redirect to /docs/home if accessing root
      response.redirect('/docs/home')
    })
  })
  .prefix('/docs')

router
  .group(() => {
    router.get('/regions', [MapsController, 'listRegions'])
    router.get('/styles', [MapsController, 'styles'])
    router.get('/curated-collections', [MapsController, 'listCuratedCollections'])
    router.post('/fetch-latest-collections', [MapsController, 'fetchLatestCollections'])
    router.post('/download-base-assets', [MapsController, 'downloadBaseAssets'])
    router.post('/download-remote', [MapsController, 'downloadRemote'])
    router.post('/download-remote-preflight', [MapsController, 'downloadRemotePreflight'])
    router.post('/download-collection', [MapsController, 'downloadCollection'])
    router.delete('/:filename', [MapsController, 'delete'])
  })
  .prefix('/api/maps')

router
  .group(() => {
    router.get('/list', [DocsController, 'list'])
  })
  .prefix('/api/docs')

router
  .group(() => {
    router.get('/jobs', [DownloadsController, 'index'])
    router.get('/jobs/:filetype', [DownloadsController, 'filetype'])
  })
  .prefix('/api/downloads')

router.get('/api/health', () => {
  return { status: 'ok' }
})

router
  .group(() => {
    router.post('/chat', [OllamaController, 'chat'])
    router.get('/models', [OllamaController, 'availableModels'])
    router.post('/models', [OllamaController, 'dispatchModelDownload'])
    router.delete('/models', [OllamaController, 'deleteModel'])
    router.get('/installed-models', [OllamaController, 'installedModels'])
  })
  .prefix('/api/ollama')

// Bridge from admin UI to host-side `nomad` CLI commands. The host's
// com.projectnomad.host-command-bridge LaunchAgent polls a directory on
// the bind-mounted storage volume; admin writes marker files here, the
// LaunchAgent runs the corresponding nomad command, writes a result file
// admin reads back via the status endpoint.
router
  .group(() => {
    router.post('/:cmd', [HostCommandsController, 'dispatch'])
    router.get('/:cmd', [HostCommandsController, 'status'])
  })
  .prefix('/api/host-commands')

router
  .group(() => {
    router.get('/', [ChatsController, 'index'])
    router.post('/', [ChatsController, 'store'])
    router.delete('/all', [ChatsController, 'destroyAll'])
    router.get('/:id', [ChatsController, 'show'])
    router.put('/:id', [ChatsController, 'update'])
    router.delete('/:id', [ChatsController, 'destroy'])
    router.post('/:id/messages', [ChatsController, 'addMessage'])
  })
  .prefix('/api/chat/sessions')

router.get('/api/chat/suggestions', [ChatsController, 'suggestions'])

router
  .group(() => {
    router.post('/upload', [RagController, 'upload'])
    router.get('/files', [RagController, 'getStoredFiles'])
    router.delete('/files', [RagController, 'deleteFile'])
    router.get('/active-jobs', [RagController, 'getActiveJobs'])
    router.get('/job-status', [RagController, 'getJobStatus'])
    router.post('/sync', [RagController, 'scanAndSync'])
  })
  .prefix('/api/rag')

router
  .group(() => {
    router.get('/debug-info', [SystemController, 'getDebugInfo'])
    router.get('/info', [SystemController, 'getSystemInfo'])
    router.get('/candidate-drive', [SystemController, 'getCandidateDrive'])
    router.get('/internet-status', [SystemController, 'getInternetStatus'])
    router.get('/services', [SystemController, 'getServices'])
    router.post('/services/affect', [SystemController, 'affectService'])
    router.post('/services/install', [SystemController, 'installService'])
    router.post('/services/force-reinstall', [SystemController, 'forceReinstallService'])
    router.post('/services/check-updates', [SystemController, 'checkServiceUpdates'])
    router.get('/services/:name/available-versions', [SystemController, 'getAvailableVersions'])
    router.post('/services/update', [SystemController, 'updateService'])
    router.post('/subscribe-release-notes', [SystemController, 'subscribeToReleaseNotes'])
    router.get('/latest-version', [SystemController, 'checkLatestVersion'])
    router.post('/update', [SystemController, 'requestSystemUpdate'])
    router.get('/update/status', [SystemController, 'getSystemUpdateStatus'])
    router.get('/update/logs', [SystemController, 'getSystemUpdateLogs'])
    router.get('/settings', [SettingsController, 'getSetting'])
    router.patch('/settings', [SettingsController, 'updateSetting'])
  })
  .prefix('/api/system')

router
  .group(() => {
    router.get('/list', [ZimController, 'list'])
    router.get('/list-remote', [ZimController, 'listRemote'])
    router.get('/curated-categories', [ZimController, 'listCuratedCategories'])
    router.post('/download-remote', [ZimController, 'downloadRemote'])
    router.post('/download-category-tier', [ZimController, 'downloadCategoryTier'])

    router.get('/wikipedia', [ZimController, 'getWikipediaState'])
    router.post('/wikipedia/select', [ZimController, 'selectWikipedia'])
    router.delete('/:filename', [ZimController, 'delete'])
  })
  .prefix('/api/zim')

router
  .group(() => {
    router.post('/run', [BenchmarkController, 'run'])
    router.post('/run/system', [BenchmarkController, 'runSystem'])
    router.post('/run/ai', [BenchmarkController, 'runAI'])
    router.get('/results', [BenchmarkController, 'results'])
    router.get('/results/latest', [BenchmarkController, 'latest'])
    router.get('/results/:id', [BenchmarkController, 'show'])
    router.post('/submit', [BenchmarkController, 'submit'])
    router.post('/builder-tag', [BenchmarkController, 'updateBuilderTag'])
    router.get('/comparison', [BenchmarkController, 'comparison'])
    router.get('/status', [BenchmarkController, 'status'])
    router.get('/settings', [BenchmarkController, 'settings'])
    router.post('/settings', [BenchmarkController, 'updateSettings'])
  })
  .prefix('/api/benchmark')
