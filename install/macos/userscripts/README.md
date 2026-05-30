# Userscripts — small UI patches for the admin

These are browser userscripts that patch annoying UI behavior in the admin
without forking the admin code itself. Install once per browser; they survive
admin upgrades.

## What's here

| File | What it does | Upstream issue |
|---|---|---|
| `admin-same-tab.user.js` | Strips `target="_blank"` from every link on the admin so service tiles open in the **same tab** instead of stacking up an open-tab graveyard. Includes a MutationObserver so SPA-rendered content stays clean, and a click-interceptor as a safety net. | [Crosstalk-Solutions/project-nomad#866](https://github.com/Crosstalk-Solutions/project-nomad/issues/866) |

## Install

Pick the userscript manager that matches your browser, then drag the `.user.js`
file onto its dashboard (or open the file in the browser — the manager will
prompt to install).

| Browser | Manager |
|---|---|
| Safari (macOS) | [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887) (App Store, free) |
| Chrome / Brave / Arc | [Tampermonkey](https://www.tampermonkey.net/) |
| Firefox | [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/) |
| Edge | [Tampermonkey](https://www.tampermonkey.net/) |

After install:
1. Open the manager's dashboard.
2. Open `admin-same-tab.user.js` in this directory (e.g., drag it into the
   dashboard, or visit `file:///.../admin-same-tab.user.js` and the manager
   prompts).
3. Confirm install. The script auto-enables.
4. Reload http://nomad.local:8080 (or http://localhost:8080) and click a
   service tile — it should open in the same tab.

The `@match` patterns cover `localhost`, `*.local`, and every private IPv4
range that's likely to host a NOMAD admin (192.168.x.x, 10.x.x.x, 172.16–31.x.x).

## Why this isn't fixed upstream yet

The admin source code hardcodes `target="_blank"` on service-card anchors. A
proper fix lives in the admin's React components (see issue #866). Until that
ships, this userscript intercepts at the browser layer — zero risk of being
overwritten on the next admin image pull.

## Uninstall

In the userscript manager's dashboard, find "NOMAD admin — same-tab navigation"
and click the trash icon. The admin reverts to default new-tab behavior on next
reload.
