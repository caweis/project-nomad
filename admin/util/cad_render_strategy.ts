/**
 * Workshop CAD thumbnail renderer strategy dispatcher.
 *
 * Pure module (no Lucid / HTTP imports) — unit-testable without booting
 * the AdonisJS container. Mirrors the file_classification.ts pattern.
 *
 * Given a lowercase extension (including the leading dot), returns the
 * render strategy to apply. The caller is responsible for lowercasing
 * before calling (StlScannerService passes extname(row.path).toLowerCase()).
 *
 * Strategies:
 *   f3d   — zip-extract embedded preview PNG via yauzl + sharp (zero new deps)
 *   dxf   — ezdxf + matplotlib shell-out via dxf_thumb.py
 *   scad  — openscad + xvfb shell-out
 *   icon  — no render available; UI shows per-type icon (never sets thumbnail_failed)
 */

export type CadRenderStrategy = 'f3d' | 'dxf' | 'scad' | 'icon'

/**
 * Map a CAD file extension to its render strategy.
 *
 * Accepts lowercase extensions with a leading dot (the canonical form from
 * `extname(path).toLowerCase()`). Returns 'icon' for any extension that
 * has no renderer, including .step, .stp, .iges, and .dwg.
 *
 * @example
 *   cadRenderStrategy('.f3d')   // 'f3d'
 *   cadRenderStrategy('.dxf')   // 'dxf'
 *   cadRenderStrategy('.scad')  // 'scad'
 *   cadRenderStrategy('.step')  // 'icon'
 *   cadRenderStrategy('.dwg')   // 'icon'
 */
export function cadRenderStrategy(ext: string): CadRenderStrategy {
  // Normalise: lowercase, ensure leading dot — defensive against callers
  // that haven't normalised yet (documents the contract via the example above
  // but tolerates '.DXF' just in case).
  const normalised = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`

  switch (normalised) {
    case '.f3d':
      return 'f3d'
    case '.dxf':
      return 'dxf'
    case '.scad':
      return 'scad'
    default:
      // .step, .stp, .iges, .dwg, and anything unknown → icon
      return 'icon'
  }
}
