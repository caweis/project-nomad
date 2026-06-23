import Service from '#models/service'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { ModelAttributes } from '@adonisjs/lucid/types/model'
import env from '#start/env'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { shouldReseedCuratedRow } from '#services/reseed_sync'

export default class ServiceSeeder extends BaseSeeder {
  // Use environment variable with fallback to production default
  private static NOMAD_STORAGE_ABS_PATH = env.get(
    'NOMAD_STORAGE_PATH',
    '/opt/project-nomad/storage'
  )
  private static DEFAULT_SERVICES: Omit<
    ModelAttributes<Service>,
    | 'created_at'
    | 'updated_at'
    | 'metadata'
    | 'id'
    | 'available_update_version'
    | 'update_checked_at'
    | 'is_custom'
    // Supply Depot columns seeded by their DB defaults / never set at seed time. Excluded so
    // curated seed records don't have to carry them; the reseed-sync below reads is_user_modified
    // off the live row, and custom_url / auto_update_* are user-controlled, never catalog-driven.
    | 'is_user_modified'
    | 'custom_url'
    | 'auto_update_enabled'
    | 'available_update_first_seen_at'
    | 'auto_update_consecutive_failures'
    | 'auto_update_disabled_reason'
  >[] = [
    {
      service_name: SERVICE_NAMES.KIWIX,
      friendly_name: 'Information Library',
      powered_by: 'Kiwix',
      display_order: 1,
      category: 'education',
      description:
        'Offline access to Wikipedia, medical references, how-to guides, and encyclopedias',
      icon: 'IconBooks',
      container_image: 'ghcr.io/kiwix/kiwix-serve:3.8.1',
      source_repo: 'https://github.com/kiwix/kiwix-tools',
      container_command: '*.zim --address=all',
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/zim:/data`],
          PortBindings: { '8080/tcp': [{ HostPort: '8090' }] },
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8090',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.QDRANT,
      friendly_name: 'Qdrant Vector Database',
      powered_by: null,
      display_order: 100, // Dependency service, not shown directly
      category: null,
      description: 'Vector database for storing and searching embeddings',
      icon: 'IconRobot',
      container_image: 'qdrant/qdrant:v1.16',
      source_repo: 'https://github.com/qdrant/qdrant',
      container_command: null,
      container_config: JSON.stringify({
        // Disable Qdrant's anonymous usage telemetry — NOMAD is offline-first
        // and ships zero-telemetry by default (upstream 0c76a19).
        Env: ['QDRANT__TELEMETRY_DISABLED=true'],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/qdrant:/qdrant/storage`],
          PortBindings: { '6333/tcp': [{ HostPort: '6333' }], '6334/tcp': [{ HostPort: '6334' }] },
        },
        ExposedPorts: { '6333/tcp': {}, '6334/tcp': {} },
      }),
      ui_location: '6333',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: true,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.OLLAMA,
      friendly_name: 'AI Assistant',
      powered_by: 'Ollama',
      display_order: 3,
      category: 'ai',
      description: 'Local AI chat that runs entirely on your hardware - no internet required',
      icon: 'IconWand',
      container_image: 'ollama/ollama:0.15.2',
      source_repo: 'https://github.com/ollama/ollama',
      container_command: 'serve',
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/ollama:/root/.ollama`],
          PortBindings: { '11434/tcp': [{ HostPort: '11434' }] },
        },
        ExposedPorts: { '11434/tcp': {} },
      }),
      ui_location: '/chat',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: SERVICE_NAMES.QDRANT,
    },
    {
      service_name: SERVICE_NAMES.CYBERCHEF,
      friendly_name: 'Data Tools',
      powered_by: 'CyberChef',
      display_order: 11,
      category: 'utility',
      description: 'Swiss Army knife for data encoding, encryption, and analysis',
      icon: 'IconChefHat',
      // 10.19.4 was pruned from ghcr (404 on pull); pin the current release by digest.
      container_image:
        'ghcr.io/gchq/cyberchef:10.24.0@sha256:58d2bcefe3f32b066eafca07353aae31b961ca7765fe4bcb913aba6bb8b8dd81',
      source_repo: 'https://github.com/gchq/CyberChef',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8100' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8100',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.FLATNOTES,
      friendly_name: 'Notes',
      powered_by: 'FlatNotes',
      display_order: 10,
      category: 'productivity',
      description: 'Simple note-taking app with local storage',
      icon: 'IconNotes',
      container_image: 'dullage/flatnotes:v5.5.4',
      source_repo: 'https://github.com/dullage/flatnotes',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8200' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/flatnotes:/data`],
        },
        ExposedPorts: { '8080/tcp': {} },
        Env: ['FLATNOTES_AUTH_TYPE=none'],
      }),
      ui_location: '8200',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.KOLIBRI,
      friendly_name: 'Education Platform',
      powered_by: 'Kolibri',
      display_order: 2,
      category: 'education',
      description: 'Interactive learning platform with video courses and exercises',
      icon: 'IconSchool',
      container_image: 'treehouses/kolibri:0.12.8',
      source_repo: 'https://github.com/learningequality/kolibri',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8300' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/kolibri:/root/.kolibri`],
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8300',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.GROCY,
      friendly_name: 'Grocy',
      powered_by: 'Grocy',
      display_order: 4,
      category: 'productivity',
      description: 'Food and pantry tracker for stock levels, expiry dates, and shopping lists',
      icon: 'IconCarrot',
      // ghcr.io (LinuxServer's official mirror) digest-pinned to the latest arm64
      // build. The previous tag 07.03.26 did not exist on the registry, so the
      // pull failed with "manifest unknown" the moment anyone hit Install.
      container_image:
        'ghcr.io/linuxserver/grocy:v3.0.1-ls101@sha256:c01e9fa0f1323490f17d0dd34d9341dc9627b4ffda04633738ed59febaea7c59',
      source_repo: 'https://github.com/grocy/grocy',
      container_command: null,
      container_config: JSON.stringify({
        // LinuxServer image: nginx + php-fpm serving the Grocy UI on container :80.
        // PUID/PGID/TZ are the LSIO conventions; data persists in /config.
        Env: ['PUID=1000', 'PGID=1000', 'TZ=Etc/UTC'],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/grocy:/config`],
          PortBindings: { '80/tcp': [{ HostPort: '8400' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8400',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.MESHTASTIC_WEB,
      friendly_name: 'Meshtastic Web',
      powered_by: 'Meshtastic',
      display_order: 5,
      description: 'Browser-based client for managing Meshtastic mesh radio devices',
      icon: 'IconWifi',
      container_image: 'ghcr.io/meshtastic/web:v2.7.1',
      source_repo: 'https://github.com/meshtastic/web',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          // meshtastic/web serves on 8080 inside the container, not 80.
          PortBindings: { '8080/tcp': [{ HostPort: '8450' }] },
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8450',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.MESHCORE_WEB,
      friendly_name: 'MeshCore Web',
      powered_by: 'MeshCore',
      display_order: 6,
      description: 'Browser-based client for MeshCore mesh radio devices',
      icon: 'IconAntenna',
      // aXistem's prebuilt image of Liam Cottle's MeshCore web client (MeshCore is a sibling LoRa
      // mesh project to Meshtastic).
      container_image: 'ghcr.io/axistem-dev/meshcore-web:v1.45.0',
      source_repo: 'https://github.com/aXistem-dev/meshcore-web',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          // Stock nginx serving a Flutter build over HTTP on 80. MeshCore's client reaches a radio via
          // Web Bluetooth / Web Serial, which browsers only allow from a secure (HTTPS) context — so
          // _runPreinstallActions__MeshCoreWeb writes a self-signed cert + SSL config into
          // storage/meshcore-web, and we bind both in (the config over the image's default.conf) and
          // publish 443. The https: prefix on ui_location builds an https:// Open link.
          PortBindings: { '443/tcp': [{ HostPort: '8500' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/meshcore-web/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/meshcore-web/certs:/certs:ro`,
          ],
        },
        ExposedPorts: { '443/tcp': {} },
      }),
      ui_location: 'https:8500',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.MESH,
      friendly_name: 'Mesh Bridge',
      powered_by: 'NOMAD',
      display_order: 7,
      description:
        'Off-grid AI over a LoRa mesh radio: text a question, get an answer back on the radio. Needs a Meshtastic or MeshCore radio (P0 runs against a mock until the radio adapters land).',
      icon: 'IconRadio',
      container_image: 'ghcr.io/caweis/project-nomad-mesh:0.1.0',
      source_repo: 'https://github.com/caweis/project-nomad',
      container_command: null,
      container_config: JSON.stringify({
        // Reaches the onboard AI over the internal Docker network, same path the
        // admin uses. ExtraHosts maps host.docker.internal so the container can
        // call the host AI (Ollama :11434 / oMLX :11436) without LAN exposure.
        Env: ['NOMAD_OLLAMA_URL=http://host.docker.internal:11434'],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          ExtraHosts: ['host.docker.internal:host-gateway'],
          PortBindings: { '8600/tcp': [{ HostPort: '8600' }] },
        },
        ExposedPorts: { '8600/tcp': {} },
      }),
      ui_location: '8600',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.VAULTWARDEN,
      friendly_name: 'Password Vault',
      powered_by: 'Vaultwarden',
      display_order: 8,
      category: 'security',
      description:
        'Self-hosted password manager (Bitwarden-compatible) for storing logins, notes, and secrets offline',
      icon: 'IconLock',
      // Index-digest pinned (resolves arm64 on the mini, amd64 on Intel Macs).
      container_image:
        'vaultwarden/server:1.36.0@sha256:d626d04934cd1192ad8ced1adb975099fca78cec33ab467d2d3c923cde7f3b0c',
      source_repo: 'https://github.com/dani-garcia/vaultwarden',
      container_command: null,
      container_config: JSON.stringify({
        // Serves the vault over HTTPS on container :80 — Rocket (Vaultwarden's web server) terminates
        // TLS itself, no nginx sidecar like MeshCore needs. WebAuthn/passkeys need a secure context,
        // so _runPreinstallActions__Vaultwarden mints a self-signed RSA cert into
        // storage/vaultwarden/certs, which is the same dir bound in as /data — ROCKET_TLS reads it
        // from /data/certs with no extra mount. The https: prefix on ui_location builds an https://
        // Open link; expect a one-time browser warning for the self-signed cert.
        Env: ['ROCKET_TLS={certs="/data/certs/cert.pem",key="/data/certs/key.pem"}'],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/vaultwarden:/data`],
          PortBindings: { '80/tcp': [{ HostPort: '8700' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: 'https:8700',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.STIRLING_PDF,
      friendly_name: 'PDF Tools',
      powered_by: 'Stirling-PDF',
      display_order: 9,
      category: 'productivity',
      description:
        'Local toolkit for merging, splitting, converting, and editing PDFs with no cloud upload',
      icon: 'IconFileTypePdf',
      container_image:
        'stirlingtools/stirling-pdf:2.12.0@sha256:2bb9b67f3edbca7ecc80f6e851a02cd04a10d5ea1d69b3e80b1e1f615e97b7a2',
      source_repo: 'https://github.com/Stirling-Tools/Stirling-PDF',
      container_command: null,
      container_config: JSON.stringify({
        // Serves on container :8080; /configs persists app settings and custom assets.
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/stirling-pdf:/configs`],
          PortBindings: { '8080/tcp': [{ HostPort: '8701' }] },
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8701',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.IT_TOOLS,
      friendly_name: 'IT Tools',
      powered_by: 'IT-Tools',
      display_order: 10,
      category: 'utility',
      description:
        'A collection of developer and sysadmin utilities (encoders, converters, generators) that run entirely in the browser',
      icon: 'IconTools',
      container_image:
        'ghcr.io/corentinth/it-tools:2024.10.22-7ca5933@sha256:8b8128748339583ca951af03dfe02a9a4d7363f61a216226fc28030731a5a61f',
      source_repo: 'https://github.com/CorentinTh/it-tools',
      container_command: null,
      container_config: JSON.stringify({
        // nginx serving a static client on container :80; stateless, no volume needed.
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8702' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8702',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.EXCALIDRAW,
      friendly_name: 'Whiteboard',
      powered_by: 'Excalidraw',
      display_order: 11,
      category: 'productivity',
      description:
        'Virtual hand-drawn-style whiteboard for diagrams and sketches; drawings stay in the browser',
      icon: 'IconPencil',
      // Excalidraw publishes a multi-arch manifest only on the moving `latest` tag (its
      // sha-<commit> tags are amd64-only), so it is pinned by its immutable index digest.
      container_image:
        'excalidraw/excalidraw:latest@sha256:f7ee194addd607bf831d2af0f0a34463dd4225e426cf35199ef0b12a803398e9',
      source_repo: 'https://github.com/excalidraw/excalidraw',
      container_command: null,
      container_config: JSON.stringify({
        // nginx serving the static app on container :80; local-storage based, no volume needed.
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8703' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8703',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.CALIBRE_WEB,
      friendly_name: 'eBook Library',
      powered_by: 'Calibre-Web',
      display_order: 12,
      category: 'productivity',
      description:
        'Browse and read your ebook collection in the browser, with metadata, search, and OPDS feeds',
      icon: 'IconBook',
      container_image:
        'lscr.io/linuxserver/calibre-web:0.6.26-ls387@sha256:58e1c0abdfcd22341d87402dc56577eae1f4a18344bdc0c02dfbd97c47dff4a6',
      source_repo: 'https://github.com/janeczku/calibre-web',
      container_command: null,
      container_config: JSON.stringify({
        // LinuxServer image serving Calibre-Web on container :8083. PUID/PGID/TZ are the LSIO
        // conventions; /config holds the app DB, /books is the library Calibre-Web reads.
        Env: ['PUID=1000', 'PGID=1000', 'TZ=Etc/UTC'],
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/calibre-web:/config`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/calibre-web/books:/books`,
          ],
          PortBindings: { '8083/tcp': [{ HostPort: '8704' }] },
        },
        ExposedPorts: { '8083/tcp': {} },
      }),
      ui_location: '8704',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      depends_on: null,
    },
  ]

  async run() {
    const existingServices = await Service.query().select([
      'service_name',
      'is_custom',
      'is_user_modified',
    ])
    const existingServiceMap = new Map(existingServices.map((s) => [s.service_name, s]))

    const newServices = ServiceSeeder.DEFAULT_SERVICES.filter(
      (service) => !existingServiceMap.has(service.service_name)
    )

    if (newServices.length > 0) {
      await Service.createMany([...newServices])
    }

    // Keep curated services in sync with the catalog. Custom services are user-defined and must
    // never be overwritten. User-modified curated services (a user edited their config) are
    // likewise left alone so the edit survives reboots. container_image and ui_location are
    // synced too so a catalog change to an app's image, link, scheme, or port (e.g. a corrected
    // image tag like grocy's, Vaultwarden moving to https:8700) reaches existing non-modified
    // installs on update, not just fresh ones. The version-refresh step runs right after the seed
    // and re-bumps container_image to the newest tag, so resetting it to the seeded value here is
    // the floor, not the final value.
    for (const service of ServiceSeeder.DEFAULT_SERVICES) {
      const existing = existingServiceMap.get(service.service_name)
      if (shouldReseedCuratedRow(existing)) {
        await Service.query().where('service_name', service.service_name).update({
          container_image: service.container_image,
          container_config: service.container_config,
          container_command: service.container_command ?? null,
          metadata: (service as any).metadata ?? null,
          category: service.category,
          ui_location: service.ui_location,
        })
      }
    }
  }
}
