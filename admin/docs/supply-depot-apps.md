# Supply Depot Apps

The Supply Depot is where you install apps onto your NOMAD. Each one runs in its own container on the device, fully offline, and shows up with an **Open** button once it finishes installing.

This page covers what you need to know to get going with each app *on NOMAD specifically*: whether you log in, where your files end up, and anything to have on hand first. It does not teach the apps themselves. Each is its own open-source project with its own documentation, and there's a link out to that for every one.

A note on logins: a couple of these apps have their own accounts, separate from your NOMAD login. Where one asks you to sign in, the starting credentials are below.

---

## Editing an app {% #editing-apps %}

**Edit** is in the ⋯ menu (More actions) of every installed app that runs in a container, whether NOMAD ships it or you added it. The AI Assistant runs on the Mac itself, so it has no Edit. The dialog shows the app's image, display name, port mappings, volume mounts, environment variables and resource limits. **Save & Recreate** applies your changes by recreating the app's container. Anything the app keeps in a folder under NOMAD's storage is left as it is.

For an app NOMAD ships, your changes are merged into the setup it came with, so settings the form does not show are kept. The catalog also stops re-syncing an app you have edited, and a **modified** tag appears next to its name to show which ones. A later change to the app's catalog entry, such as a new port, will not reach an app with that tag.

---

## Information Library {% #information-library %}

Offline copies of Wikipedia, medical references, how-to guides, and full encyclopedias, all readable in your browser with no internet. This is the reading side of NOMAD: you download content libraries (called ZIM files) and browse them here.

**Powered by:** [Kiwix](https://kiwix.org) · **Source:** [github.com/kiwix/kiwix-tools](https://github.com/kiwix/kiwix-tools)

**First time you open it:** It opens to whatever libraries you've downloaded. A fresh NOMAD starts empty, so if there's nothing to read yet, head to the ZIM downloader (under the library tools in the Command Center) and grab a library or two first. Wikipedia is the usual starting point.

**Your data:** Libraries live in the `zim` folder on your NOMAD (the same `zim` you see in File Browser). Each one is a single self-contained file, so backing up that folder backs up everything you've collected.

**Works offline:** Fully offline, which is the entire point. Everything you read is served from files already on your NOMAD. Downloading new libraries is the only part that needs a connection.

## Education Platform {% #education-platform %}

A full offline learning platform: video courses, exercises, and lessons organized into channels you download ahead of time. It's built for classrooms without reliable internet, and it works the same on a NOMAD at home.

**Powered by:** [Kolibri](https://learningequality.org/kolibri/) · **Source:** [github.com/learningequality/kolibri](https://github.com/learningequality/kolibri)

**First time you open it:** Kolibri walks you through a short setup wizard the first time, where you create an admin account and name the facility. Pick a password you'll remember, since this account manages the whole install. After setup you import channels (the course content) from Kolibri's own catalog while you're online, and from then on they play offline.

**Your data:** Your account, progress, and imported channels live in the `kolibri` folder on your NOMAD. Channels can be large, so keep an eye on space if you import a lot.

**Works offline:** Once channels are imported, everything plays offline: videos, exercises, and progress tracking all run on your NOMAD. Importing new channels is the only step that needs a connection.

## AI Assistant {% #ai-assistant %}

A local AI chat that runs entirely on your hardware. Ask it questions, have it summarize or draft text, or point it at your own documents (the Knowledge Base) to answer from them. Nothing you type leaves the device.

**Powered by:** [Ollama](https://ollama.com) and Apple MLX · **Source:** [github.com/ollama/ollama](https://github.com/ollama/ollama)

On the Mac edition the AI runs **natively on your Mac**, on the Metal GPU, not inside a container. There are two engines, and which one you're on changes a couple of details:

- **Ollama** serves both chat and document-search embeddings, Metal-accelerated. Works on any supported Mac.
- **Apple MLX** (the `omlx` backend) serves chat with higher throughput on Apple Silicon. On this backend a small Ollama runs alongside it just for the embeddings used in document search.

You don't have to choose during install. Switch engines any time from Terminal with `nomad backend show`, `nomad backend ollama`, or `nomad backend omlx`. Switching keeps both sets of model weights on disk, so going back and forth never re-downloads anything. Either way, the chat page, the model list, and document upload all work the same. There's a deeper writeup in the **AI & Local Models** doc.

**First time you open it:** It opens straight to the chat, no login. If no model is downloaded yet, pull one from **Settings → AI** in the Command Center first.

**Your data:** Chats are stored on your NOMAD. Models live on your data drive (or `~/.ollama` for your own Ollama models); the embedding model for document search stays on the internal disk so search keeps working even with the data drive unplugged.

**Updating it:** Because the AI runs on the host rather than in a container, you update it from the host with `nomad upgrade`, not with a container update. The card reflects this: on the MLX backend there's no Ollama "Update" button, since updating Ollama wouldn't touch the chat engine.

**Works offline:** Fully offline once a model is downloaded. The only step that needs a connection is pulling a new model.

## Notes {% #notes %}

A clean, no-frills note-taking app. Write in plain Markdown, search across everything, and keep it all on your NOMAD. Good for anything from a quick list to longer reference notes you want available offline.

**Powered by:** [FlatNotes](https://github.com/dullage/flatnotes) · **Source:** [github.com/dullage/flatnotes](https://github.com/dullage/flatnotes)

**First time you open it:** It opens straight to your notes, no login. NOMAD runs FlatNotes without its sign-in screen, since on your own network it's a personal tool and a password wall just gets in the way.

**Your data:** Notes are stored as plain Markdown files in the `flatnotes` folder on your NOMAD. Because they're ordinary text files, you can read or back them up with any tool, and they're not locked inside a database.

**Works offline:** Fully offline. FlatNotes runs entirely on your NOMAD and never reaches out to the internet.

## Data Tools {% #data-tools %}

A Swiss Army knife for data: encode and decode, encrypt and decrypt, convert between formats, parse and extract, hash, and analyze. There are dozens of operations you can chain together into a "recipe," and all of it runs locally in your browser.

**Powered by:** [CyberChef](https://github.com/gchq/CyberChef) · **Source:** [github.com/gchq/CyberChef](https://github.com/gchq/CyberChef)

**First time you open it:** It opens straight to the workbench, no login. Drag operations from the left into the recipe area, paste your input, and the output updates as you go.

**Your data:** CyberChef works on whatever you paste or drop into it, in your browser. Nothing is stored on your NOMAD between sessions, so there's no folder to manage. Save a recipe you want to keep by copying it out yourself.

**Works offline:** Fully offline. Every operation runs in your browser from the copy served by your NOMAD, so it works the same connected or not.

## Grocy {% #grocy %}

A food and pantry tracker. Keep stock levels for what's in your kitchen, track expiry dates, plan meals, and build shopping lists. NOMAD's preparedness tools can read your food stock from Grocy, so what you log here feeds into your days-of-supply picture.

**Powered by:** [Grocy](https://grocy.info) · **Source:** [github.com/grocy/grocy](https://github.com/grocy/grocy)

**First time you open it:** You'll get a login screen. Sign in with username `admin` and password `admin`. **Change that password right away** from your user settings, since it's the same default on every NOMAD. Grocy starts with a demo dataset you can clear out once you're ready to enter your own stock.

**Your data:** Everything you track lives in the `grocy` folder on your NOMAD. Backing up that one folder backs up your whole pantry database.

**Connecting it to preparedness:** To have NOMAD's days-of-supply readiness read your food stock, point the preparedness settings at Grocy (there's a connection test under the Grocy settings). Once linked, the food you log shows up in your readiness totals automatically.

**Works offline:** Fully offline. Grocy runs entirely on your NOMAD.

## Meshtastic Web {% #meshtastic-web %}

A browser-based control panel for [Meshtastic](https://meshtastic.org) devices. Meshtastic is off-grid, long-range radio messaging: small, inexpensive LoRa radios that form their own mesh network and send text messages and GPS locations for miles with no cell service, no internet, and no fees. This app is how you configure those radios and read and send messages from a full-size screen.

**Official site:** [meshtastic.org](https://meshtastic.org) · **Source:** [github.com/meshtastic/web](https://github.com/meshtastic/web)

**You need a Meshtastic radio to use this.** This app is just the control panel. On its own it opens to a "No devices connected" screen, because the actual work happens on a physical Meshtastic device (and the network of other radios it talks to). If you don't have one yet, the app won't do much.

**The NOMAD-specific catch (Bluetooth and Serial need HTTPS):** Browsers only allow a website to use Bluetooth or USB when the page is loaded over a secure (HTTPS) connection. NOMAD serves Meshtastic Web over plain HTTP, so on NOMAD the **Bluetooth and Serial options won't connect**, your browser blocks them. The one that works is **HTTP**: put your Meshtastic radio on the same Wi-Fi network (Meshtastic radios can join Wi-Fi), then connect to it here by its IP address. If you specifically need to pair over USB or Bluetooth, do that from the official Meshtastic phone app or the Meshtastic website instead.

**Works offline:** Fully offline, which is the entire point of Meshtastic. The app is served from your NOMAD, and talking to your radios happens over your local network or radio, never the internet. The only online bits are the links in the footer, which don't matter for using your mesh.

## MeshCore Web {% #meshcore-web %}

A browser-based client for [MeshCore](https://meshcore.io) radios. MeshCore is another take on off-grid, long-range LoRa mesh messaging, a sibling to Meshtastic: small radios that form their own network and pass text and location for miles with no cell service, no internet, and no fees. This app is how you configure a MeshCore radio and read and send messages from a full-size screen. If you're not already running MeshCore gear, the Meshtastic client above is the more common starting point. This one is here for people who use MeshCore.

**Official site:** [meshcore.io](https://meshcore.io) · **Source:** [github.com/aXistem-dev/meshcore-web](https://github.com/aXistem-dev/meshcore-web) (a packaged build of Liam Cottle's MeshCore client)

**You need a MeshCore radio to use this.** Like the Meshtastic client, this is just the control panel. With no radio connected, there's nothing for it to talk to.

**First time you open it, you'll see a security warning. That's expected, here's why:** MeshCore connects to your radio over USB or Bluetooth, and browsers only let a web page use USB or Bluetooth when the page is loaded over a secure (HTTPS) connection. So NOMAD serves this app over HTTPS, and because your NOMAD is a private device with no public web address, it uses a self-signed certificate that browsers warn about the first time they see it. To get past it once:

1. Click **Open** on the MeshCore Web card. Your browser shows something like *"Your connection is not private"* or *"Not secure."*
2. Click **Advanced**, then **Proceed to (your NOMAD's address)**. (On some browsers the button says "Continue" or "Accept the Risk.")
3. You'll land in MeshCore Web. Your browser remembers your choice, so you won't see the warning again on that device.

**Connecting your radio:** Use **Chrome or Edge**, which have the best support for browser USB and Bluetooth. Plug the radio into the computer you're browsing from (USB), or have it nearby (Bluetooth), then connect to it from inside the app. The radio connects to **the computer you're using**, not to the NOMAD itself, so connect from a device that has the radio plugged in or in Bluetooth range. Some phones are stricter about self-signed certificates and may refuse to connect; a desktop Chrome or Edge is the most reliable.

**Your data:** There's nothing to set up or store on your NOMAD for this app. Your radio's settings live on the radio itself, and the app's preferences live in your browser. There's no NOMAD folder to manage.

**Works offline:** Fully offline, which is the whole point of MeshCore. The app is served from your NOMAD and talks to your radio directly over USB or Bluetooth, never the internet.

## Mesh Bridge {% #mesh-bridge %}

Off-grid AI over a LoRa mesh radio. Text a question into the mesh and the bridge runs it through NOMAD's onboard AI, then sends the answer back to the radio. It's how someone miles away with nothing but a Meshtastic or MeshCore radio can reach the AI on your NOMAD.

**Powered by:** NOMAD · **Source:** [github.com/caweis/project-nomad](https://github.com/caweis/project-nomad)

**You need a mesh radio for the real thing.** The bridge talks to a Meshtastic or MeshCore radio attached to your NOMAD. In this early build it runs against a mock radio so you can see the flow end to end before the hardware adapters land, so it's useful for trying out even without a radio plugged in.

**How it works:** The bridge listens on the mesh, hands incoming messages to the same onboard AI the chat page uses, and replies over the radio. Because the AI runs locally, the whole loop stays offline; no message ever touches the internet.

**Your data:** The bridge holds no library of its own. It passes messages to the AI Assistant and relays answers, so the AI's models and your chat settings are what drive it.

**Works offline:** Fully offline by design. The point is to answer questions for people with no connection at all, using only your NOMAD and the mesh.

## Password Vault {% #password-vault %}

A self-hosted password manager that keeps your logins, secure notes, and other secrets on your NOMAD instead of someone else's cloud. It speaks the Bitwarden protocol, so the regular Bitwarden apps and browser extensions connect to it.

**Powered by:** Vaultwarden · **Source:** [github.com/dani-garcia/vaultwarden](https://github.com/dani-garcia/vaultwarden)

**How it works:** Point a Bitwarden client at your NOMAD's address and it stores and syncs your vault locally. This build serves over plain HTTP on the local network. Passkeys and other WebAuthn logins need an HTTPS address, which is a planned follow-up; password and note storage work today.

**Your data:** The vault lives in the `vaultwarden` folder on your data drive. Back that folder up and you've backed up every credential.

**Works offline:** Fully offline. Your vault never leaves your NOMAD unless you set up syncing yourself.

## PDF Tools {% #pdf-tools %}

A toolbox for working with PDFs: merge several into one, split one apart, rotate or reorder pages, convert to and from images and other formats, compress, and more. Everything runs on your NOMAD, so a document you're working on never gets uploaded anywhere.

**Powered by:** Stirling-PDF · **Source:** [github.com/Stirling-Tools/Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)

**How it works:** Open the app, drop in a PDF, pick an operation, and download the result. The work happens in the container on your NOMAD.

**Your data:** Settings and any custom assets live in the `stirling-pdf` folder on your data drive. The PDFs you process are not kept after you download them.

**Works offline:** Fully offline. No file ever leaves your NOMAD.

## IT Tools {% #it-tools %}

A grab-bag of small utilities that developers and tinkerers reach for: encoders and decoders, hash and UUID generators, formatters, color and date converters, and dozens more. Each one runs in the browser.

**Powered by:** IT-Tools · **Source:** [github.com/CorentinTh/it-tools](https://github.com/CorentinTh/it-tools)

**How it works:** Open the app and pick a tool from the list. The tools run client-side in your browser, served from your NOMAD.

**Your data:** Nothing is stored. There's no NOMAD folder to manage for this app.

**Works offline:** Fully offline. The whole toolset is served from your NOMAD.

## Whiteboard {% #whiteboard %}

A virtual whiteboard for quick diagrams, sketches, and plans, with a hand-drawn look. Good for mapping out an idea, a layout, or a plan when you want something more freeform than text.

**Powered by:** Excalidraw · **Source:** [github.com/excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)

**How it works:** Open the app and draw. Export a drawing as an image or a file when you want to keep it.

**Your data:** Drawings live in your browser's local storage, not on the NOMAD. Export anything you want to keep so it isn't lost if you clear your browser.

**Works offline:** Fully offline. The app is served from your NOMAD and runs entirely in your browser.

## eBook Library {% #ebook-library %}

A reader and browser for your ebook collection. Point it at a folder of books and it gives you a searchable library with covers and metadata, readable in the browser, with an OPDS feed for ereader apps.

**Powered by:** Calibre-Web · **Source:** [github.com/janeczku/calibre-web](https://github.com/janeczku/calibre-web)

**How it works:** Put your books in the `calibre-web/books` folder on your data drive, then browse and read them from the app. It reads an existing Calibre library if you have one.

**Your data:** The app's database lives in the `calibre-web` folder and your books in `calibre-web/books`, both on your data drive.

**Works offline:** Fully offline. Your library is served from your NOMAD.

---

## Translated Library {% #offline-translation %}

Reads the Information Library in another language. Open an article and a **Translate this page** bar appears at the top with a button for each installed language, plus **Original** to switch back. Your choice sticks as you click through to other articles.

**Powered by:** Bergamot, the translation engine behind Firefox's built-in page translation · **Source:** [github.com/browsermt/bergamot-translator](https://github.com/browsermt/bergamot-translator)

**Why this instead of the AI Assistant:** the AI Assistant can translate, but this is a purpose-built translation engine. It runs on the processor, needs no GPU and no model to be loaded, and it is more careful with names: asked to translate a page, a chat model will happily translate "Project NOMAD" into another language, and this will not. It needs the Information Library installed first, and installs it if it is missing.

**On a Mac:** the engine is built for Intel (x86) processors and has no Apple Silicon build, so on an Apple Silicon Mac it runs under emulation. That costs some speed.

**Choosing languages:** French, Spanish and German are set up by default. To add or remove languages:

1. In the **Supply Depot**, open the ⋯ menu on the Translated Library and choose **Edit**.
2. Under **Environment Variables**, find `TRANSLATE_LANGS=fr,es,de`.
3. Change the list of language codes, separated by commas. For example, `TRANSLATE_LANGS=fr,es,de,sv` adds Swedish.
4. Click **Save & Recreate**. The app restarts, downloads any new languages, and adds a button for each one to the **Translate this page** bar.

Adding a language needs an internet connection, and each one takes between about 45 MB and 140 MB of disk. Languages you already have keep working offline. Removing a code from the list does not remove a language you have already downloaded; it stays in `storage/translate/models` and keeps its button. Like any edit, this marks the app as modified (see Editing an app, above).

These 50 languages are available. Chinese is not available yet.

| Language | Code |
|---|---|
| Afrikaans | `af` |
| Arabic | `ar` |
| Basque | `eu` |
| Bengali | `bn` |
| Bosnian | `bs` |
| Bulgarian | `bg` |
| Catalan | `ca` |
| Croatian | `hr` |
| Czech | `cs` |
| Danish | `da` |
| Dutch | `nl` |
| Estonian | `et` |
| Finnish | `fi` |
| French | `fr` |
| Galician | `gl` |
| German | `de` |
| Greek | `el` |
| Gujarati | `gu` |
| Hebrew | `he` |
| Hindi | `hi` |
| Hungarian | `hu` |
| Icelandic | `is` |
| Indonesian | `id` |
| Italian | `it` |
| Japanese | `ja` |
| Kannada | `kn` |
| Korean | `ko` |
| Latvian | `lv` |
| Lithuanian | `lt` |
| Malay | `ms` |
| Malayalam | `ml` |
| Marathi | `mr` |
| Norwegian | `nb` |
| Persian | `fa` |
| Polish | `pl` |
| Portuguese | `pt` |
| Romanian | `ro` |
| Russian | `ru` |
| Serbian | `sr` |
| Slovak | `sk` |
| Slovenian | `sl` |
| Spanish | `es` |
| Swedish | `sv` |
| Tamil | `ta` |
| Telugu | `te` |
| Thai | `th` |
| Turkish | `tr` |
| Ukrainian | `uk` |
| Urdu | `ur` |
| Vietnamese | `vi` |

**First start needs internet.** The language models download when the app first runs, the same as installing any other app. After that it is entirely offline. If you install this while disconnected the app still starts and the library still works, just without translation until it can fetch the models. The models come from Mozilla, the same source Firefox uses for its own translation, under the MPL-2.0 licence.

**What it does not translate:** tables and infoboxes, the page title in your browser tab, and Kiwix's own search results. Searching also still matches the original language, so look things up in English and translate the article you land on.

**A note on two language buttons:** the library's own toolbar has a globe that changes the *menus* around the page. The bar this app adds changes the *article*. They are different things and sit close together, which is unfortunate but not something we can move.

**Accuracy:** this is machine translation, and it is literal. It is very good for getting the sense of an article. Be careful relying on it for exact medical or safety wording, where the correct term in another language is often not the literal one.

**Your data:** language models live in `storage/translate/models`. Nothing you read is stored or sent anywhere.

**Works offline:** yes, once the models have downloaded.
