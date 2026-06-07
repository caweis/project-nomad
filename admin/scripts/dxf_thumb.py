#!/usr/bin/env python3
"""
dxf_thumb.py <input.dxf> <output.png> [size]

Renders the first modelspace of a DXF file to a PNG thumbnail.
Uses ezdxf draw + matplotlib Agg — fully headless, no display required.
Exit 0 on success, non-zero on error (message to stderr).
"""
import sys, os
import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def main():
    if len(sys.argv) < 3:
        print("usage: dxf_thumb.py <input.dxf> <output.png> [size]", file=sys.stderr)
        sys.exit(1)

    dxf_path = sys.argv[1]
    out_path  = sys.argv[2]
    size      = int(sys.argv[3]) if len(sys.argv) > 3 else 256

    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as e:
        print(f"ezdxf read error: {e}", file=sys.stderr)
        sys.exit(2)

    msp = doc.modelspace()
    fig = plt.figure(figsize=(size / 96, size / 96), dpi=96)
    ax  = fig.add_axes([0, 0, 1, 1])
    ctx = RenderContext(doc)
    out = MatplotlibBackend(ax)
    Frontend(ctx, out).draw_layout(msp, finalize=True)

    fig.savefig(out_path, dpi=96, format='png', bbox_inches='tight',
                facecolor='white')
    plt.close(fig)

if __name__ == '__main__':
    main()
