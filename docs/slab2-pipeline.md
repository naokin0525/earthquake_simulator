# Slab2 raster pipeline

Regenerate the browser-ready grids from the paired USGS XYZ depth and thickness
files with:

```powershell
python scripts\generate_slab2_png.py
```

The script writes paired depth and thickness PNGs for the Pacific Kuril/Japan
and Izu-Bonin grids and the Philippine Sea Ryukyu/Nankai grid to
`public/data/slab2/`. Each lossless RGBA image stores one 16-bit code in red/green;
alpha is always opaque so Canvas color values are not affected by transparency.
A zero code marks a missing sample. The generated manifest stores each grid's
geographic extent and quantization scales. Depth and thickness are represented
in km at approximately 0.01 km resolution.

`Slab2Model` decodes the images using Canvas or OffscreenCanvas. Ray paths are
sampled every 5 km along a great-circle surface path with linearly interpolated
depth; the fraction of samples within the top-depth-to-bottom-depth interval
feeds travel-time and attenuation adjustments. This is a geometric ray-path
approximation, not a calibrated 3D velocity/Q inversion. The attenuation path
term is therefore a bounded model parameter and requires regional observational
calibration before being interpreted as a quantitative prediction.
