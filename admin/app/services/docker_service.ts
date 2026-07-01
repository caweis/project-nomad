import Service from '#models/service'
import Docker from 'dockerode'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import transmit from '@adonisjs/transmit/services/main'
import { doResumableDownloadWithRetry } from '../utils/downloads.js'
import { join } from 'path'
import { ZIM_STORAGE_PATH, MESHCORE_WEB_STORAGE_PATH, VAULTWARDEN_STORAGE_PATH } from '../utils/fs.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { KiwixLibraryService } from './kiwix_library_service.js'
import { KIWIX_LIBRARY_CMD } from '../../constants/kiwix.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, access, chmod, writeFile } from 'node:fs/promises'
import KVStore from '#models/kv_store'
import { BROADCAST_CHANNELS } from '../../constants/broadcast.js'
import env from '#start/env'
import os from 'node:os'
import { humanizeDockerError } from './docker_errors.js'
import { rewriteStorageBinds } from './storage_binds.js'
import { followPullProgress, pullableImageRef } from './docker_pull.js'
import { vaultwardenNeedsTlsMigration } from './vaultwarden_tls.js'

@inject()
export class DockerService {
  public docker: Docker
  // Shared across ALL instances (static), because the controller is resolved
  // per-request and jobs construct `new DockerService()` per call — a per-instance
  // guard never sees a concurrent operation started by another request, which let
  // two simultaneous Update clicks race on the same container (Docker 304/400, #931).
  // A process-wide set makes the in-progress guard actually mutually exclusive.
  private static activeInstallations: Set<string> = new Set()
  public static NOMAD_NETWORK = 'project-nomad_default'
  public static ADMIN_CONTAINER_NAME = 'nomad_admin'

  // Resolved once: the host filesystem path backing the admin's /app/storage
  // mount. Child-service binds are rewritten to live under this so relocating
  // the admin storage volume relocates every child app too (#938). null = not
  // yet resolved.
  private _hostStorageRoot: string | null = null

  constructor() {
    // Support both Linux (production) and Windows (development with Docker Desktop)
    const isWindows = process.platform === 'win32'
    if (isWindows) {
      // Windows Docker Desktop uses named pipe
      this.docker = new Docker({ socketPath: '//./pipe/docker_engine' })
    } else {
      // Linux uses Unix socket
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' })
    }
  }

  async affectContainer(
    serviceName: string,
    action: 'start' | 'stop' | 'restart'
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Native Ollama cannot be managed via Docker
      if (serviceName === SERVICE_NAMES.OLLAMA && DockerService.isNativeOllama()) {
        return {
          success: false,
          message: `Ollama is running natively (not in Docker). Please manage it directly via the 'ollama' CLI or system service.`,
        }
      }

      const service = await Service.query().where('service_name', serviceName).first()
      if (!service || !service.installed) {
        return {
          success: false,
          message: `Service ${serviceName} not found or not installed`,
        }
      }

      const containers = await this.docker.listContainers({ all: true })
      const container = containers.find((c) => c.Names.includes(`/${serviceName}`))
      if (!container) {
        return {
          success: false,
          message: `Container for service ${serviceName} not found`,
        }
      }

      const dockerContainer = this.docker.getContainer(container.Id)
      if (action === 'stop') {
        await dockerContainer.stop()
        return {
          success: true,
          message: `Service ${serviceName} stopped successfully`,
        }
      }

      if (action === 'restart') {
        // Kiwix legacy→library migration intercept: restarting a still-glob-mode
        // kiwix container migrates it to library mode (a non-destructive recreation)
        // instead, so the switch happens the next time it restarts for any reason.
        if (serviceName === SERVICE_NAMES.KIWIX && (await this.isKiwixOnLegacyConfig())) {
          logger.info(
            '[DockerService] Kiwix on legacy glob config — running migration instead of restart.'
          )
          await this.migrateKiwixToLibraryMode()
          return { success: true, message: 'Kiwix migrated to library mode successfully.' }
        }
        await dockerContainer.restart()

        return {
          success: true,
          message: `Service ${serviceName} restarted successfully`,
        }
      }

      if (action === 'start') {
        if (container.State === 'running') {
          return {
            success: true,
            message: `Service ${serviceName} is already running`,
          }
        }

        await dockerContainer.start()

        return {
          success: true,
          message: `Service ${serviceName} started successfully`,
        }
      }

      return {
        success: false,
        message: `Invalid action: ${action}. Use 'start', 'stop', or 'restart'.`,
      }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] Error controlling service ${serviceName}`)
      return {
        success: false,
        message: `Failed to ${action} service ${serviceName}. Check server logs for details.`,
      }
    }
  }

  /**
   * Fetches the status of all Docker containers related to Nomad services. (those prefixed with 'nomad_')
   */
  async getServicesStatus(): Promise<
    {
      service_name: string
      status: string
    }[]
  > {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const containerMap = new Map<string, Docker.ContainerInfo>()
      containers.forEach((container) => {
        const name = container.Names[0]?.replace('/', '')
        if (name && name.startsWith('nomad_')) {
          containerMap.set(name, container)
        }
      })

      const statuses = Array.from(containerMap.entries()).map(([name, container]) => ({
        service_name: name,
        status: container.State,
      }))

      // If native Ollama is configured, check its status via HTTP
      if (DockerService.isNativeOllama()) {
        const nativeUrl = env.get('OLLAMA_HOST')!
        let ollamaStatus = 'exited'
        try {
          const axios = (await import('axios')).default
          const response = await axios.get(`${nativeUrl}/api/tags`, { timeout: 3000 })
          if (response.status === 200) {
            ollamaStatus = 'running'
          }
        } catch {
          ollamaStatus = 'exited'
        }

        // Add or replace the Ollama entry
        const existingIdx = statuses.findIndex((s) => s.service_name === SERVICE_NAMES.OLLAMA)
        if (existingIdx >= 0) {
          statuses[existingIdx].status = ollamaStatus
        } else {
          statuses.push({ service_name: SERVICE_NAMES.OLLAMA, status: ollamaStatus })
        }
      }

      return statuses
    } catch (error) {
      logger.error(`Error fetching services status: ${error.message}`)
      return []
    }
  }

  /**
   * Get the URL to access a service based on its configuration.
   * Attempts to return a docker-internal URL using the service name and exposed port.
   * @param serviceName - The name of the service to get the URL for.
   * @returns - The URL as a string, or null if it cannot be determined.
   */
  /**
   * Check if Ollama is configured to run natively (outside Docker).
   */
  static isNativeOllama(): boolean {
    return !!env.get('OLLAMA_HOST')
  }

  async getServiceURL(serviceName: string): Promise<string | null> {
    if (!serviceName || serviceName.trim() === '') {
      return null
    }

    // If native Ollama is configured, return the native URL directly
    if (serviceName === SERVICE_NAMES.OLLAMA && DockerService.isNativeOllama()) {
      return env.get('OLLAMA_HOST')!
    }

    const service = await Service.query()
      .where('service_name', serviceName)
      .andWhere('installed', true)
      .first()

    if (!service) {
      return null
    }

    const hostname = process.env.NODE_ENV === 'production' ? serviceName : 'localhost'

    // First, check if ui_location is set and is a valid port number
    if (service.ui_location && parseInt(service.ui_location, 10)) {
      return `http://${hostname}:${service.ui_location}`
    }

    // Next, try to extract a host port from container_config
    const parsedConfig = this._parseContainerConfig(service.container_config)
    if (parsedConfig?.HostConfig?.PortBindings) {
      const portBindings = parsedConfig.HostConfig.PortBindings
      const hostPorts = Object.values(portBindings)
      if (!hostPorts || !Array.isArray(hostPorts) || hostPorts.length === 0) {
        return null
      }

      const hostPortsArray = hostPorts.flat() as { HostPort: string }[]
      const hostPortsStrings = hostPortsArray.map((binding) => binding.HostPort)
      if (hostPortsStrings.length > 0) {
        return `http://${hostname}:${hostPortsStrings[0]}`
      }
    }

    // Otherwise, return null if we can't determine a URL
    return null
  }

  async createContainerPreflight(
    serviceName: string
  ): Promise<{ success: boolean; message: string }> {
    const service = await Service.query().where('service_name', serviceName).first()
    if (!service) {
      return {
        success: false,
        message: `Service ${serviceName} not found`,
      }
    }

    if (service.installed) {
      return {
        success: false,
        message: `Service ${serviceName} is already installed`,
      }
    }

    // Check if installation is already in progress (database-level)
    if (service.installation_status === 'installing') {
      return {
        success: false,
        message: `Service ${serviceName} installation is already in progress`,
      }
    }

    // Double-check with in-memory tracking (race condition protection)
    if (DockerService.activeInstallations.has(serviceName)) {
      return {
        success: false,
        message: `Service ${serviceName} installation is already in progress`,
      }
    }

    // Mark installation as in progress. activeInstallations is a process-wide
    // static guard, so it MUST be released on any failure below or the service
    // wedges permanently as "in progress" until a process restart.
    DockerService.activeInstallations.add(serviceName)
    service.installation_status = 'installing'
    try {
      await service.save()

      // Check if a service wasn't marked as installed but has an existing container
      // This can happen if the service was created but not properly installed
      // or if the container was removed manually without updating the service status.
      // if (await this._checkIfServiceContainerExists(serviceName)) {
      //   const removeResult = await this._removeServiceContainer(serviceName);
      //   if (!removeResult.success) {
      //     return {
      //       success: false,
      //       message: `Failed to remove existing container for service ${serviceName}: ${removeResult.message}`,
      //     };
      //   }
      // }

      const containerConfig = this._parseContainerConfig(service.container_config)

      // Execute installation asynchronously and handle cleanup
      this._createContainer(service, containerConfig).catch(async (error) => {
        logger.error(`Installation failed for ${serviceName}: ${error.message}`)
        await this._cleanupFailedInstallation(serviceName)
      })

      return {
        success: true,
        message: `Service ${serviceName} installation initiated successfully. You can receive updates via server-sent events.`,
      }
    } catch (error: any) {
      // service.save() or the container-config parse threw before _createContainer
      // launched — release the guard + reset status, mirroring forceReinstall, so
      // the install can be retried.
      logger.error(`Preflight failed for ${serviceName}: ${error.message}`)
      await this._cleanupFailedInstallation(serviceName)
      return {
        success: false,
        message: `Failed to start installation for ${serviceName}: ${error.message}`,
      }
    }
  }

  /**
   * Force reinstall a service by stopping, removing, and recreating its container.
   * This method will also clear any associated volumes/data.
   * Handles edge cases gracefully (e.g., container not running, container not found).
   */
  async forceReinstall(serviceName: string): Promise<{ success: boolean; message: string }> {
    try {
      const service = await Service.query().where('service_name', serviceName).first()
      if (!service) {
        return {
          success: false,
          message: `Service ${serviceName} not found`,
        }
      }

      // Check if installation is already in progress
      if (DockerService.activeInstallations.has(serviceName)) {
        return {
          success: false,
          message: `Service ${serviceName} installation is already in progress`,
        }
      }

      // Mark as installing to prevent concurrent operations
      DockerService.activeInstallations.add(serviceName)
      service.installation_status = 'installing'
      await service.save()

      this._broadcast(
        serviceName,
        'reinstall-starting',
        `Starting force reinstall for ${serviceName}...`
      )

      // Step 1: Try to stop and remove the container if it exists
      try {
        const containers = await this.docker.listContainers({ all: true })
        const container = containers.find((c) => c.Names.includes(`/${serviceName}`))

        if (container) {
          const dockerContainer = this.docker.getContainer(container.Id)

          // Only try to stop if it's running
          if (container.State === 'running') {
            this._broadcast(serviceName, 'stopping', `Stopping container...`)
            await dockerContainer.stop({ t: 10 }).catch((error) => {
              // If already stopped, continue
              if (!error.message.includes('already stopped')) {
                logger.warn(`Error stopping container: ${error.message}`)
              }
            })
          }

          // Step 2: Remove the container
          this._broadcast(serviceName, 'removing', `Removing container...`)
          await dockerContainer.remove({ force: true }).catch((error) => {
            logger.warn(`Error removing container: ${error.message}`)
          })
        } else {
          this._broadcast(
            serviceName,
            'no-container',
            `No existing container found, proceeding with installation...`
          )
        }
      } catch (error: any) {
        logger.warn({ err: error }, `[DockerService] Error during container cleanup for ${serviceName}`)
        this._broadcast(serviceName, 'cleanup-warning', 'Warning during container cleanup. Check server logs for details.')
      }

      // Step 3: Clear volumes/data if needed
      try {
        this._broadcast(serviceName, 'clearing-volumes', `Checking for volumes to clear...`)
        const volumes = await this.docker.listVolumes()
        const serviceVolumes =
          volumes.Volumes?.filter(
            (v) => v.Name.includes(serviceName) || v.Labels?.service === serviceName
          ) || []

        for (const vol of serviceVolumes) {
          try {
            const volume = this.docker.getVolume(vol.Name)
            await volume.remove({ force: true })
            this._broadcast(serviceName, 'volume-removed', `Removed volume: ${vol.Name}`)
          } catch (error) {
            logger.warn(`Failed to remove volume ${vol.Name}: ${error.message}`)
          }
        }

        if (serviceVolumes.length === 0) {
          this._broadcast(serviceName, 'no-volumes', `No volumes found to clear`)
        }
      } catch (error: any) {
        logger.warn({ err: error }, `[DockerService] Error during volume cleanup for ${serviceName}`)
        this._broadcast(
          serviceName,
          'volume-cleanup-warning',
          'Warning during volume cleanup. Check server logs for details.'
        )
      }

      // Step 4: Mark service as uninstalled
      service.installed = false
      service.installation_status = 'installing'
      await service.save()

      // Step 5: Recreate the container
      this._broadcast(serviceName, 'recreating', `Recreating container...`)
      const containerConfig = this._parseContainerConfig(service.container_config)

      // Execute installation asynchronously and handle cleanup
      this._createContainer(service, containerConfig).catch(async (error) => {
        logger.error(`Reinstallation failed for ${serviceName}: ${error.message}`)
        await this._cleanupFailedInstallation(serviceName)
      })

      return {
        success: true,
        message: `Service ${serviceName} force reinstall initiated successfully. You can receive updates via server-sent events.`,
      }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] Force reinstall failed for ${serviceName}`)
      await this._cleanupFailedInstallation(serviceName)
      return {
        success: false,
        message: `Failed to force reinstall service ${serviceName}. Check server logs for details.`,
      }
    }
  }

  /**
   * One-time, idempotent migration of an existing Vaultwarden install to HTTPS,
   * run at boot (bin/server.ts).
   *
   * Vaultwarden's HTTPS support (ROCKET_TLS + a self-signed cert) landed after
   * some installs already existed. `nomad upgrade` reseeds the catalog row — so
   * its container_config gains ROCKET_TLS and ui_location becomes https:8700 —
   * but it does NOT recreate the already-running container. The row then says
   * HTTPS while the live container still serves plain HTTP, so the Open link
   * (now https) hits an HTTP server and fails. This recreates the container from
   * the current catalog config so TLS actually takes effect.
   *
   * Safe by construction:
   *  - Idempotent: a no-op unless Vaultwarden is installed, has a container, and
   *    that container does NOT already carry ROCKET_TLS.
   *  - Data-safe: the vault is a host bind mount (storage/vaultwarden:/data), not
   *    a Docker volume, so it carries across the container swap untouched.
   *  - Rollback-safe: the pre-TLS container is renamed aside and, if the new one
   *    fails to come up, restored and restarted, so the vault is never left down.
   *  - `_createContainer` mints the self-signed RSA cert (via the Vaultwarden
   *    preinstall) before it starts the new container.
   */
  async reconcileVaultwardenTls(): Promise<void> {
    const serviceName = SERVICE_NAMES.VAULTWARDEN

    const service = await Service.query().where('service_name', serviceName).first()
    if (!service || !service.installed) return

    const containers = await this.docker.listContainers({ all: true })
    const existing = containers.find((c) => c.Names.includes(`/${serviceName}`))
    if (!existing) return

    const inspect = await this.docker.getContainer(existing.Id).inspect()
    const containerEnv = inspect.Config?.Env || []
    if (
      !vaultwardenNeedsTlsMigration({
        installed: service.installed,
        hasContainer: true,
        containerEnv,
      })
    ) {
      return
    }

    // Don't race a manual install/reinstall already in flight.
    if (DockerService.activeInstallations.has(serviceName)) return
    DockerService.activeInstallations.add(serviceName)

    const oldName = `${serviceName}_pretls`
    try {
      logger.info(
        `[DockerService] Migrating ${serviceName} to HTTPS — recreating the container so ROCKET_TLS takes effect.`
      )

      const oldContainer = this.docker.getContainer(existing.Id)
      if (existing.State === 'running') {
        await oldContainer.stop({ t: 15 }).catch(() => {})
      }

      // Clear any aside container left by a previously failed migration so the
      // rename below can't collide.
      const staleAside = (await this.docker.listContainers({ all: true })).find((c) =>
        c.Names.includes(`/${oldName}`)
      )
      if (staleAside) {
        await this.docker.getContainer(staleAside.Id).remove({ force: true }).catch(() => {})
      }

      // Keep the pre-TLS container aside as a rollback target.
      await oldContainer.rename({ name: oldName })

      try {
        // Recreate from the current catalog config (now carries ROCKET_TLS). The
        // /data bind mount is unchanged, so the vault DB carries over; the
        // preinstall inside _createContainer mints the cert before the start.
        await this._createContainer(service, this._parseContainerConfig(service.container_config))

        // New container is up — drop the pre-TLS one.
        await this.docker.getContainer(oldName).remove({ force: true }).catch(() => {})
        logger.info(`[DockerService] ${serviceName} is now serving HTTPS.`)
      } catch (createError: any) {
        logger.error(
          { err: createError },
          `[DockerService] HTTPS migration for ${serviceName} failed — rolling back to the pre-TLS container.`
        )
        // Remove any half-created new container holding the real name, then
        // restore the pre-TLS container and start it so the vault stays up.
        const half = (await this.docker.listContainers({ all: true })).find((c) =>
          c.Names.includes(`/${serviceName}`)
        )
        if (half) {
          await this.docker.getContainer(half.Id).remove({ force: true }).catch(() => {})
        }
        const aside = (await this.docker.listContainers({ all: true })).find((c) =>
          c.Names.includes(`/${oldName}`)
        )
        if (aside) {
          const restore = this.docker.getContainer(aside.Id)
          await restore.rename({ name: serviceName }).catch(() => {})
          await restore.start().catch(() => {})
        }
      }
    } catch (error: any) {
      logger.error(
        { err: error },
        `[DockerService] reconcileVaultwardenTls failed for ${serviceName}`
      )
    } finally {
      DockerService.activeInstallations.delete(serviceName)
    }
  }

  /**
   * Handles the long-running process of creating a Docker container for a service.
   * NOTE: This method should not be called directly. Instead, use `createContainerPreflight` to check prerequisites first
   * This method will also transmit server-sent events to the client to notify of progress.
   * @param serviceName
   * @returns
   */
  /**
   * Resolve the host filesystem path that backs the admin container's storage
   * directory (`/app/storage`). Child services are created via the Docker
   * socket, so their bind mounts need the path on the *host*, not inside the
   * admin container. Deriving it from the admin's own mount means whatever host
   * path the admin storage volume is mapped to in compose, child apps follow it
   * automatically (#938).
   *
   * On the macOS fork the seeded prefix is NOMAD_STORAGE_PATH, which the
   * installer substitutes to the user's actual install dir
   * (NOMAD_DIR_PLACEHOLDER/storage), so the fallback/default below only applies
   * when the env var is genuinely absent. Falls back to NOMAD_STORAGE_PATH / the
   * default if the admin container or its storage mount can't be inspected.
   */
  private async _resolveHostStorageRoot(): Promise<string> {
    if (this._hostStorageRoot) return this._hostStorageRoot
    const fallback = env.get('NOMAD_STORAGE_PATH', '/opt/project-nomad/storage')
    try {
      const adminStorageDest = join(process.cwd(), '/storage') // e.g. /app/storage
      const containers = await this.docker.listContainers({ all: true })
      // Prefer the well-known admin container name; fall back to matching this
      // process's own container by hostname (Docker defaults it to the short id).
      let adminInfo = containers.find((c) =>
        c.Names.includes(`/${DockerService.ADMIN_CONTAINER_NAME}`)
      )
      if (!adminInfo) {
        const hn = os.hostname()
        adminInfo = containers.find((c) => c.Id.startsWith(hn))
      }
      if (!adminInfo) return (this._hostStorageRoot = fallback)

      const inspected = await this.docker.getContainer(adminInfo.Id).inspect()
      const mount = (inspected.Mounts ?? []).find(
        (m: any) => m.Type === 'bind' && m.Destination === adminStorageDest
      )
      if (mount?.Source) {
        logger.info(`[DockerService] Resolved host storage root from admin mount: ${mount.Source}`)
        return (this._hostStorageRoot = mount.Source)
      }
      return (this._hostStorageRoot = fallback)
    } catch (err: any) {
      logger.warn(
        `[DockerService] Could not resolve host storage root, using fallback ${fallback}: ${err.message}`
      )
      return fallback
    }
  }

  /**
   * Rewrite the host side of a service's storage bind mounts so they point at
   * the resolved host storage root. The seeded binds use the default/env prefix;
   * if the admin storage actually lives elsewhere on the host, swap that prefix
   * so the child container mounts the same physical location (#938). No-op when
   * the resolved root matches the seeded prefix (the common case). Delegates the
   * pure prefix-swap to `rewriteStorageBinds` so it can be tested standalone.
   */
  private async _applyHostStorageRoot(containerConfig: any): Promise<void> {
    const binds: string[] | undefined = containerConfig?.HostConfig?.Binds
    if (!binds?.length) return
    const seededRoot = env.get('NOMAD_STORAGE_PATH', '/opt/project-nomad/storage')
    const root = await this._resolveHostStorageRoot()
    if (root === seededRoot) return
    containerConfig.HostConfig.Binds = rewriteStorageBinds(binds, root, seededRoot)
  }

  /**
   * Translate low-level dockerode errors into something a non-technical user can
   * act on. Currently handles host port conflicts — the most common install
   * failure, where a service can't bind its port because something on the host
   * already holds it (classic case: a native Ollama install owns 11434). Returns
   * the original message unchanged for anything we don't recognize. (#934)
   *
   * Delegates to the pure `humanizeDockerError` mapper so the mapping is unit-
   * tested standalone; this wrapper just supplies the fork's Ollama service name.
   */
  private _humanizeDockerError(error: any, serviceName: string): string {
    const raw: string = error?.message ?? String(error)
    return humanizeDockerError(raw, serviceName, SERVICE_NAMES.OLLAMA)
  }

  async _createContainer(
    service: Service & { dependencies?: Service[] },
    containerConfig: any
  ): Promise<void> {
    try {
      this._broadcast(service.service_name, 'initializing', '')

      // Point storage binds at wherever the admin's storage volume actually
      // lives on the host (covers dependency installs too — they recurse here).
      await this._applyHostStorageRoot(containerConfig)

      let dependencies = []
      if (service.depends_on) {
        const dependency = await Service.query().where('service_name', service.depends_on).first()
        if (dependency) {
          dependencies.push(dependency)
        }
      }

      // First, check if the service has any dependencies that need to be installed first
      if (dependencies && dependencies.length > 0) {
        this._broadcast(
          service.service_name,
          'checking-dependencies',
          `Checking dependencies for service ${service.service_name}...`
        )
        for (const dependency of dependencies) {
          if (!dependency.installed) {
            this._broadcast(
              service.service_name,
              'dependency-not-installed',
              `Dependency service ${dependency.service_name} is not installed. Installing it first...`
            )
            await this._createContainer(
              dependency,
              this._parseContainerConfig(dependency.container_config)
            )
          } else {
            this._broadcast(
              service.service_name,
              'dependency-installed',
              `Dependency service ${dependency.service_name} is already installed.`
            )
          }
        }
      }

      const imageExists = await this._checkImageExists(service.container_image)
      if (imageExists) {
        this._broadcast(
          service.service_name,
          'image-exists',
          `Docker image ${service.container_image} already exists locally. Skipping pull...`
        )
      } else {
        // Start pulling the Docker image and wait for it to complete
        this._broadcast(
          service.service_name,
          'pulling',
          `Pulling Docker image ${service.container_image}...`
        )
        await this.pullImage(service.container_image)
      }

      if (service.service_name === SERVICE_NAMES.KIWIX) {
        await this._runPreinstallActions__KiwixServe()
        this._broadcast(
          service.service_name,
          'preinstall-complete',
          `Pre-install actions for Kiwix Serve completed successfully.`
        )
      }

      if (service.service_name === SERVICE_NAMES.MESHCORE_WEB) {
        await this._runPreinstallActions__MeshCoreWeb()
        this._broadcast(
          service.service_name,
          'preinstall-complete',
          `Pre-install actions for MeshCore Web completed successfully.`
        )
      }

      if (service.service_name === SERVICE_NAMES.VAULTWARDEN) {
        await this._runPreinstallActions__Vaultwarden()
        this._broadcast(
          service.service_name,
          'preinstall-complete',
          `Pre-install actions for Password Vault completed successfully.`
        )
      }

      // Native Ollama: skip container creation entirely, just mark as installed
      if (service.service_name === SERVICE_NAMES.OLLAMA && DockerService.isNativeOllama()) {
        const nativeUrl = env.get('OLLAMA_HOST')!
        this._broadcast(
          service.service_name,
          'native-ollama',
          `Native Ollama configured at ${nativeUrl}. Skipping Docker container creation...`
        )

        // Verify native Ollama is reachable
        try {
          const axios = (await import('axios')).default
          await axios.get(`${nativeUrl}/api/tags`, { timeout: 5000 })
          this._broadcast(service.service_name, 'native-ollama', `Native Ollama is reachable at ${nativeUrl}`)
        } catch {
          this._broadcast(
            service.service_name,
            'native-ollama-warning',
            `Warning: Native Ollama at ${nativeUrl} is not reachable. Make sure Ollama is running.`
          )
        }

        service.installed = true
        service.installation_status = 'idle'
        await service.save()
        DockerService.activeInstallations.delete(service.service_name)

        // Trigger Nomad docs discovery
        logger.info('[DockerService] Native Ollama configured. Triggering Nomad docs discovery...')
        await KVStore.setValue('chat.suggestionsEnabled', false)
        const ollamaService = new (await import('./ollama_service.js')).OllamaService()
        const ragService = new (await import('./rag_service.js')).RagService(this, ollamaService)
        ragService.discoverNomadDocs().catch((error) => {
          logger.error('[DockerService] Failed to discover Nomad docs:', error)
        })

        this._broadcast(service.service_name, 'completed', `Native Ollama setup completed successfully.`)
        return
      }

      // GPU-aware configuration for Ollama
      let finalImage = service.container_image
      let gpuHostConfig = containerConfig?.HostConfig || {}

      // Default RestartPolicy: unless-stopped. Without this, dynamic
      // services created via this code path (Kiwix, Kolibri, Cyberchef,
      // Flatnotes, Qdrant, etc.) have NO restart policy and stay dead
      // after any exit — including Mac reboots and Docker daemon restarts.
      // The compose-managed services (admin, mysql, redis, dozzle,
      // updater, admin-worker) already get unless-stopped from compose.yaml;
      // this aligns dynamic services with that behavior. Caller can still
      // override via containerConfig.HostConfig.RestartPolicy if needed.
      if (!gpuHostConfig.RestartPolicy?.Name) {
        gpuHostConfig.RestartPolicy = { Name: 'unless-stopped', MaximumRetryCount: 0 }
      }

      if (service.service_name === SERVICE_NAMES.OLLAMA) {
        const gpuResult = await this._detectGPUType()

        if (gpuResult.type === 'nvidia') {
          this._broadcast(
            service.service_name,
            'gpu-config',
            `NVIDIA container runtime detected. Configuring container with GPU support...`
          )

          // Add GPU support for NVIDIA
          gpuHostConfig = {
            ...gpuHostConfig,
            DeviceRequests: [
              {
                Driver: 'nvidia',
                Count: -1, // -1 means all GPUs
                Capabilities: [['gpu']],
              },
            ],
          }
        } else if (gpuResult.type === 'amd') {
          this._broadcast(
            service.service_name,
            'gpu-config',
            `AMD GPU detected. ROCm GPU acceleration is not yet supported in this version — proceeding with CPU-only configuration. GPU support for AMD will be available in a future update.`
          )
          logger.warn('[DockerService] AMD GPU detected but ROCm support is not yet enabled. Using CPU-only configuration.')
          // TODO: Re-enable AMD GPU support once ROCm image and device discovery are validated.
          // When re-enabling:
          //   1. Switch image to 'ollama/ollama:rocm'
          //   2. Restore _discoverAMDDevices() to map /dev/kfd and /dev/dri/* into the container
        } else if (gpuResult.toolkitMissing) {
          this._broadcast(
            service.service_name,
            'gpu-config',
            `NVIDIA GPU detected but NVIDIA Container Toolkit is not installed. Using CPU-only configuration. Install the toolkit and reinstall AI Assistant for GPU acceleration: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html`
          )
        } else {
          this._broadcast(
            service.service_name,
            'gpu-config',
            `No GPU detected. Using CPU-only configuration...`
          )
        }
      }

      this._broadcast(
        service.service_name,
        'creating',
        `Creating Docker container for service ${service.service_name}...`
      )
      const container = await this.docker.createContainer({
        Image: finalImage,
        name: service.service_name,
        ...(containerConfig?.User && { User: containerConfig.User }),
        HostConfig: gpuHostConfig,
        ...(containerConfig?.WorkingDir && { WorkingDir: containerConfig.WorkingDir }),
        ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
        ...(containerConfig?.Env && { Env: containerConfig.Env }),
        ...(service.container_command ? { Cmd: service.container_command.split(' ') } : {}),
        // Ensure container is attached to the Nomad docker network in production
        ...(process.env.NODE_ENV === 'production' && {
          NetworkingConfig: {
            EndpointsConfig: {
              [DockerService.NOMAD_NETWORK]: {},
            },
          },
        }),
      })

      this._broadcast(
        service.service_name,
        'starting',
        `Starting Docker container for service ${service.service_name}...`
      )
      await container.start()

      this._broadcast(
        service.service_name,
        'finalizing',
        `Finalizing installation of service ${service.service_name}...`
      )
      service.installed = true
      service.installation_status = 'idle'
      await service.save()

      // Remove from active installs tracking
      DockerService.activeInstallations.delete(service.service_name)

      // If Ollama was just installed, trigger Nomad docs discovery and embedding
      if (service.service_name === SERVICE_NAMES.OLLAMA) {
        logger.info('[DockerService] Ollama installation complete. Default behavior is to not enable chat suggestions.')
        await KVStore.setValue('chat.suggestionsEnabled', false)

        logger.info('[DockerService] Ollama installation complete. Triggering Nomad docs discovery...')
        
        // Need to use dynamic imports here to avoid circular dependency
        const ollamaService = new (await import('./ollama_service.js')).OllamaService()
        const ragService = new (await import('./rag_service.js')).RagService(this, ollamaService)

        ragService.discoverNomadDocs().catch((error) => {
          logger.error('[DockerService] Failed to discover Nomad docs:', error)
        })
      }

      this._broadcast(
        service.service_name,
        'completed',
        `Service ${service.service_name} installation completed successfully.`
      )
    } catch (error) {
      const friendly = this._humanizeDockerError(error, service.service_name)
      // Log the RAW error (message + stack) at error level so it lands in the
      // admin container logs (`nomad logs admin` / dozzle). The broadcast only
      // reaches the browser; without this a failed pull leaves no server trace.
      logger.error(
        { err: error },
        `[DockerService] Install failed for ${service.service_name} (image ${service.container_image}): ${friendly}`
      )
      this._broadcast(
        service.service_name,
        'error',
        `Error installing service ${service.service_name}: ${friendly}`
      )
      // Mark install as failed and cleanup
      await this._cleanupFailedInstallation(service.service_name)
      throw new Error(`Failed to install service ${service.service_name}: ${friendly}`)
    }
  }

  async _checkIfServiceContainerExists(serviceName: string): Promise<boolean> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      return containers.some((container) => container.Names.includes(`/${serviceName}`))
    } catch (error) {
      logger.error(`Error checking if service container exists: ${error.message}`)
      return false
    }
  }

  async _removeServiceContainer(
    serviceName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const container = containers.find((c) => c.Names.includes(`/${serviceName}`))
      if (!container) {
        return { success: false, message: `Container for service ${serviceName} not found` }
      }

      const dockerContainer = this.docker.getContainer(container.Id)
      await dockerContainer.remove({ force: true })

      return { success: true, message: `Service ${serviceName} container removed successfully` }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] Error removing service container ${serviceName}`)
      return {
        success: false,
        message: `Failed to remove service ${serviceName} container. Check server logs for details.`,
      }
    }
  }

  private async _runPreinstallActions__KiwixServe(): Promise<void> {
    /**
     * At least one .zim file must be available before we can start the kiwix container.
     * We'll download the lightweight mini Wikipedia Top 100 zim file for this purpose.
     **/
    const WIKIPEDIA_ZIM_URL =
      'https://github.com/Crosstalk-Solutions/project-nomad/raw/refs/heads/main/install/wikipedia_en_100_mini_2025-06.zim'
    const filename = 'wikipedia_en_100_mini_2025-06.zim'
    const filepath = join(process.cwd(), ZIM_STORAGE_PATH, filename)
    logger.info(`[DockerService] Kiwix Serve pre-install: Downloading ZIM file to ${filepath}`)

    this._broadcast(
      SERVICE_NAMES.KIWIX,
      'preinstall',
      `Running pre-install actions for Kiwix Serve...`
    )
    this._broadcast(
      SERVICE_NAMES.KIWIX,
      'preinstall',
      `Downloading Wikipedia ZIM file from ${WIKIPEDIA_ZIM_URL}. This may take some time...`
    )

    try {
      await doResumableDownloadWithRetry({
        url: WIKIPEDIA_ZIM_URL,
        filepath,
        timeout: 60000,
        allowedMimeTypes: [
          'application/x-zim',
          'application/x-openzim',
          'application/octet-stream',
        ],
      })

      this._broadcast(
        SERVICE_NAMES.KIWIX,
        'preinstall',
        `Downloaded Wikipedia ZIM file to ${filepath}`
      )
    } catch (error) {
      this._broadcast(
        SERVICE_NAMES.KIWIX,
        'preinstall-error',
        `Failed to download Wikipedia ZIM file: ${error.message}`
      )
      throw new Error(`Pre-install action failed: ${error.message}`)
    }
  }

  /**
   * Ensure a self-signed TLS cert (cert.pem + key.pem) exists in `certDir`, generating one if not.
   * Used by apps that need a secure (HTTPS) context but run on a LAN appliance with no public DNS to
   * get a trusted cert for. Idempotent: an existing pair is left untouched, so the cert is stable
   * across reinstalls (no fresh browser warning each time) and a cert an admin swapped in by hand is
   * never clobbered. The private key is locked to 0600; the cert stays world-readable.
   */
  private async _ensureSelfSignedCert(
    certDir: string,
    commonName: string
  ): Promise<{ certPath: string; keyPath: string }> {
    const certPath = join(certDir, 'cert.pem')
    const keyPath = join(certDir, 'key.pem')

    await mkdir(certDir, { recursive: true })

    const alreadyHasCert = await Promise.all([
      access(certPath)
        .then(() => true)
        .catch(() => false),
      access(keyPath)
        .then(() => true)
        .catch(() => false),
    ]).then(([c, k]) => c && k)

    if (alreadyHasCert) return { certPath, keyPath }

    // 10-year self-signed cert. CN/SAN are cosmetic for a self-signed cert (the browser warns
    // regardless), but a SAN keeps it structurally valid for clients that require one.
    const execAsync = promisify(exec)
    await execAsync(
      `openssl req -x509 -newkey rsa:2048 -nodes ` +
        `-keyout "${keyPath}" -out "${certPath}" -days 3650 ` +
        `-subj "/CN=${commonName}" ` +
        `-addext "subjectAltName=DNS:nomad,DNS:localhost"`
    )

    await chmod(keyPath, 0o600)
    await chmod(certPath, 0o644)

    return { certPath, keyPath }
  }

  /**
   * The MeshCore web client (aXistem's prebuilt image) is stock nginx serving a static Flutter build
   * over plain HTTP. The client reaches a radio over Web Bluetooth / Web Serial, which browsers only
   * permit from a secure (HTTPS) context — so over plain HTTP the app loads but can't connect to a
   * thing. We generate a self-signed cert and a small SSL nginx config here; the seeder bind-mounts
   * both into the container (the config over the image's default.conf) so it serves the same static
   * files over HTTPS instead. Same one-time-browser-warning approach as other HTTPS-only apps.
   */
  private async _runPreinstallActions__MeshCoreWeb(): Promise<void> {
    const appDir = join(process.cwd(), MESHCORE_WEB_STORAGE_PATH)
    const certDir = join(appDir, 'certs')
    const nginxConfPath = join(appDir, 'nginx-ssl.conf')

    this._broadcast(
      SERVICE_NAMES.MESHCORE_WEB,
      'preinstall',
      `Running pre-install actions for MeshCore Web...`
    )

    try {
      await this._ensureSelfSignedCert(certDir, 'Project NOMAD MeshCore Web')

      // SSL server block bind-mounted over the image's default.conf. Serves the Flutter build that
      // already lives at /usr/share/nginx/html in the image, over HTTPS only, with the SPA fallback
      // single-page apps need. Cert paths match the /certs bind mount set in the seeder.
      const nginxConf =
        [
          'server {',
          '    listen 443 ssl;',
          '    server_name _;',
          '    ssl_certificate     /certs/cert.pem;',
          '    ssl_certificate_key /certs/key.pem;',
          '    root /usr/share/nginx/html;',
          '    index index.html;',
          '    location / {',
          '        try_files $uri $uri/ /index.html;',
          '    }',
          '}',
        ].join('\n') + '\n'
      await writeFile(nginxConfPath, nginxConf)
      await chmod(nginxConfPath, 0o644)

      this._broadcast(
        SERVICE_NAMES.MESHCORE_WEB,
        'preinstall',
        `MeshCore Web HTTPS certificate and config are ready.`
      )
    } catch (error) {
      this._broadcast(
        SERVICE_NAMES.MESHCORE_WEB,
        'preinstall-error',
        `Failed to prepare MeshCore Web HTTPS: ${error.message}`
      )
      throw new Error(`Pre-install action failed: ${error.message}`)
    }
  }

  /**
   * Vaultwarden's web vault uses WebAuthn / passkeys, which browsers only expose from a secure
   * (HTTPS) context — so over plain HTTP on the LAN the vault loads but passkeys can't be used.
   * Vaultwarden's Rocket server terminates TLS itself (no nginx sidecar like MeshCore needs), so we
   * only mint a self-signed cert here; the seeder points ROCKET_TLS at it. The cert lives under the
   * service's existing /data bind mount, so no extra bind is needed. Same one-time browser warning
   * as other HTTPS-only apps; the cert is RSA (Rocket can't load an ECC key).
   */
  private async _runPreinstallActions__Vaultwarden(): Promise<void> {
    const certDir = join(process.cwd(), VAULTWARDEN_STORAGE_PATH, 'certs')

    this._broadcast(
      SERVICE_NAMES.VAULTWARDEN,
      'preinstall',
      `Running pre-install actions for Password Vault...`
    )

    try {
      await this._ensureSelfSignedCert(certDir, 'Project NOMAD Vaultwarden')

      this._broadcast(
        SERVICE_NAMES.VAULTWARDEN,
        'preinstall',
        `Password Vault HTTPS certificate is ready.`
      )
    } catch (error) {
      this._broadcast(
        SERVICE_NAMES.VAULTWARDEN,
        'preinstall-error',
        `Failed to prepare Password Vault HTTPS: ${error.message}`
      )
      throw new Error(`Pre-install action failed: ${error.message}`)
    }
  }

  private async _cleanupFailedInstallation(serviceName: string): Promise<void> {
    try {
      const service = await Service.query().where('service_name', serviceName).first()
      if (service) {
        service.installation_status = 'error'
        await service.save()
      }
      DockerService.activeInstallations.delete(serviceName)

      // Ensure any partially created container is removed
      await this._removeServiceContainer(serviceName)

      logger.info(`[DockerService] Cleaned up failed installation for ${serviceName}`)
    } catch (error) {
      logger.error(
        `[DockerService] Failed to cleanup installation for ${serviceName}: ${error.message}`
      )
    }
  }

  /**
   * Detect GPU type and toolkit availability.
   * Primary: Check Docker runtimes via docker.info() (works from inside containers).
   * Fallback: lspci for host-based installs and AMD detection.
   */
  private async _detectGPUType(): Promise<{ type: 'nvidia' | 'amd' | 'apple' | 'none'; toolkitMissing?: boolean }> {
    try {
      // Primary: Check Docker daemon for nvidia runtime (works from inside containers)
      try {
        const dockerInfo = await this.docker.info()
        const runtimes = dockerInfo.Runtimes || {}
        if ('nvidia' in runtimes) {
          logger.info('[DockerService] NVIDIA container runtime detected via Docker API')
          return { type: 'nvidia' }
        }
      } catch (error) {
        logger.warn(`[DockerService] Could not query Docker info for GPU runtimes: ${error.message}`)
      }

      // Fallback: lspci for host-based installs (not available inside Docker)
      const execAsync = promisify(exec)

      // Check for NVIDIA GPU via lspci
      try {
        const { stdout: nvidiaCheck } = await execAsync(
          'lspci 2>/dev/null | grep -i nvidia || true'
        )
        if (nvidiaCheck.trim()) {
          // GPU hardware found but no nvidia runtime — toolkit not installed
          logger.warn('[DockerService] NVIDIA GPU detected via lspci but NVIDIA Container Toolkit is not installed')
          return { type: 'none', toolkitMissing: true }
        }
      } catch (error) {
        // lspci not available (likely inside Docker container), continue
      }

      // Check for AMD GPU via lspci — restrict to display controller classes to avoid
      // false positives from AMD CPU host bridges, PCI bridges, and chipset devices.
      try {
        const { stdout: amdCheck } = await execAsync(
          'lspci 2>/dev/null | grep -iE "VGA|3D controller|Display" | grep -iE "amd|radeon" || true'
        )
        if (amdCheck.trim()) {
          logger.info('[DockerService] AMD GPU detected via lspci')
          return { type: 'amd' }
        }
      } catch (error) {
        // lspci not available, continue
      }

      // Check for Apple Silicon (macOS with arm64)
      try {
        const { stdout: unameCheck } = await execAsync('uname -m 2>/dev/null || true')
        const { stdout: osCheck } = await execAsync('uname -s 2>/dev/null || true')
        if (osCheck.trim() === 'Darwin' && unameCheck.trim() === 'arm64') {
          logger.info('[DockerService] Apple Silicon GPU (Metal) detected')
          return { type: 'apple' }
        }
      } catch {
        // uname not available, continue
      }

      // Also detect Apple Silicon from Docker host info (when running inside a container on macOS)
      try {
        const dockerInfo = await this.docker.info()
        if (dockerInfo.OperatingSystem?.includes('Docker Desktop') && dockerInfo.Architecture === 'aarch64') {
          logger.info('[DockerService] Apple Silicon GPU (Metal) detected via Docker Desktop')
          return { type: 'apple' }
        }
      } catch {
        // Docker info query failed, continue
      }

      logger.info('[DockerService] No GPU detected')
      return { type: 'none' }
    } catch (error) {
      logger.warn(`[DockerService] Error detecting GPU type: ${error.message}`)
      return { type: 'none' }
    }
  }

  /**
   * Discover AMD GPU DRI devices dynamically.
   * Returns an array of device configurations for Docker.
   */
  // private async _discoverAMDDevices(): Promise<
  //   Array<{ PathOnHost: string; PathInContainer: string; CgroupPermissions: string }>
  // > {
  //   try {
  //     const devices: Array<{
  //       PathOnHost: string
  //       PathInContainer: string
  //       CgroupPermissions: string
  //     }> = []

  //     // Always add /dev/kfd (Kernel Fusion Driver)
  //     devices.push({
  //       PathOnHost: '/dev/kfd',
  //       PathInContainer: '/dev/kfd',
  //       CgroupPermissions: 'rwm',
  //     })

  //     // Discover DRI devices in /dev/dri/
  //     try {
  //       const driDevices = await readdir('/dev/dri')
  //       for (const device of driDevices) {
  //         const devicePath = `/dev/dri/${device}`
  //         devices.push({
  //           PathOnHost: devicePath,
  //           PathInContainer: devicePath,
  //           CgroupPermissions: 'rwm',
  //         })
  //       }
  //       logger.info(
  //         `[DockerService] Discovered ${driDevices.length} DRI devices: ${driDevices.join(', ')}`
  //       )
  //     } catch (error) {
  //       logger.warn(`[DockerService] Could not read /dev/dri directory: ${error.message}`)
  //       // Fallback to common device names if directory read fails
  //       const fallbackDevices = ['card0', 'renderD128']
  //       for (const device of fallbackDevices) {
  //         devices.push({
  //           PathOnHost: `/dev/dri/${device}`,
  //           PathInContainer: `/dev/dri/${device}`,
  //           CgroupPermissions: 'rwm',
  //         })
  //       }
  //       logger.info(`[DockerService] Using fallback DRI devices: ${fallbackDevices.join(', ')}`)
  //     }

  //     return devices
  //   } catch (error) {
  //     logger.error(`[DockerService] Error discovering AMD devices: ${error.message}`)
  //     return []
  //   }
  // }

  /**
   * Update a service container to a new image version while preserving volumes and data.
   * Includes automatic rollback if the new container fails health checks.
   */
  async updateContainer(
    serviceName: string,
    targetVersion: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Native Ollama (both the 'omlx' and 'ollama' backends set OLLAMA_HOST)
      // is host-managed. Pulling ollama/ollama here and recreating the
      // container would bind host :11434 and collide with the native daemon —
      // exactly the footgun the host CLI used to warn against. The Apps UI
      // already hides this path for native installs; this guard mirrors
      // affectContainer's and is defense-in-depth for direct API calls or a
      // future UI regression. Fail loudly with the correct remediation.
      if (serviceName === SERVICE_NAMES.OLLAMA && DockerService.isNativeOllama()) {
        return {
          success: false,
          message: `Ollama is running natively (not in Docker). Update it via 'nomad upgrade ollama' on the host, not the admin container.`,
        }
      }

      const service = await Service.query().where('service_name', serviceName).first()
      if (!service) {
        return { success: false, message: `Service ${serviceName} not found` }
      }
      if (!service.installed) {
        return { success: false, message: `Service ${serviceName} is not installed` }
      }
      if (DockerService.activeInstallations.has(serviceName)) {
        return { success: false, message: `Service ${serviceName} already has an operation in progress` }
      }

      DockerService.activeInstallations.add(serviceName)

      // Compute new image string
      const currentImage = service.container_image
      const imageBase = currentImage.includes(':')
        ? currentImage.substring(0, currentImage.lastIndexOf(':'))
        : currentImage
      const newImage = `${imageBase}:${targetVersion}`

      // Step 1: Pull new image
      this._broadcast(serviceName, 'update-pulling', `Pulling image ${newImage}...`)
      await this.pullImage(newImage)

      // Step 2: Find and stop existing container
      this._broadcast(serviceName, 'update-stopping', `Stopping current container...`)
      const containers = await this.docker.listContainers({ all: true })
      const existingContainer = containers.find((c) => c.Names.includes(`/${serviceName}`))

      if (!existingContainer) {
        DockerService.activeInstallations.delete(serviceName)
        return { success: false, message: `Container for ${serviceName} not found` }
      }

      const oldContainer = this.docker.getContainer(existingContainer.Id)

      // Inspect to capture full config before stopping
      const inspectData = await oldContainer.inspect()

      if (existingContainer.State === 'running') {
        await oldContainer.stop({ t: 15 })
      }

      // Step 3: Rename old container as safety net
      const oldName = `${serviceName}_old`

      // Clear any stale rollback container left behind by a previously failed update.
      // Otherwise the rename below collides with the existing `<name>_old` and throws,
      // which wedges every subsequent retry on the same error.
      const staleOld = (await this.docker.listContainers({ all: true })).find((c) =>
        c.Names.includes(`/${oldName}`)
      )
      if (staleOld) {
        try {
          await this.docker.getContainer(staleOld.Id).remove({ force: true })
        } catch {
          // Best effort — if it can't be removed the rename below will surface the error.
        }
      }

      await oldContainer.rename({ name: oldName })

      // Restore the previous container after a failed update: rename the renamed-aside
      // old container back into place and start it, so a failure anywhere between here
      // and the health check never leaves the service down.
      const rollbackToOld = async () => {
        const containers = await this.docker.listContainers({ all: true })
        const oldRef = containers.find((c) => c.Names.includes(`/${oldName}`))
        if (oldRef) {
          const rollbackContainer = this.docker.getContainer(oldRef.Id)
          await rollbackContainer.rename({ name: serviceName }).catch(() => {})
          await rollbackContainer.start().catch(() => {})
        }
      }

      // Step 4: Create new container with inspected config + new image
      this._broadcast(serviceName, 'update-creating', `Creating updated container...`)

      const hostConfig = inspectData.HostConfig || {}
      const newContainerConfig: any = {
        Image: newImage,
        name: serviceName,
        Env: inspectData.Config?.Env || undefined,
        Cmd: inspectData.Config?.Cmd || undefined,
        ExposedPorts: inspectData.Config?.ExposedPorts || undefined,
        WorkingDir: inspectData.Config?.WorkingDir || undefined,
        User: inspectData.Config?.User || undefined,
        HostConfig: {
          Binds: hostConfig.Binds || undefined,
          PortBindings: hostConfig.PortBindings || undefined,
          RestartPolicy: hostConfig.RestartPolicy || undefined,
          DeviceRequests: hostConfig.DeviceRequests || undefined,
          Devices: hostConfig.Devices || undefined,
        },
        NetworkingConfig: inspectData.NetworkSettings?.Networks
          ? {
              EndpointsConfig: Object.fromEntries(
                Object.keys(inspectData.NetworkSettings.Networks).map((net) => [net, {}])
              ),
            }
          : undefined,
      }

      // Remove undefined values from HostConfig
      Object.keys(newContainerConfig.HostConfig).forEach((key) => {
        if (newContainerConfig.HostConfig[key] === undefined) {
          delete newContainerConfig.HostConfig[key]
        }
      })

      let newContainer: any
      try {
        newContainer = await this.docker.createContainer(newContainerConfig)
      } catch (createError) {
        // Rollback: rename old container back
        this._broadcast(serviceName, 'update-rollback', `Failed to create new container: ${createError.message}. Rolling back...`)
        await rollbackToOld()
        DockerService.activeInstallations.delete(serviceName)
        return { success: false, message: `Failed to create updated container: ${createError.message}` }
      }

      // Step 5: Start new container. If the start itself throws (bad device/GPU config,
      // a host port already bound, image incompatibility), roll back to the previous
      // container instead of leaving the service stopped with no replacement running.
      this._broadcast(serviceName, 'update-starting', `Starting updated container...`)
      try {
        await newContainer.start()
      } catch (startError: any) {
        this._broadcast(
          serviceName,
          'update-rollback',
          `Updated container failed to start: ${startError.message}. Rolling back to previous version...`
        )
        try {
          await newContainer.remove({ force: true })
        } catch {
          // Best effort — leave the half-created container for manual cleanup if needed.
        }
        await rollbackToOld()
        DockerService.activeInstallations.delete(serviceName)
        return {
          success: false,
          message: `Update failed: new container did not start (${startError.message}). Rolled back to previous version.`,
        }
      }

      // Step 6: Health check — verify container stays running for 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5000))
      const newContainerInfo = await newContainer.inspect()

      if (newContainerInfo.State?.Running) {
        // Healthy — clean up old container
        try {
          const oldContainerRef = this.docker.getContainer(
            (await this.docker.listContainers({ all: true })).find((c) =>
              c.Names.includes(`/${oldName}`)
            )?.Id || ''
          )
          await oldContainerRef.remove({ force: true })
        } catch {
          // Old container may already be gone
        }

        // Update DB
        service.container_image = newImage
        service.available_update_version = null
        await service.save()

        DockerService.activeInstallations.delete(serviceName)
        this._broadcast(
          serviceName,
          'update-complete',
          `Successfully updated ${serviceName} to ${targetVersion}`
        )
        return { success: true, message: `Service ${serviceName} updated to ${targetVersion}` }
      } else {
        // Unhealthy — rollback
        this._broadcast(
          serviceName,
          'update-rollback',
          `New container failed health check. Rolling back to previous version...`
        )

        try {
          await newContainer.stop({ t: 5 }).catch(() => {})
          await newContainer.remove({ force: true })
        } catch {
          // Best effort cleanup
        }

        await rollbackToOld()

        DockerService.activeInstallations.delete(serviceName)
        return {
          success: false,
          message: `Update failed: new container did not stay running. Rolled back to previous version.`,
        }
      }
    } catch (error) {
      DockerService.activeInstallations.delete(serviceName)
      this._broadcast(
        serviceName,
        'update-rollback',
        'Update failed. Check server logs for details.'
      )
      logger.error({ err: error }, `[DockerService] Update failed for ${serviceName}`)
      return { success: false, message: 'Update failed. Check server logs for details.' }
    }
  }

  private _broadcast(service: string, status: string, message: string) {
    transmit.broadcast(BROADCAST_CHANNELS.SERVICE_INSTALLATION, {
      service_name: service,
      timestamp: new Date().toISOString(),
      status,
      message,
    })
    logger.info(`[DockerService] [${service}] ${status}: ${message}`)
  }

  private _parseContainerConfig(containerConfig: any): any {
    if (!containerConfig) {
      return {}
    }

    try {
      // Handle the case where containerConfig is returned as an object by DB instead of a string
      let toParse = containerConfig
      if (typeof containerConfig === 'object') {
        toParse = JSON.stringify(containerConfig)
      }

      return JSON.parse(toParse)
    } catch (error) {
      logger.error(`Failed to parse container configuration: ${error.message}`)
      throw new Error(`Invalid container configuration: ${error.message}`)
    }
  }

  // ── Custom-app container management (Supply Depot) ────────────────────────────

  /**
   * Pull a Docker image and resolve only when the pull genuinely completes.
   *
   * dockerode's `followProgress(stream, onFinished)` reports failures via the
   * first argument of onFinished. Every call site used to pass the Promise's
   * `resolve` directly as that callback, so a failed pull (dropped/metered
   * connection, bad manifest, registry error, disk full mid-pull) resolved as
   * if it had succeeded — and the code then tried to create/start a container
   * from a missing or partial image, surfacing a confusing downstream error.
   * Rejecting on that error here lets callers fail fast with the real cause (#790).
   *
   * Public so BenchmarkService can route its sysbench pull through it too.
   */
  async pullImage(imageName: string): Promise<void> {
    // Normalize a digest-pinned ref (repo:tag@sha256:...) to digest-only so
    // dockerode's pull parses it correctly (see pullableImageRef).
    const pullStream = await this.docker.pull(pullableImageRef(imageName))
    await followPullProgress(this.docker.modem, pullStream)
  }

  /**
   * Check whether any of the supplied host ports are already bound by a running or stopped
   * Docker container. Uses the Docker API exclusively — probing ports via net.createServer()
   * would only test the admin container's own network namespace (DooD pattern), not the host.
   */
  async checkPortConflicts(
    ports: number[]
  ): Promise<{ conflicts: { port: number; usedBy: string }[] }> {
    if (!ports.length) return { conflicts: [] }

    try {
      const containers = await this.docker.listContainers({ all: true })
      const bound = new Map<number, string>()

      for (const c of containers) {
        const name = (c.Names[0] || '').replace('/', '')
        for (const p of c.Ports) {
          if (p.PublicPort) bound.set(p.PublicPort, name || c.Id.slice(0, 12))
        }
      }

      const conflicts = ports
        .filter((p) => bound.has(p))
        .map((p) => ({ port: p, usedBy: bound.get(p)! }))

      return { conflicts }
    } catch (error: any) {
      logger.warn(`[DockerService] checkPortConflicts failed: ${error.message}`)
      return { conflicts: [] }
    }
  }

  /**
   * Remove a custom-app container and, when `removeImage` is set, its backing image too. Called
   * before deleting the DB record. Image removal is best-effort: a shared/in-use image is left alone.
   */
  async removeCustomAppContainer(
    serviceName: string,
    removeImage = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const container = containers.find((c) => c.Names.includes(`/${serviceName}`))

      if (!container) return { success: true, message: 'No container found — nothing to remove' }

      const imageRef = container.Image
      const c = this.docker.getContainer(container.Id)
      if (container.State === 'running') await c.stop()
      await c.remove({ force: true })

      if (removeImage && imageRef) {
        try {
          await this.docker.getImage(imageRef).remove()
        } catch (imgErr: any) {
          // Non-fatal: the image may be shared with another container or already gone.
          logger.warn(`[DockerService] Could not remove image ${imageRef} for ${serviceName}: ${imgErr.message}`)
        }
      }

      return { success: true, message: `Container ${serviceName} removed` }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] removeCustomAppContainer failed for ${serviceName}`)
      return { success: false, message: error.message }
    }
  }

  /** Find a container by its managed service name (`/serviceName`), or null. */
  private async _findContainerByName(serviceName: string) {
    const containers = await this.docker.listContainers({ all: true })
    return containers.find((c) => c.Names.includes(`/${serviceName}`)) ?? null
  }

  /**
   * Decode the multiplexed stream Docker returns for non-TTY container logs. Each frame is an
   * 8-byte header ([streamType, 0,0,0, big-endian payloadSize]) followed by the payload.
   */
  private _demuxDockerLog(buf: Buffer): string {
    let out = ''
    let offset = 0
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4)
      offset += 8
      if (offset + size > buf.length) {
        out += buf.toString('utf8', offset)
        break
      }
      out += buf.toString('utf8', offset, offset + size)
      offset += size
    }
    return out
  }

  /** Return the last `tail` lines of a service container's combined stdout/stderr. */
  async getContainerLogs(
    serviceName: string,
    tail = 200
  ): Promise<{ success: boolean; logs?: string; message?: string }> {
    try {
      const info = await this._findContainerByName(serviceName)
      if (!info) return { success: false, message: `No container found for ${serviceName}` }

      const container = this.docker.getContainer(info.Id)
      const inspect = await container.inspect()
      const tty = inspect.Config?.Tty ?? false

      const buf = (await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail,
        timestamps: false,
      })) as unknown as Buffer

      const logs = tty ? buf.toString('utf8') : this._demuxDockerLog(buf)
      return { success: true, logs }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] getContainerLogs failed for ${serviceName}`)
      return { success: false, message: error.message }
    }
  }

  /**
   * Return a single resource-usage snapshot (CPU %, memory) for a running service container.
   * Uses Docker's non-streaming stats, which include precpu_stats so CPU % is computable.
   */
  async getContainerStats(serviceName: string): Promise<{
    success: boolean
    running?: boolean
    stats?: { cpuPercent: number; memUsageBytes: number; memLimitBytes: number; memPercent: number }
    message?: string
  }> {
    try {
      const info = await this._findContainerByName(serviceName)
      if (!info) return { success: false, message: `No container found for ${serviceName}` }
      if (info.State !== 'running') return { success: true, running: false }

      const container = this.docker.getContainer(info.Id)
      const s: any = await container.stats({ stream: false })

      const cpuDelta =
        (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0)
      const systemDelta =
        (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0)
      const numCpus =
        s.cpu_stats?.online_cpus ?? s.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1
      const cpuPercent =
        systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0

      // Subtract page cache from usage to better reflect the container's working set.
      const cache = s.memory_stats?.stats?.cache ?? s.memory_stats?.stats?.inactive_file ?? 0
      const memUsageBytes = Math.max(0, (s.memory_stats?.usage ?? 0) - cache)
      const memLimitBytes = s.memory_stats?.limit ?? 0
      const memPercent = memLimitBytes > 0 ? (memUsageBytes / memLimitBytes) * 100 : 0

      return {
        success: true,
        running: true,
        stats: {
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memUsageBytes,
          memLimitBytes,
          memPercent: Math.round(memPercent * 10) / 10,
        },
      }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] getContainerStats failed for ${serviceName}`)
      return { success: false, message: error.message }
    }
  }

  /**
   * Wait for a freshly started container to be "ready". If the image declares a HEALTHCHECK we poll
   * its health until healthy/unhealthy (up to timeoutMs); otherwise we fall back to a 5s settle and
   * a plain Running check. Returns whether it's ready plus a reason when not.
   */
  private async _awaitContainerReady(
    container: any,
    timeoutMs = 30000
  ): Promise<{ ready: boolean; reason?: string }> {
    let inspect = await container.inspect()
    const hasHealthcheck = !!inspect.State?.Health

    if (!hasHealthcheck) {
      await new Promise((r) => setTimeout(r, 5000))
      inspect = await container.inspect()
      return inspect.State?.Running
        ? { ready: true }
        : { ready: false, reason: 'container did not stay running' }
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      inspect = await container.inspect()
      if (!inspect.State?.Running) return { ready: false, reason: 'container exited' }
      const status = inspect.State?.Health?.Status
      if (status === 'healthy') return { ready: true }
      if (status === 'unhealthy') return { ready: false, reason: 'failed its health check' }
      await new Promise((r) => setTimeout(r, 2000))
    }
    // Still in "starting" at timeout — accept it if it's at least running rather than roll back a slow boot.
    return inspect.State?.Running ? { ready: true } : { ready: false, reason: 'health check timed out' }
  }

  /**
   * Recreate a custom app's container from its (already-updated) Service record, preserving data.
   * Uses the same rename-and-rollback safety net as the update flow: the live container is renamed
   * aside, a new one is created from the new config/image, health-gated, and only then is the old one
   * removed — otherwise we roll back to it. Bind-mounted data is untouched throughout. Pass
   * `forcePull` to always re-pull the image first (used by the "update" action for moving tags).
   */
  async recreateCustomAppContainer(
    serviceName: string,
    opts: { forcePull?: boolean } = {}
  ): Promise<{ success: boolean; message: string }> {
    const service = await Service.query().where('service_name', serviceName).first()
    if (!service) return { success: false, message: `Service ${serviceName} not found` }

    const containerConfig = this._parseContainerConfig(service.container_config)
    // Recreate goes through the Docker socket with host binds, so point any
    // storage binds at the admin's real host storage root, same as install (#938).
    await this._applyHostStorageRoot(containerConfig)
    const oldInfo = await this._findContainerByName(serviceName)
    const oldName = `${serviceName}_old`

    // Clear any stale `_old` left behind by a previous recreate that died mid-flight. Without this,
    // the rename below would fail (name in use) and the rollback path would then destroy the live
    // container and resurrect the stale one in its place.
    const staleOld = await this._findContainerByName(oldName)
    if (staleOld) {
      await this.docker.getContainer(staleOld.Id).remove({ force: true }).catch(() => {})
    }

    try {
      // Stop + rename the existing container aside as a rollback safety net.
      if (oldInfo) {
        const oldContainer = this.docker.getContainer(oldInfo.Id)
        if (oldInfo.State === 'running') await oldContainer.stop({ t: 10 }).catch(() => {})
        await oldContainer.rename({ name: oldName })
      }

      // Pull the image if it's missing locally, or always when forcePull (e.g. :latest updates).
      if (opts.forcePull || !(await this._checkImageExists(service.container_image))) {
        await this.pullImage(service.container_image)
      }

      const newContainer = await this.docker.createContainer({
        Image: service.container_image,
        name: serviceName,
        Labels: {
          ...(containerConfig?.Labels ?? {}),
          'com.docker.compose.project': 'project-nomad-managed',
          'io.project-nomad.managed': 'true',
        },
        ...(containerConfig?.User && { User: containerConfig.User }),
        HostConfig: containerConfig?.HostConfig ?? {},
        ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
        ...(containerConfig?.Env && { Env: containerConfig.Env }),
        ...(service.container_command ? { Cmd: service.container_command.split(' ') } : {}),
        ...(process.env.NODE_ENV === 'production' && {
          NetworkingConfig: { EndpointsConfig: { [DockerService.NOMAD_NETWORK]: {} } },
        }),
      })
      await newContainer.start()

      // Health gate before discarding the old container.
      const readiness = await this._awaitContainerReady(newContainer)
      if (!readiness.ready) throw new Error(`recreated container ${readiness.reason}`)

      if (oldInfo) {
        const oldRef = await this._findContainerByName(oldName)
        if (oldRef) await this.docker.getContainer(oldRef.Id).remove({ force: true })
      }
      service.installed = true
      service.installation_status = 'idle'
      await service.save()
      return { success: true, message: `Service ${serviceName} reconfigured successfully` }
    } catch (error: any) {
      logger.error({ err: error }, `[DockerService] recreateCustomAppContainer failed for ${serviceName}`)
      // Roll back: discard the failed new container and restore the renamed original.
      try {
        const failedNew = await this._findContainerByName(serviceName)
        if (failedNew) {
          const c = this.docker.getContainer(failedNew.Id)
          await c.stop({ t: 5 }).catch(() => {})
          await c.remove({ force: true }).catch(() => {})
        }
        const renamed = await this._findContainerByName(oldName)
        if (renamed) {
          const c = this.docker.getContainer(renamed.Id)
          await c.rename({ name: serviceName })
          await c.start().catch(() => {})
        }
      } catch (rollbackError: any) {
        logger.error({ err: rollbackError }, `[DockerService] rollback failed for ${serviceName}`)
      }
      return { success: false, message: `Reconfigure failed and was rolled back: ${error.message}` }
    }
  }

  /**
   * Check if a Docker image exists locally.
   * @param imageName - The name and tag of the image (e.g., "nginx:latest")
   * @returns - True if the image exists locally, false otherwise
   */
  private async _checkImageExists(imageName: string): Promise<boolean> {
    try {
      const images = await this.docker.listImages()

      // Check if any image has a RepoTag that matches the requested image
      return images.some((image) => image.RepoTags && image.RepoTags.includes(imageName))
    } catch (error) {
      logger.warn(`Error checking if image exists: ${error.message}`)
      // If run into an error, assume the image does not exist
      return false
    }
  }

  // ── Kiwix library-mode migration (#622) — ported from upstream v1.33.0 ──────
  async isKiwixOnLegacyConfig(): Promise<boolean> {
    try {
      const containers = await this.docker.listContainers({ all: true })
      const info = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.KIWIX}`))
      if (!info) return false

      const inspected = await this.docker.getContainer(info.Id).inspect()
      const cmd: string[] = inspected.Config?.Cmd ?? []
      return cmd.some((arg) => arg.includes('*.zim'))
    } catch (err: any) {
      logger.warn(`[DockerService] Could not inspect kiwix container: ${err.message}`)
      return false
    }
  }

  /**
   * Migrates the kiwix container from legacy glob mode (`*.zim`) to library mode
   * (`--library /data/kiwix-library.xml --monitorLibrary`).
   *
   * Non-destructive recreation: ZIM files and volumes are preserved. The container
   * is stopped, removed, and recreated with the library-mode command. Authoritative:
   * it writes the correct command to the DB itself rather than trusting a prior migration.
   */
  async migrateKiwixToLibraryMode(): Promise<void> {
    if (DockerService.activeInstallations.has(SERVICE_NAMES.KIWIX)) {
      logger.warn('[DockerService] Kiwix migration already in progress, skipping duplicate call.')
      return
    }

    DockerService.activeInstallations.add(SERVICE_NAMES.KIWIX)

    try {
      // Step 1: Build/update the XML from current disk state
      this._broadcast(SERVICE_NAMES.KIWIX, 'migrating', 'Migrating kiwix to library mode...')
      const kiwixLibraryService = new KiwixLibraryService()
      await kiwixLibraryService.rebuildFromDisk()
      this._broadcast(SERVICE_NAMES.KIWIX, 'migrating', 'Built kiwix library XML from existing ZIM files.')

      // Step 2: Stop and remove old container (leave ZIM volumes intact)
      const containers = await this.docker.listContainers({ all: true })
      const containerInfo = containers.find((c) => c.Names.includes(`/${SERVICE_NAMES.KIWIX}`))
      if (containerInfo) {
        const oldContainer = this.docker.getContainer(containerInfo.Id)
        if (containerInfo.State === 'running') {
          await oldContainer.stop({ t: 10 }).catch((e: any) =>
            logger.warn(`[DockerService] Kiwix stop warning during migration: ${e.message}`)
          )
        }
        await oldContainer.remove({ force: true }).catch((e: any) =>
          logger.warn(`[DockerService] Kiwix remove warning during migration: ${e.message}`)
        )
      }

      // Step 3: Read the service record and authoritatively set the correct command.
      const service = await Service.query().where('service_name', SERVICE_NAMES.KIWIX).first()
      if (!service) {
        throw new Error('Kiwix service record not found in DB during migration')
      }

      service.container_command = KIWIX_LIBRARY_CMD
      service.installed = false
      service.installation_status = 'installing'
      await service.save()

      const containerConfig = this._parseContainerConfig(service.container_config)
      await this._applyHostStorageRoot(containerConfig)

      // Step 4: Recreate the container directly (ZIM files already exist on disk)
      this._broadcast(SERVICE_NAMES.KIWIX, 'migrating', 'Recreating kiwix container with library mode config...')
      const newContainer = await this.docker.createContainer({
        Image: service.container_image,
        name: service.service_name,
        HostConfig: containerConfig?.HostConfig ?? {},
        ...(containerConfig?.ExposedPorts && { ExposedPorts: containerConfig.ExposedPorts }),
        Cmd: KIWIX_LIBRARY_CMD.split(' '),
        ...(process.env.NODE_ENV === 'production' && {
          NetworkingConfig: {
            EndpointsConfig: {
              [DockerService.NOMAD_NETWORK]: {},
            },
          },
        }),
      })

      await newContainer.start()

      service.installed = true
      service.installation_status = 'idle'
      await service.save()
      DockerService.activeInstallations.delete(SERVICE_NAMES.KIWIX)

      this._broadcast(SERVICE_NAMES.KIWIX, 'migrated', 'Kiwix successfully migrated to library mode.')
      logger.info('[DockerService] Kiwix migration to library mode complete.')
    } catch (error: any) {
      logger.error(`[DockerService] Kiwix migration failed: ${error.message}`)
      await this._cleanupFailedInstallation(SERVICE_NAMES.KIWIX)
      throw error
    }
  }
}
