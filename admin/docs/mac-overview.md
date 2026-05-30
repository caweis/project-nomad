# N.O.M.A.D. on Mac

This is the macOS edition of N.O.M.A.D., designed for Apple Silicon Macs (M1, M2, M3, M4 and later). It runs the same Command Center and content services you're used to, with a few changes specifically for Mac:

- **AI Assistant runs natively** on your Mac's Metal GPU instead of inside a container. That means faster responses, lower memory usage, and no Rosetta translation overhead.
- **A `nomad` command** on your Mac handles install, upgrades, repair, and lifecycle — so you don't have to remember Docker commands.
- **Your data drive is portable.** Plug it into another Mac and bring up N.O.M.A.D. from the drive itself, without an internet connection for the install code.

If you've used N.O.M.A.D. on Linux, everything you already know still applies — Wikipedia, Kolibri, FlatNotes, CyberChef, the Easy Setup wizard, Workshop. The Mac edition just adds a few extra paths and adapts a few defaults so your Mac doesn't have to pretend to be a Linux server.

---

## Where to go from here

**[Install N.O.M.A.D. on your Mac →](/docs/mac-install)**
Step-by-step setup on a fresh Apple Silicon Mac.

**[The `nomad` command →](/docs/mac-nomad-cli)**
Reference for the host-side command that wraps install, upgrades, lifecycle, and diagnostics.

**[AI Assistant on Mac →](/docs/mac-ai-assistant)**
How the AI Assistant works on your Mac, how to switch models, and how to upgrade Ollama.

**[Workshop →](/docs/mac-workshop)**
The offline catalog for your 3D-printable files (STL and 3MF).

**[Updating your N.O.M.A.D. →](/docs/mac-updates)**
The update flow on Mac — what to run when there's a new version.

**[Your data drive →](/docs/mac-drive-portability)**
What lives on the drive, how to unplug it safely, and how to set up N.O.M.A.D. on a second Mac from the drive itself.

---

## A note on the Mac edition

The Mac edition is a community fork of Project N.O.M.A.D. The original work is from Crosstalk Solutions; the Mac adaptations come from a chain of contributors — NoamanKhalil ported the foundation, proximasan added the Apple Silicon admin patches, snfettig wired up native Ollama with Metal access, and this fork ties it all together with installer and lifecycle improvements.

If you're more curious about the bones of it, the repository is at [github.com/caweis/project-nomad](https://github.com/caweis/project-nomad).
