import Service from '#models/service'
import { inject } from '@adonisjs/core'
import { DockerService } from '#services/docker_service'
import { ServiceSlim } from '../../types/services.js'
import logger from '@adonisjs/core/services/logger'
import si from 'systeminformation'
import { CandidateDriveResponse, GpuHealthStatus, NomadDiskInfo, NomadDiskInfoRaw, SystemInformationResponse } from '../../types/system.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { readFileSync } from 'fs'
import fs from 'node:fs/promises'
import path, { join } from 'path'
import { getAllFilesystems, getFile } from '../utils/fs.js'
import axios from 'axios'
import env from '#start/env'
import KVStore from '#models/kv_store'
import { KV_STORE_SCHEMA, KVStoreKey } from '../../types/kv_store.js'
import { isNewerVersion } from '../utils/version.js'
import { CUSTOM_PORT_START, nextFreeCustomPort } from '#services/custom_app_ports'
import { KiwixLibraryService } from '#services/kiwix_library_service'


// Marker the host's drive-detect agent writes when a non-active, full-library
// project-nomad drive is plugged in (and removes otherwise). Lives on the
// bind-mounted storage volume — `process.cwd()` is /app in the container, so
// this resolves to /app/storage/.candidate-drive.json (host
// ${NOMAD_DATA_ROOT}/storage/.candidate-drive.json). Same base as
// ollama_service.ts's MODELS_CACHE_FILE.
const CANDIDATE_DRIVE_FILE = path.join(process.cwd(), 'storage', '.candidate-drive.json')

@inject()
export class SystemService {
  private static appVersion: string | null = null
  private static diskInfoFile = '/storage/nomad-disk-info.json'

  constructor(private dockerService: DockerService) { }

  async checkServiceInstalled(serviceName: string): Promise<boolean> {
    const services = await this.getServices({ installedOnly: true });
    return services.some(service => service.service_name === serviceName);
  }

  async getInternetStatus(): Promise<boolean> {
    const DEFAULT_TEST_URL = 'https://1.1.1.1/cdn-cgi/trace'
    const MAX_ATTEMPTS = 3

    let testUrl = DEFAULT_TEST_URL
    let customTestUrl = env.get('INTERNET_STATUS_TEST_URL')?.trim()

    // check that customTestUrl is a valid URL, if provided
    if (customTestUrl && customTestUrl !== '') {
      try {
        new URL(customTestUrl)
        testUrl = customTestUrl
      } catch (error) {
        logger.warn(
          `Invalid INTERNET_STATUS_TEST_URL: ${customTestUrl}. Falling back to default URL.`
        )
      }
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await axios.get(testUrl, { timeout: 5000 })
        return res.status === 200
      } catch (error) {
        logger.warn(
          `Internet status check attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error instanceof Error ? error.message : error}`
        )

        if (attempt < MAX_ATTEMPTS) {
          // delay before next attempt
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }

    logger.warn('All internet status check attempts failed.')
    return false
  }

  /**
   * Reads the candidate-drive marker the host's drive-detect agent maintains.
   * The marker exists ONLY when a non-active, full-library project-nomad drive
   * is plugged in, so "marker present" ⟺ "a drive is available to adopt".
   *
   * Fully defensive: a missing file (ENOENT), an unreadable file, or
   * unparseable / malformed JSON all return `{ available: false }`. It never
   * throws, so the polling banner degrades to "no drive" rather than erroring.
   */
  async getCandidateDrive(): Promise<CandidateDriveResponse> {
    let raw: string
    try {
      raw = await fs.readFile(CANDIDATE_DRIVE_FILE, 'utf-8')
    } catch {
      // ENOENT (no drive) is the common case; any other read error is also
      // treated as "no candidate" — never surface an error to the banner.
      return { available: false }
    }

    try {
      const parsed = JSON.parse(raw)
      // Only trust the marker if it carries the two fields the banner needs.
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.path === 'string' &&
        parsed.path.trim() !== '' &&
        typeof parsed.label === 'string' &&
        parsed.label.trim() !== ''
      ) {
        return {
          available: true,
          path: parsed.path,
          label: parsed.label,
          detectedAt: typeof parsed.detected_at === 'string' ? parsed.detected_at : undefined,
        }
      }
    } catch {
      // Malformed JSON — fall through to "no candidate".
    }

    return { available: false }
  }

  async getNvidiaSmiInfo(): Promise<Array<{ vendor: string; model: string; vram: number; }> | { error: string } | 'OLLAMA_NOT_FOUND' | 'BAD_RESPONSE' | 'UNKNOWN_ERROR'> {
    try {
      const containers = await this.dockerService.docker.listContainers({ all: false })
      const ollamaContainer = containers.find((c) =>
        c.Names.includes(`/${SERVICE_NAMES.OLLAMA}`)
      )
      if (!ollamaContainer) {
        logger.info('Ollama container not found for nvidia-smi info retrieval. This is expected if Ollama is not installed.')
        return 'OLLAMA_NOT_FOUND'
      }

      // Execute nvidia-smi inside the Ollama container to get GPU info
      const container = this.dockerService.docker.getContainer(ollamaContainer.Id)
      const exec = await container.exec({
        Cmd: ['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      })

      // Read the output stream with a timeout to prevent hanging if nvidia-smi fails
      const stream = await exec.start({ Tty: true })
      const output = await new Promise<string>((resolve) => {
        let data = ''
        const timeout = setTimeout(() => resolve(data), 5000)
        stream.on('data', (chunk: Buffer) => { data += chunk.toString() })
        stream.on('end', () => { clearTimeout(timeout); resolve(data) })
      })

      // Remove any non-printable characters and trim the output
      const cleaned = output.replace(/[\x00-\x08]/g, '').trim()
      if (cleaned && !cleaned.toLowerCase().includes('error') && !cleaned.toLowerCase().includes('not found')) {
        // Split by newlines to handle multiple GPUs installed
        const lines = cleaned.split('\n').filter(line => line.trim())

        // Map each line out to a useful structure for us
        const gpus = lines.map(line => {
          const parts = line.split(',').map((s) => s.trim())
          return {
            vendor: 'NVIDIA',
            model: parts[0] || 'NVIDIA GPU',
            vram: parts[1] ? parseInt(parts[1], 10) : 0,
          }
        })

        return gpus.length > 0 ? gpus : 'BAD_RESPONSE'
      }

      // If we got output but looks like an error, consider it a bad response from nvidia-smi
      return 'BAD_RESPONSE'
    }
    catch (error) {
      logger.error('Error getting nvidia-smi info:', error)
      if (error instanceof Error && error.message) {
        return { error: error.message }
      }
      return 'UNKNOWN_ERROR'
    }
  }

  async getServices({ installedOnly = true }: { installedOnly?: boolean }): Promise<ServiceSlim[]> {
    await this._syncContainersWithDatabase() // Sync up before fetching to ensure we have the latest status

    const query = Service.query()
      .orderBy('display_order', 'asc')
      .orderBy('friendly_name', 'asc')
      .select(
        'id',
        'service_name',
        'installed',
        'installation_status',
        'ui_location',
        'friendly_name',
        'description',
        'icon',
        'powered_by',
        'display_order',
        'container_image',
        'available_update_version',
        'category',
        'is_custom',
        'custom_url',
        'auto_update_enabled'
      )
      .where('is_dependency_service', false)
    if (installedOnly) {
      query.where('installed', true)
    }

    const services = await query
    if (!services || services.length === 0) {
      return []
    }

    const statuses = await this.dockerService.getServicesStatus()

    const toReturn: ServiceSlim[] = []

    for (const service of services) {
      const status = statuses.find((s) => s.service_name === service.service_name)
      toReturn.push({
        id: service.id,
        service_name: service.service_name,
        friendly_name: service.friendly_name,
        description: service.description,
        icon: service.icon,
        // These columns are MySQL tinyints; Lucid returns them as 0/1, not
        // true/false. Cast to real booleans so the Inertia payload matches the
        // ServiceSlim type — otherwise `{record.is_custom && (...)}` in the UI
        // renders a literal "0" for every non-custom app.
        installed: Boolean(service.installed),
        installation_status: service.installation_status,
        status: status ? status.status : 'unknown',
        ui_location: service.ui_location || '',
        powered_by: service.powered_by,
        display_order: service.display_order,
        container_image: service.container_image,
        available_update_version: service.available_update_version,
        category: service.category,
        is_custom: Boolean(service.is_custom),
        custom_url: service.custom_url,
        auto_update_enabled: Boolean(service.auto_update_enabled),
      })
    }

    return toReturn
  }

  static getAppVersion(): string {
    try {
      if (this.appVersion) {
        return this.appVersion
      }

      // Return 'dev' for development environment (version.json won't exist)
      if (process.env.NODE_ENV === 'development') {
        this.appVersion = 'dev'
        return 'dev'
      }

      const packageJson = readFileSync(join(process.cwd(), 'version.json'), 'utf-8')
      const packageData = JSON.parse(packageJson)

      const version = packageData.version || '0.0.0'

      this.appVersion = version
      return version
    } catch (error) {
      logger.error('Error getting app version:', error)
      return '0.0.0'
    }
  }

  async getSystemInfo(): Promise<SystemInformationResponse | undefined> {
    try {
      const [cpu, mem, os, currentLoad, fsSize, uptime, graphics] = await Promise.all([
        si.cpu(),
        si.mem(),
        si.osInfo(),
        si.currentLoad(),
        si.fsSize(),
        si.time(),
        si.graphics(),
      ])

      let diskInfo: NomadDiskInfoRaw | undefined
      let disk: NomadDiskInfo[] = []

      try {
        const diskInfoRawString = await getFile(
          path.join(process.cwd(), SystemService.diskInfoFile),
          'string'
        )

        diskInfo = (
          diskInfoRawString
            ? JSON.parse(diskInfoRawString.toString())
            : { diskLayout: { blockdevices: [] }, fsSize: [] }
        ) as NomadDiskInfoRaw

        disk = this.calculateDiskUsage(diskInfo)
      } catch (error) {
        logger.error('Error reading disk info file:', error)
      }

      // GPU health tracking — detect when host has NVIDIA GPU but Ollama can't access it
      let gpuHealth: GpuHealthStatus = {
        status: 'no_gpu',
        hasNvidiaRuntime: false,
        ollamaGpuAccessible: false,
      }

      // Query Docker API for host-level info (hostname, OS, GPU runtime)
      // si.osInfo() returns the container's info inside Docker, not the host's
      try {
        const dockerInfo = await this.dockerService.docker.info()

        if (dockerInfo.Name) {
          os.hostname = dockerInfo.Name
        }
        if (dockerInfo.OperatingSystem) {
          os.distro = dockerInfo.OperatingSystem
        }
        if (dockerInfo.KernelVersion) {
          os.kernel = dockerInfo.KernelVersion
        }

        // Check for Apple Silicon (native Ollama with Metal GPU)
        const isAppleSilicon =
          (dockerInfo.Architecture === 'aarch64' && dockerInfo.OperatingSystem?.includes('Docker Desktop')) ||
          (os.platform === 'darwin' && os.arch === 'arm64')

        if (isAppleSilicon) {
          gpuHealth.hasAppleMetal = true

          // Override OS info — si.osInfo() returns container info, not the host's macOS
          os.platform = 'darwin'
          os.distro = 'macOS'
          os.arch = 'arm64'

          // Get actual macOS version and hardware details from the host via Docker
          if (dockerInfo.OperatingSystem?.includes('Docker Desktop')) {
            os.distro = 'macOS (via Docker Desktop)'
          }

          // Get hostname from Docker
          if (dockerInfo.Name && dockerInfo.Name !== 'docker-desktop') {
            os.hostname = dockerInfo.Name
          }

          // Fix CPU info — si.cpu() returns empty manufacturer/brand inside Docker on macOS.
          // First-best is the env-var APPLE_CHIP_MODEL (set by the macOS installer from
          // system_profiler SPHardwareDataType on the host), since the host knows its exact
          // chip name ("Apple M2 Pro") which the container cannot determine on its own.
          if (!cpu.manufacturer || cpu.manufacturer === '-' || cpu.manufacturer.trim() === '') {
            cpu.manufacturer = 'Apple'
            const chipModelOverride = env.get('APPLE_CHIP_MODEL')
            if (chipModelOverride && chipModelOverride.trim() !== '') {
              cpu.brand = chipModelOverride.trim()
            } else {
              // Fallback: construct a descriptive brand from core count
              const coreCount = cpu.physicalCores || cpu.cores || 0
              cpu.brand = `Apple Silicon (${coreCount}-core)`
            }
          }

          // If native Ollama is configured, Metal GPU is accessible
          if (DockerService.isNativeOllama()) {
            gpuHealth.status = 'apple_metal'
            gpuHealth.ollamaGpuAccessible = true

            // Populate graphics controllers with Apple Silicon GPU info.
            // Prefer APPLE_GPU_MODEL env-var when set (the host installer captures it from
            // system_profiler SPDisplaysDataType, e.g. "Apple M2 Pro" or
            // "Apple M3 Max (40-core GPU)") — that's more precise than what si.cpu().brand
            // can tell us from inside the container.
            if (!graphics.controllers || graphics.controllers.length === 0) {
              const gpuModelOverride = env.get('APPLE_GPU_MODEL')
              const gpuLabel = (gpuModelOverride && gpuModelOverride.trim() !== '')
                ? gpuModelOverride.trim()
                : (cpu.brand || `Apple Silicon (${cpu.physicalCores || cpu.cores}-core)`)
              graphics.controllers = [{
                model: `${gpuLabel} GPU (Metal)`,
                vendor: 'Apple',
                bus: 'Built-In',
                vram: 0, // Apple Silicon uses unified memory — VRAM = system RAM
                vramDynamic: true,
              }]
            }
          } else {
            // Apple Silicon detected but Ollama is in Docker (no Metal access)
            gpuHealth.status = 'no_gpu'
            gpuHealth.ollamaGpuAccessible = false
          }
        } else {
          // Non-Apple: check for NVIDIA/AMD GPUs
          // If si.graphics() returned no controllers (common inside Docker),
          // fall back to nvidia runtime + nvidia-smi detection
          if (!graphics.controllers || graphics.controllers.length === 0) {
            const runtimes = dockerInfo.Runtimes || {}
            if ('nvidia' in runtimes) {
              gpuHealth.hasNvidiaRuntime = true
              const nvidiaInfo = await this.getNvidiaSmiInfo()
              if (Array.isArray(nvidiaInfo)) {
                graphics.controllers = nvidiaInfo.map((gpu) => ({
                  model: gpu.model,
                  vendor: gpu.vendor,
                  bus: "",
                  vram: gpu.vram,
                  vramDynamic: false,
                }))
                gpuHealth.status = 'ok'
                gpuHealth.ollamaGpuAccessible = true
              } else if (nvidiaInfo === 'OLLAMA_NOT_FOUND') {
                gpuHealth.status = 'ollama_not_installed'
              } else {
                gpuHealth.status = 'passthrough_failed'
                logger.warn(`NVIDIA runtime detected but GPU passthrough failed: ${typeof nvidiaInfo === 'string' ? nvidiaInfo : JSON.stringify(nvidiaInfo)}`)
              }
            }
          } else {
            // si.graphics() returned controllers (host install, not Docker) — GPU is working
            gpuHealth.status = 'ok'
            gpuHealth.ollamaGpuAccessible = true
          }
        }
      } catch {
        // Docker info query failed, skip host-level enrichment
      }

      return {
        cpu,
        mem,
        os,
        disk,
        currentLoad,
        fsSize,
        uptime,
        graphics,
        gpuHealth,
      }
    } catch (error) {
      logger.error('Error getting system info:', error)
      return undefined
    }
  }

  async checkLatestVersion(force?: boolean): Promise<{
    success: boolean
    updateAvailable: boolean
    currentVersion: string
    latestVersion: string
    message?: string
  }> {
    try {
      const currentVersion = SystemService.getAppVersion()
      const cachedUpdateAvailable = await KVStore.getValue('system.updateAvailable')
      const cachedLatestVersion = await KVStore.getValue('system.latestVersion')

      // Use cached values if not forcing a fresh check.
      // the CheckUpdateJob will update these values every 12 hours
      if (!force) {
        return {
          success: true,
          updateAvailable: cachedUpdateAvailable ?? false,
          currentVersion,
          latestVersion: cachedLatestVersion || '',
        }
      }

      const earlyAccess = (await KVStore.getValue('system.earlyAccess')) ?? false

      let latestVersion: string
      if (earlyAccess) {
        const response = await axios.get(
          'https://api.github.com/repos/Crosstalk-Solutions/project-nomad/releases',
          { headers: { Accept: 'application/vnd.github+json' }, timeout: 5000 }
        )
        if (!response?.data?.length) throw new Error('No releases found')
        latestVersion = response.data[0].tag_name.replace(/^v/, '').trim()
      } else {
        const response = await axios.get(
          'https://api.github.com/repos/Crosstalk-Solutions/project-nomad/releases/latest',
          { headers: { Accept: 'application/vnd.github+json' }, timeout: 5000 }
        )
        if (!response?.data?.tag_name) throw new Error('Invalid response from GitHub API')
        latestVersion = response.data.tag_name.replace(/^v/, '').trim()
      }

      logger.info(`Current version: ${currentVersion}, Latest version: ${latestVersion}`)

      const updateAvailable = process.env.NODE_ENV === 'development'
        ? false
        : isNewerVersion(latestVersion, currentVersion.trim(), earlyAccess)

      // Cache the results in KVStore for frontend checks
      await KVStore.setValue('system.updateAvailable', updateAvailable)
      await KVStore.setValue('system.latestVersion', latestVersion)

      return {
        success: true,
        updateAvailable,
        currentVersion,
        latestVersion,
      }
    } catch (error) {
      logger.error('Error checking latest version:', error)
      return {
        success: false,
        updateAvailable: false,
        currentVersion: '',
        latestVersion: '',
        message: `Failed to check latest version: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  async subscribeToReleaseNotes(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await axios.post(
        'https://api.projectnomad.us/api/v1/lists/release-notes/subscribe',
        { email },
        { timeout: 5000 }
      )

      if (response.status === 200) {
        return {
          success: true,
          message: 'Successfully subscribed to release notes',
        }
      }

      return {
        success: false,
        message: `Failed to subscribe: ${response.statusText}`,
      }
    } catch (error) {
      logger.error('Error subscribing to release notes:', error)
      return {
        success: false,
        message: `Failed to subscribe: ${error instanceof Error ? error.message : error}`,
      }
    }
  }

  async getDebugInfo(): Promise<string> {
    const appVersion = SystemService.getAppVersion()
    const environment = process.env.NODE_ENV || 'unknown'

    const [systemInfo, services, internetStatus, versionCheck] = await Promise.all([
      this.getSystemInfo(),
      this.getServices({ installedOnly: false }),
      this.getInternetStatus().catch(() => null),
      this.checkLatestVersion().catch(() => null),
    ])

    // Diagnostics for common support cases: storage relocation (#1050), the
    // container/updater path (#858), Kiwix library state, and the auto-update
    // trilogy. Best-effort — one failure never blanks the bundle. Ported from
    // upstream #1102 (the GPU-passthrough field is dropped: this fork runs native
    // Apple Metal, not Docker GPU passthrough).
    const [dockerVersion, hostStorageRoot, kiwixBookCount] = await Promise.all([
      this.dockerService.docker
        .version()
        .then((v: any) => v?.Version ?? null)
        .catch(() => null),
      this.dockerService.getHostStorageRoot().catch(() => null),
      new KiwixLibraryService().getBookCount().catch(() => null),
    ])
    const [autoUpdateCore, autoUpdateApps, autoUpdateContent, autoDisabledReason] =
      await Promise.all([
        KVStore.getValue('autoUpdate.enabled').catch(() => null),
        KVStore.getValue('appAutoUpdate.enabled').catch(() => null),
        KVStore.getValue('contentAutoUpdate.enabled').catch(() => null),
        KVStore.getValue('autoUpdate.autoDisabledReason').catch(() => null),
      ])
    const isEnabled = (v: any) => v === true || v === 'true'

    const lines: string[] = [
      'Project NOMAD Debug Info',
      '========================',
      `App Version: ${appVersion}`,
      `Environment: ${environment}`,
    ]

    if (systemInfo) {
      const { cpu, mem, os, disk, fsSize, uptime, graphics } = systemInfo

      lines.push('')
      lines.push('System:')
      if (os.distro) lines.push(`  OS: ${os.distro}`)
      if (os.hostname) lines.push(`  Hostname: ${os.hostname}`)
      if (os.kernel) lines.push(`  Kernel: ${os.kernel}`)
      if (os.arch) lines.push(`  Architecture: ${os.arch}`)
      if (dockerVersion) lines.push(`  Docker Engine: ${dockerVersion}`)
      if (uptime?.uptime) lines.push(`  Uptime: ${this._formatUptime(uptime.uptime)}`)

      lines.push('')
      lines.push('Hardware:')
      if (cpu.brand) {
        lines.push(`  CPU: ${cpu.brand} (${cpu.cores} cores)`)
      }
      if (mem.total) {
        const total = this._formatBytes(mem.total)
        const used = this._formatBytes(mem.total - (mem.available || 0))
        const available = this._formatBytes(mem.available || 0)
        lines.push(`  RAM: ${total} total, ${used} used, ${available} available`)
      }
      if (graphics.controllers && graphics.controllers.length > 0) {
        for (const gpu of graphics.controllers) {
          const vram = gpu.vram ? ` (${gpu.vram} MB VRAM)` : ''
          lines.push(`  GPU: ${gpu.model}${vram}`)
        }
      } else {
        lines.push('  GPU: None detected')
      }

      // Disk info — try disk array first, fall back to fsSize
      const diskEntries = disk.filter((d) => d.totalSize > 0)
      if (diskEntries.length > 0) {
        for (const d of diskEntries) {
          const size = this._formatBytes(d.totalSize)
          const type = d.tran?.toUpperCase() || (d.rota ? 'HDD' : 'SSD')
          lines.push(`  Disk: ${size}, ${Math.round(d.percentUsed)}% used, ${type}`)
        }
      } else if (fsSize.length > 0) {
        const realFs = fsSize.filter((f) => f.fs.startsWith('/dev/'))
        const seen = new Set<number>()
        for (const f of realFs) {
          if (seen.has(f.size)) continue
          seen.add(f.size)
          lines.push(`  Disk: ${this._formatBytes(f.size)}, ${Math.round(f.use)}% used`)
        }
      }
    }

    lines.push('')
    lines.push('Storage:')
    lines.push(`  Host storage root: ${hostStorageRoot ?? 'unknown'}`)
    lines.push('  Container path: /app/storage')
    const storageEnv = process.env.NOMAD_STORAGE_PATH
    lines.push(
      `  NOMAD_STORAGE_PATH: ${storageEnv ? storageEnv : 'not set (auto-detected from admin mount)'}`
    )
    if (kiwixBookCount !== null) {
      lines.push(
        `  Kiwix library: ${kiwixBookCount === 0 ? 'empty (0 books)' : `${kiwixBookCount} book(s)`}`
      )
    }

    const installed = services.filter((s) => s.installed)
    lines.push('')
    if (installed.length > 0) {
      lines.push('Installed Services:')
      for (const svc of installed) {
        lines.push(`  ${svc.friendly_name} (${svc.service_name}): ${svc.status}`)
      }
    } else {
      lines.push('Installed Services: None')
    }

    if (internetStatus !== null) {
      lines.push('')
      lines.push(`Internet Status: ${internetStatus ? 'Online' : 'Offline'}`)
    }

    if (versionCheck?.success) {
      const updateMsg = versionCheck.updateAvailable
        ? `Yes (${versionCheck.latestVersion} available)`
        : `No (${versionCheck.currentVersion} is latest)`
      lines.push(`Update Available: ${updateMsg}`)
    }

    lines.push('')
    lines.push('Auto-Update:')
    lines.push(`  Core: ${isEnabled(autoUpdateCore) ? 'Enabled' : 'Disabled'}`)
    lines.push(`  Apps: ${isEnabled(autoUpdateApps) ? 'Enabled' : 'Disabled'}`)
    lines.push(`  Content: ${isEnabled(autoUpdateContent) ? 'Enabled' : 'Disabled'}`)
    if (autoDisabledReason) {
      lines.push(`  Auto-disabled reason: ${autoDisabledReason}`)
    }

    return lines.join('\n')
  }

  private _formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  private _formatBytes(bytes: number, decimals = 1): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
  }

  async updateSetting(key: KVStoreKey, value: any): Promise<void> {
    if ((value === '' || value === undefined || value === null) && KV_STORE_SCHEMA[key] === 'string') {
      await KVStore.clearValue(key)
    } else {
      await KVStore.setValue(key, value)
    }
  }

  /**
   * Checks the current state of Docker containers against the database records and updates the database accordingly.
   * It will mark services as not installed if their corresponding containers do not exist, regardless of their running state.
   * Handles cases where a container might have been manually removed, ensuring the database reflects the actual existence of containers.
   * Containers that exist but are stopped, paused, or restarting will still be considered installed.
   */
  private async _syncContainersWithDatabase() {
    try {
      const allServices = await Service.all()
      const serviceStatusList = await this.dockerService.getServicesStatus()

      for (const service of allServices) {
        // Skip sync for native Ollama — it has no Docker container
        if (service.service_name === SERVICE_NAMES.OLLAMA && DockerService.isNativeOllama()) {
          continue
        }

        const containerExists = serviceStatusList.find(
          (s) => s.service_name === service.service_name
        )

        if (service.installed) {
          // If marked as installed but container doesn't exist, mark as not installed
          if (!containerExists) {
            logger.warn(
              `Service ${service.service_name} is marked as installed but container does not exist. Marking as not installed.`
            )
            service.installed = false
            service.installation_status = 'idle'
            await service.save()
          }
        } else {
          // If marked as not installed but container exists (any state), mark as installed
          if (containerExists) {
            logger.warn(
              `Service ${service.service_name} is marked as not installed but container exists. Marking as installed.`
            )
            service.installed = true
            service.installation_status = 'idle'
            await service.save()
          }
        }
      }
    } catch (error) {
      logger.error('Error syncing containers with database:', error)
    }
  }

  private calculateDiskUsage(diskInfo: NomadDiskInfoRaw): NomadDiskInfo[] {
    const { diskLayout, fsSize } = diskInfo

    if (!diskLayout?.blockdevices || !fsSize) {
      return []
    }

    return diskLayout.blockdevices
      .filter((disk) => disk.type === 'disk') // Only physical disks
      .map((disk) => {
        const filesystems = getAllFilesystems(disk, fsSize)

        // Across all partitions
        const totalUsed = filesystems.reduce((sum, p) => sum + (p.used || 0), 0)
        const totalSize = filesystems.reduce((sum, p) => sum + (p.size || 0), 0)
        const percentUsed = totalSize > 0 ? (totalUsed / totalSize) * 100 : 0

        return {
          name: disk.name,
          model: disk.model || 'Unknown',
          vendor: disk.vendor || '',
          rota: disk.rota || false,
          tran: disk.tran || '',
          size: disk.size,
          totalUsed,
          totalSize,
          percentUsed: Math.round(percentUsed * 100) / 100,
          filesystems: filesystems.map((p) => ({
            fs: p.fs,
            mount: p.mount,
            used: p.used,
            size: p.size,
            percentUsed: p.use,
          })),
        }
      })
  }

  /**
   * Check whether the host has enough free memory and disk to comfortably run an app.
   * Returns an array of human-readable warning strings; an empty array means no concerns.
   * These are advisory only — the caller decides whether to block or warn.
   */
  async checkResourceWarnings(minMemoryMB: number, minDiskMB: number): Promise<string[]> {
    const warnings: string[] = []

    try {
      const mem = await si.mem()
      const availableMB = Math.floor(mem.available / 1024 / 1024)
      if (availableMB < minMemoryMB) {
        warnings.push(
          `Low memory: ${availableMB} MB available, this app recommends at least ${minMemoryMB} MB free.`
        )
      }
    } catch (err: any) {
      logger.warn(`[SystemService] checkResourceWarnings mem check failed: ${err.message}`)
    }

    try {
      const storagePath = env.get('NOMAD_STORAGE_PATH', '/opt/project-nomad/storage')
      const fsSizes = await si.fsSize()
      // Find the filesystem whose mount point is the longest prefix of storagePath
      const fs = fsSizes
        .filter((f) => storagePath.startsWith(f.mount))
        .sort((a, b) => b.mount.length - a.mount.length)[0]

      if (fs) {
        const availableDiskMB = Math.floor((fs.size - fs.used) / 1024 / 1024)
        if (availableDiskMB < minDiskMB) {
          warnings.push(
            `Low disk space: ${availableDiskMB} MB available on ${fs.mount}, this app recommends at least ${minDiskMB} MB free.`
          )
        }
      }
    } catch (err: any) {
      logger.warn(`[SystemService] checkResourceWarnings disk check failed: ${err.message}`)
    }

    return warnings
  }

  /**
   * Return the next suggested host port for a custom app in the 8600+ range.
   * Looks at existing custom service records and all Docker container port bindings.
   */
  async getNextSuggestedCustomPort(): Promise<number> {
    const occupied = new Set<number>()

    try {
      // Ports used by existing custom services in the DB
      const customServices = await Service.query().where('is_custom', true)
      for (const svc of customServices) {
        const config = svc.container_config ? JSON.parse(svc.container_config) : null
        const bindings = config?.HostConfig?.PortBindings ?? {}
        for (const binding of Object.values(bindings) as any[]) {
          const port = parseInt(binding?.[0]?.HostPort, 10)
          if (!isNaN(port)) occupied.add(port)
        }
      }

      // Ports used by any running Docker container in the 8600+ range
      const containers = await this.dockerService.docker.listContainers({ all: true })
      for (const c of containers) {
        for (const p of c.Ports) {
          if (p.PublicPort && p.PublicPort >= CUSTOM_PORT_START) occupied.add(p.PublicPort)
        }
      }
    } catch (err: any) {
      logger.warn(`[SystemService] getNextSuggestedCustomPort probe failed: ${err.message}`)
    }

    return nextFreeCustomPort(occupied)
  }

}
