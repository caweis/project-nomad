# Fork notes

Everything else in this directory is a verbatim copy of upstream's
`install/nomad-translate/` at v1.35.1: offline translation (#1292, `1b67a872`)
and the two fixes released after it, for redirects (#1379, `eef5b6cd`) and for
languages with a pre-release model (#1405, `ee203df4`). It is deliberately
unedited, so a later upstream change can be brought across by copying the files
over. Whatever is particular to this fork is in this file, or outside this
directory.

## What the fork does differently

- **No image is built or published here.** The Supply Depot entry pulls
  upstream's published `ghcr.io/crosstalk-solutions/project-nomad-translate:0.1.1`.
  Upstream's build workflow (`.github/workflows/build-translate-proxy.yml`,
  `85da9280`) is not ported: it pushes to their registry, and only the users on
  their deployment list can run it.
- **On a Mac it runs under emulation.** The image is `linux/amd64` only (see
  "amd64 only" in `README.md`: Bergamot's `intgemm` backend is x86 specific).
  The seeder entry names the platform in its container config, and
  `DockerService` passes it to the pull and to the create on install, update
  and recreate (`admin/app/utils/container_platform.ts`), so Docker fetches the
  amd64 image and the engine's emulation (Rosetta, where it is switched on)
  runs it.
- **The seeder entry is otherwise upstream's**, with its 8460 port and a
  `models` folder under the NOMAD storage root. It depends on the Information
  Library (`nomad_kiwix_server`), which it proxies.

## Not yet seen working on a Mac

Written and tested as far as a machine without Docker allows: the Python tests
below pass, and the platform handling is covered by
`admin/tests/standalone/container_platform.standalone.ts`. Not yet seen:

- the amd64 image starting under Rosetta (Docker Desktop, OrbStack or Colima);
- `intgemm` choosing a code path that the emulator supports;
- the first-start model download, and how fast a page translates when emulated.

If the app will not start on a given Mac, the Information Library is not
affected: the translation app is a separate container in front of it.

## Building a native arm64 image later

The README's "Runtime" section names the way: `mozilla/translations`
(`inference/`) can be built with marian's `ruy` backend, which is what ARM
needs. When that image exists, change the seeder's `container_image`, drop
`platform` from its `container_config`, and this fork can stop emulating. The
Dockerfile here would be replaced rather than edited.

## Tests

No Bergamot and no network are needed:

```
python3 install/nomad-translate/test_blocks.py
python3 install/nomad-translate/test_fetch_models.py
```
