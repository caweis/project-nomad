/**
 * Bind mounts through the Edit dialog: shown without their options, saved with
 * them. MeshCore Web's read-only mounts could not be saved before.
 *
 * Run: node --experimental-strip-types tests/standalone/container_binds.standalone.ts
 */
import assert from 'node:assert/strict'
import { bindsFromVolumes, volumesFromBinds } from '../../app/utils/container_binds.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ok - ${name}`)
}

const S = '/opt/project-nomad/storage'
// MeshCore Web's two mounts, as the seeder writes them.
const MESHCORE = [
  `${S}/meshcore-web/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro`,
  `${S}/meshcore-web/certs:/certs:ro`,
]

check('a plain mount is shown as its two paths', () => {
  assert.deepEqual(volumesFromBinds([`${S}/zim:/data`]), [
    { host_path: `${S}/zim`, container_path: '/data' },
  ])
})

check('the options are not part of the container path the dialog shows', () => {
  // With them in, the validator refuses the colon and the app cannot be saved.
  assert.deepEqual(volumesFromBinds(MESHCORE), [
    {
      host_path: `${S}/meshcore-web/nginx-ssl.conf`,
      container_path: '/etc/nginx/conf.d/default.conf',
    },
    { host_path: `${S}/meshcore-web/certs`, container_path: '/certs' },
  ])
  for (const volume of volumesFromBinds(MESHCORE)) {
    assert.ok(!volume.host_path.includes(':') && !volume.container_path.includes(':'))
  }
})

check('saving the dialog unchanged gives back the same binds, read-only included', () => {
  assert.deepEqual(bindsFromVolumes(volumesFromBinds(MESHCORE), MESHCORE), MESHCORE)
  assert.deepEqual(bindsFromVolumes(volumesFromBinds([`${S}/zim:/data`]), [`${S}/zim:/data`]), [
    `${S}/zim:/data`,
  ])
})

check('several options on one mount are kept as they were', () => {
  const binds = [`${S}/a:/a:ro,z`, `${S}/b:/b:rw`]
  assert.deepEqual(bindsFromVolumes(volumesFromBinds(binds), binds), binds)
})

check('whatever follows the container path comes back exactly as it was', () => {
  // Docker puts every option in one comma-separated field, so a fourth colon-
  // separated part is not expected. If one ever appears it must not be cut.
  const odd = [`${S}/a:/a:ro:z`]
  assert.deepEqual(bindsFromVolumes(volumesFromBinds(odd), odd), odd)
})

check('a mount the person changed is a new mount and starts with the defaults', () => {
  const changedContainerPath = bindsFromVolumes(
    [{ host_path: `${S}/meshcore-web/certs`, container_path: '/etc/certs' }],
    MESHCORE
  )
  assert.deepEqual(changedContainerPath, [`${S}/meshcore-web/certs:/etc/certs`])
  const changedHostPath = bindsFromVolumes(
    [{ host_path: `${S}/other/certs`, container_path: '/certs' }],
    MESHCORE
  )
  assert.deepEqual(changedHostPath, [`${S}/other/certs:/certs`])
})

check('options stay with their own mount when one of several is removed or added', () => {
  const edited = bindsFromVolumes(
    [
      { host_path: `${S}/meshcore-web/certs`, container_path: '/certs' },
      { host_path: `${S}/extra`, container_path: '/extra' },
    ],
    MESHCORE
  )
  assert.deepEqual(edited, [`${S}/meshcore-web/certs:/certs:ro`, `${S}/extra:/extra`])
})

check('the same host folder mounted twice keeps each mount its own options', () => {
  const binds = [`${S}/x:/one:ro`, `${S}/x:/two`]
  assert.deepEqual(bindsFromVolumes(volumesFromBinds(binds), binds), binds)
})

check('no mounts in, no mounts out', () => {
  assert.deepEqual(volumesFromBinds([]), [])
  assert.deepEqual(bindsFromVolumes([], MESHCORE), [])
})

console.log(`\n${passed} checks passed`)
