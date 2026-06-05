import { Systeminformation } from 'systeminformation'

export type GpuHealthStatus = {
  status: 'ok' | 'passthrough_failed' | 'no_gpu' | 'ollama_not_installed' | 'apple_metal'
  hasNvidiaRuntime: boolean
  ollamaGpuAccessible: boolean
  hasAppleMetal?: boolean
}

export type SystemInformationResponse = {
  cpu: Systeminformation.CpuData
  mem: Systeminformation.MemData
  os: Systeminformation.OsData
  disk: NomadDiskInfo[]
  currentLoad: Systeminformation.CurrentLoadData
  fsSize: Systeminformation.FsSizeData[]
  uptime: Systeminformation.TimeData
  graphics: Systeminformation.GraphicsData
  gpuHealth?: GpuHealthStatus
}

// Type inferrence is not working properly with usePage and shared props, so we define this type manually
export type UsePageProps = {
  appVersion: string
  environment: string
}

export type LSBlockDevice = {
  name: string
  size: string
  type: string
  model: string | null
  serial: string | null
  vendor: string | null
  rota: boolean | null
  tran: string | null
  children?: LSBlockDevice[]
}

export type NomadDiskInfoRaw = {
  diskLayout: {
    blockdevices: LSBlockDevice[]
  }
  fsSize: {
    fs: string
    size: number
    used: number
    available: number
    use: number
    mount: string
  }[]
}

export type NomadDiskInfo = {
  name: string
  model: string
  vendor: string
  rota: boolean
  tran: string
  size: string
  totalUsed: number
  totalSize: number
  percentUsed: number
  filesystems: {
    fs: string
    mount: string
    used: number
    size: number
    percentUsed: number
  }[]
}

export type SystemUpdateStatus = {
  stage: 'idle' | 'starting' | 'pulling' | 'pulled' | 'recreating' | 'complete' | 'error'
  progress: number
  message: string
  timestamp: string
}


export type CheckLatestVersionResult = {
  success: boolean,
  updateAvailable: boolean,
  currentVersion: string,
  latestVersion: string,
  message?: string
}

/**
 * Result of GET /api/system/candidate-drive. `available` is true only when the
 * host's drive-detect agent has written a marker for a non-active, full-library
 * project-nomad drive that can be adopted. When false, the other fields are
 * absent and the banner renders nothing.
 */
export type CandidateDriveResponse =
  | { available: false }
  | {
      available: true
      /** The drive's `…/project-nomad` data-root path on the host. */
      path: string
      /** Volume label, used in the banner copy. */
      label: string
      /** ISO-8601 UTC timestamp the host detected the drive. */
      detectedAt?: string
    }