import Service from '#models/service'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { ModelAttributes } from '@adonisjs/lucid/types/model'
import env from '#start/env'
import { SERVICE_NAMES } from '../../constants/service_names.js'

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
      container_image: 'ghcr.io/gchq/cyberchef:10.19.4',
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
      container_image: 'lscr.io/linuxserver/grocy:07.03.26',
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
  ]

  async run() {
    const existingServices = await Service.query().select('service_name')
    const existingServiceNames = new Set(existingServices.map((service) => service.service_name))

    const newServices = ServiceSeeder.DEFAULT_SERVICES.filter(
      (service) => !existingServiceNames.has(service.service_name)
    )

    await Service.createMany([...newServices])
  }
}
