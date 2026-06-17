# Supply Depot Apps

The Supply Depot is where you install apps onto your NOMAD. Each one runs in its own container on the device, fully offline, and shows up with an **Open** button once it finishes installing.

This page covers what you need to know to get going with each app *on NOMAD specifically*: whether you log in, where your files end up, and anything to have on hand first. It does not teach the apps themselves. Each is its own open-source project with its own documentation, and there's a link out to that for every one.

A note on logins: a couple of these apps have their own accounts, separate from your NOMAD login. Where one asks you to sign in, the starting credentials are below.

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

A browser-based client for [MeshCore](https://meshcore.co.uk) radios. MeshCore is another take on off-grid, long-range LoRa mesh messaging, a sibling to Meshtastic: small radios that form their own network and pass text and location for miles with no cell service, no internet, and no fees. This app is how you configure a MeshCore radio and read and send messages from a full-size screen. If you're not already running MeshCore gear, the Meshtastic client above is the more common starting point. This one is here for people who use MeshCore.

**Official site:** [meshcore.co.uk](https://meshcore.co.uk) · **Source:** [github.com/aXistem-dev/meshcore-web](https://github.com/aXistem-dev/meshcore-web) (a packaged build of Liam Cottle's MeshCore client)

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
