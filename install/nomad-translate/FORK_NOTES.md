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
- **On a Mac the image needs x86 emulation.** It is `linux/amd64` only (see
  "amd64 only" in `README.md`). The seeder entry names the platform in its
  container config, and `DockerService` passes it to the pull and to the create
  on install, update and recreate (`admin/app/utils/container_platform.ts`), so
  Docker fetches the amd64 image. The container engine's emulation then has to
  run it: Rosetta where the engine has it switched on, QEMU where it does not.
- **The seeder entry is upstream's** apart from the platform and the display
  order (13 here, to fit this fork's range; 28 upstream). It keeps the 8460 port
  and a `models` folder under the NOMAD storage root, and depends on the
  Information Library (`nomad_kiwix_server`), which it proxies. The card sits in
  the Knowledge & maps deck.

## Not yet seen working on a Mac

Nothing here has run against Docker. The two Python test files below pass, and
the platform handling is covered by
`admin/tests/standalone/container_platform.standalone.ts`.

**The open question is AVX under Rosetta.** The `bergamot` 0.4.5 wheel the
image installs was compiled with `-march=core-avx-i` (the flag is in the
library's build strings), and its module start-up, `PyInit__bergamot`, executes
AVX instructions (`vpxor`, `vmovdqa`) before it does anything else. `proxy.py`
imports the engine lazily, on the first translation, so the container starts and
passes the library through untouched. If the emulator does not run AVX, choosing
a language kills the proxy with an illegal-instruction signal. The proxy is the
container's main process, so the container restarts.

What is known about Rosetta and AVX:

- Apple's page on Rosetta for Mac apps says it "translates all `x86_64`
  instructions, including ones from the AVX and AVX2 instruction set, but it
  doesn't support the execution of AVX512 vector instructions"
  ([About the Rosetta translation environment](https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment)).
- Apple's page for Linux guests says nothing about AVX
  ([Running Intel Binaries in Linux VMs](https://developer.apple.com/documentation/virtualization/running-intel-binaries-in-linux-vms)).
- A thread on the Apple Developer Forums reported in November 2024 that there
  was no way to enable AVX1/2 for Rosetta in a Linux VM, although an
  environment variable did it for Mac apps. In April 2025 the same person said
  Linux support still seemed to be missing and filed an enhancement request. The
  thread has no Apple answer on whether that has changed since
  ([thread 769486](https://developer.apple.com/forums/thread/769486)).

Check on a Mac before relying on the app. It takes a few seconds:

```
docker run --rm --platform linux/amd64 --entrypoint python \
  ghcr.io/crosstalk-solutions/project-nomad-translate:0.1.1 -c "import bergamot; print('ok')"
```

`ok` means the engine loads. "Illegal instruction", or exit status 132, means
this emulator cannot run it. Docker Desktop has a Rosetta switch in its General
settings; with it off the engine uses QEMU instead. Whether QEMU runs this
engine has not been tried.

If it does fail after the app is installed, the chosen language is kept in a
cookie for a year, so the translated address keeps failing after the container
restarts. Opening `http://localhost:8460/nomad-lang?set=` sets it back to the
original language. The Information Library at its own address is not involved.

Also not yet seen: the first-start model download, and how long an article takes
to translate when emulated.

## Building a native arm64 image later

`README.md` says ARM "would need marian's `ruy` path" (under "amd64 only") and
names `mozilla/translations` (`inference/`) as the maintained successor to the
engine (under "Runtime"). Whether that project can be built for arm64 is not
established here. caweis/project-nomad#54 tracks it.

When an arm64 image exists, change `container_image` in the seeder entry and
remove `platform` from its `container_config`. A new pin in the seeder reaches
installs made after it. An install that is already running keeps its image until
it is updated or reinstalled, and one that has been edited is skipped by the
reseed altogether (editing marks it), so for those the image is changed in the
Edit dialog or by reinstalling. The Dockerfile here would be replaced rather
than edited.

## Tests

No Bergamot and no network are needed:

```
python3 install/nomad-translate/test_blocks.py
python3 install/nomad-translate/test_fetch_models.py
```
