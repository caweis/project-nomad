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
import GrocyController from '#controllers/grocy_controller'
import HomeController from '#controllers/home_controller'
import InventoryController from '#controllers/inventory_controller'
import MapsController from '#controllers/maps_controller'
import OllamaController from '#controllers/ollama_controller'
import ReadinessController from '#controllers/readiness_controller'
import ScenarioPlanController from '#controllers/scenario_plan_controller'
import HostCommandsController from '#controllers/host_commands_controller'
import MeshController from '#controllers/mesh_controller'
import RagController from '#controllers/rag_controller'
import SettingsController from '#controllers/settings_controller'
import SystemController from '#controllers/system_controller'
import CollectionUpdatesController from '#controllers/collection_updates_controller'
import ZimController from '#controllers/zim_controller'
import WorkshopController from '#controllers/workshop_controller'
import DrugReferenceController from '#controllers/drug_reference_controller'
import ConditionsController from '#controllers/conditions_controller'
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
    // PDF detail-view: individual page previews + extracted text (lazy fetch).
    router.get('/files/:id/pdf-page/:page', [WorkshopController, 'pdfPage'])
    router.get('/files/:id/pdf-text', [WorkshopController, 'pdfText'])
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

// Drug Reference v1 — offline FDA drug-label search.
// Page GETs ungated (read-only views). The /api/drug-reference group mirrors
// the /api/maps posture — no localNetworkOnly gate because the only disk write
// is the background ingest job (server-side, triggered but not executed inline).
// /drug-reference/interactions must precede /drug-reference/:id so the literal
// path wins over the param route.
router.get('/drug-reference', [DrugReferenceController, 'index'])
router.get('/drug-reference/interactions', [DrugReferenceController, 'interactions'])
router.get('/drug-reference/:id', [DrugReferenceController, 'show'])
router
  .group(() => {
    router.get('/search', [DrugReferenceController, 'search'])
    router.get('/status', [DrugReferenceController, 'status'])
    router.get('/interactions', [DrugReferenceController, 'interactionsApi'])
    router.post('/download', [DrugReferenceController, 'download'])
    router.post('/ingest', [DrugReferenceController, 'ingest'])
    router.post('/reset-ingest', [DrugReferenceController, 'resetIngest'])
    router.get('/ingest-log', [DrugReferenceController, 'ingestLog'])
  })
  .prefix('/api/drug-reference')

// "When to use what" — condition-first medical reference (Phase 1).
// Browse a curated grid of first-aid situations (or free-text search a
// situation) and see the matching OTC drugs, each linking to its Drug Reference
// detail. Read-only page GETs, ungated like the /drug-reference page GETs; the
// /api/conditions group only reads drug_labels (no disk write), so it mirrors
// the ungated /api/drug-reference posture.
router.get('/conditions', [ConditionsController, 'index'])
router.get('/conditions/:slug', [ConditionsController, 'show'])
router
  .group(() => {
    router.get('/drugs', [ConditionsController, 'drugsApi'])
  })
  .prefix('/api/conditions')

// Self-Reliance Suite — Inventory (Phase 1). The inventory LIST now lives as
// the "Inventory" tab of the Preparedness (ReadinessController supplies the
// list), so the bare /inventory list route redirects there (any old bookmark
// still lands in the tab). The create (/inventory/new) and detail
// (/inventory/:id) pages stay standalone. Page GETs unguarded; the mutation
// group writes only DB rows (no files), so it is ungated like the Workshop
// single-row update/destroy. `/inventory/new` precedes `/inventory/:id` so the
// literal route wins over the param.
router.on('/inventory').redirectToPath('/readiness?tab=inventory')
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

// Self-Reliance Suite — Scenario Plans (Phase 3). The plans list now lives as
// the "Scenario Plans" tab of the Preparedness, so the bare /plans list
// route redirects there (any old bookmark still lands in the tab). The create
// (/plans/new) and detail (/plans/:id) pages stay standalone. Page GETs
// unguarded; the mutation group writes only DB rows (no files), so it is ungated
// like the Inventory/Workshop single-row mutations. `/plans/new` precedes
// `/plans/:id` so the literal route wins over the param.
router.on('/plans').redirectToPath('/readiness?tab=plans')
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
    router.get('/grocy', [GrocyController, 'settings'])
  })
  .prefix('/settings')

// Supply Depot — additive card view of the app catalog (issue #31). Top-level
// route, NOT under /settings: the canonical table page stays at /settings/apps
// until a human verifies this card view renders on the host. Same controller,
// same props as settings/apps (SettingsController.buildSupplyDepotProps).
router.get('/supply-depot', [SettingsController, 'supplyDepot'])

router.post('/api/grocy/test-connection', [GrocyController, 'testConnection'])

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
    // Dispatch writes a host-command marker that a privileged LaunchAgent executes —
    // gate it to local-network callers (same posture as the Workshop upload route).
    // The read-only status GET stays ungated to match the fork's existing posture.
    router.post('/:cmd', [HostCommandsController, 'dispatch']).use(middleware.localNetworkOnly())
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

// Mesh Bridge admin console (P4). The page GET is gated by the controller
// (404 when the Mesh service isn't installed, like /chat). The read APIs
// (status, messages) follow the fork's GET posture — ungated. POST /api/mesh/send
// keys a RADIO TRANSMISSION, so it carries localNetworkOnly() — the same posture
// as the mutating #32 custom-app routes and the Workshop upload precedent.
router.get('/mesh', [MeshController, 'inertia'])
router
  .group(() => {
    router.get('/status', [MeshController, 'status'])
    router.get('/messages', [MeshController, 'messages'])
    router.post('/send', [MeshController, 'send']).use(middleware.localNetworkOnly())
  })
  .prefix('/api/mesh')

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
    // Mutating service routes drive container install / start-stop / reinstall / update
    // through the mounted Docker socket (DooD) — a host-takeover blast radius. Gate every
    // one to local-network callers, matching the Workshop upload precedent. Read-only GETs
    // (getServices, getAvailableVersions) stay ungated to match the fork's existing posture.
    router.get('/services', [SystemController, 'getServices'])
    router
      .post('/services/affect', [SystemController, 'affectService'])
      .use(middleware.localNetworkOnly())
    router
      .post('/services/install', [SystemController, 'installService'])
      .use(middleware.localNetworkOnly())
    router
      .post('/services/force-reinstall', [SystemController, 'forceReinstallService'])
      .use(middleware.localNetworkOnly())
    router
      .post('/services/check-updates', [SystemController, 'checkServiceUpdates'])
      .use(middleware.localNetworkOnly())
    router.get('/services/:name/available-versions', [SystemController, 'getAvailableVersions'])
    router
      .post('/services/update', [SystemController, 'updateService'])
      .use(middleware.localNetworkOnly())

    // ── Supply Depot: custom-app routes ──────────────────────────────────────
    // Read-only preflight / inspection follow the fork's GET posture (ungated). The
    // mutating routes (create / update / pull-latest / delete / custom-url / auto-update)
    // drive container lifecycle through the Docker socket, so each carries the
    // localNetworkOnly gate — the same posture as install / affect / update above.
    router.get('/services/preflight', [SystemController, 'preflightCheck'])
    router.get('/services/suggest-port', [SystemController, 'suggestCustomPort'])
    router.post('/services/preflight-custom', [SystemController, 'preflightCustomApp'])
    router
      .post('/services/custom', [SystemController, 'createCustomApp'])
      .use(middleware.localNetworkOnly())
    router
      .put('/services/custom', [SystemController, 'updateCustomApp'])
      .use(middleware.localNetworkOnly())
    router
      .post('/services/custom/update', [SystemController, 'updateCustomApp_pullLatest'])
      .use(middleware.localNetworkOnly())
    router
      .delete('/services/custom', [SystemController, 'deleteCustomApp'])
      .use(middleware.localNetworkOnly())
    router.get('/services/custom/:name', [SystemController, 'getCustomApp'])
    router
      .put('/services/custom-url', [SystemController, 'setServiceCustomUrl'])
      .use(middleware.localNetworkOnly())
    router
      .post('/services/auto-update', [SystemController, 'setServiceAutoUpdate'])
      .use(middleware.localNetworkOnly())
    router.get('/services/:name/logs', [SystemController, 'getServiceLogs'])
    router.get('/services/:name/stats', [SystemController, 'getServiceStats'])

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
