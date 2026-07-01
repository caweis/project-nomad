// Kiwix-serve command for library mode (issue #622). Replaces the legacy
// `*.zim --address=all` glob: kiwix-serve reads a managed library.xml and
// --monitorLibrary hot-reloads it when it changes, so adding/removing a ZIM no
// longer needs a container restart, and a single corrupt ZIM can't crash the
// whole server. Ported from upstream v1.33.0.
export const KIWIX_LIBRARY_CMD = '--library /data/kiwix-library.xml --monitorLibrary --address=all'
