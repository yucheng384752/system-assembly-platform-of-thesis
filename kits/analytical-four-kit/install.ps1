param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)

$ErrorActionPreference = "Stop"
Write-Host "Python packages are listed in requirements.txt. Analysis files live in ANALYTICAL_FOUR_DATA_DIR (default /system/data/analytical-four)."
Write-Host "To start with the synthetic demo data set run: python -m app.analytical_four.seed_demo  (or POST /api/analytical-four/demo as an administrator)."
