# Workshop

Workshop is the offline catalog for your 3D-printable files. Drop STL or 3MF files into folders on your data drive, click rescan, and they show up in the Command Center with thumbnails, categories, and metadata.

It's useful if you keep a personal library of printable parts for repairs, projects, or preparedness — replacement clips, tool jigs, medical splints, household widgets. The catalog stays with you offline, the same way Wikipedia and Kolibri do.

You can reach Workshop from the **Workshop** tile on the Command Center home, or directly at `/workshop`.

---

## Where files go

Drop your STL and 3MF files into your data drive at:

```
<your-data-drive>/project-nomad/storage/stl-library/<category>/<filename>.stl
```

The seven categories are:

- `medical` — splints, dosing tools, holders
- `tools` — wrenches, jigs, fixtures
- `household` — drawer pulls, hinges, brackets
- `replacement-parts` — gear, knob, clip-style replacements
- `agriculture` — coops, irrigation parts, garden tools
- `firearm-accessories` — where legal
- `other` — everything that doesn't fit cleanly

Once you've copied files in, return to the Command Center → Workshop and click **Rescan library**. The scanner walks the directory, fingerprints each file, and adds new ones to the catalog.

If you'd rather, the Terminal command `nomad stl import ~/some-folder agriculture` will copy a folder of STLs into the agriculture category and trigger a rescan automatically.

---

## Required metadata

When a file appears in Workshop for the first time, it shows up with a yellow "Needs metadata" badge. Click the card and fill in:

- **Name** — what the file is. Defaults to the filename without extension.
- **Material** — PLA, PETG, ABS, TPU, Resin, or Nylon.
- **Print time** — your slicer's estimate in minutes.
- **Difficulty** — beginner, intermediate, or advanced.

Once those four are filled in, the badge clears and the file shows up in normal grid views.

Optional fields:

- **Tags** — comma-separated, for your own grouping. Examples: `finger-splint, pediatric, single-piece`.
- **Infill %** — your typical infill setting.
- **Description** — print notes, source notes, anything useful.
- **Source URL** — where you got the file. Helpful when you want to find updates or related files later.
- **License** — freeform. CC0, CC-BY, "my own work", whatever you know. There's no enforced format — see the rights acknowledgment below.

---

## The rights acknowledgment

The first time you open Workshop, you'll see a one-time acknowledgment titled "Use at your own peril" — it explains that you're responsible for ensuring you have the right to store every file you put in the library. Workshop doesn't check licenses, doesn't enforce anything, doesn't talk to external services. What you put in your private library is your call, and your liability.

If you're unsure about a file, leave it out. The optional `license` field per file is there for tracking — write down what you know about the file's terms so you remember later. But Workshop won't refuse to show you anything based on that field.

You only see this once. Click "I understand — let me into Workshop" and it stays dismissed for all future visits.

---

## Thumbnails

The scanner generates a 256×256 PNG thumbnail for each STL or 3MF file using the bundled `stl-thumb` renderer. Thumbnails are cached in `<data-drive>/project-nomad/storage/stl-library/.thumbnails/`.

If a file is too complex or malformed for the renderer, the card shows a generic 3D-cube icon instead. The scanner marks that file as "thumbnail failed" so it won't burn CPU retrying every scan — if you want to try again later (you fixed the file, or stl-thumb got better), edit the file's metadata in the Command Center and the failure flag resets.

---

## When the data drive isn't plugged in

The Workshop catalog lives in the database, but the files themselves are on your data drive. When the drive is unplugged, the Workshop page shows a "Workshop unavailable — reconnect the drive" panel and won't let you download or open files (the database rows still exist, but the files aren't reachable until the drive comes back).

This is the same pattern as the Information Library when its drive is out. Replug the drive and refresh the Workshop page; everything comes back.

---

## Bulk import

If you have a directory of STLs you want to add all at once:

```
nomad stl import ~/Downloads/printables-cache tools
```

That copies every `.stl` and `.3mf` recursively under the source directory into your library's `tools/` folder, skipping any files that are already there. Then it triggers a rescan so the new files appear in the Command Center.

You can also organize the source directory by category beforehand and import with the default `other`, then re-categorize each file from the Workshop UI.
