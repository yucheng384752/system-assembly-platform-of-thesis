param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)
$ErrorActionPreference = "Stop"
Write-Host "product-process-kit: product lines, models, recipes, specs and form definitions enabled."
Write-Host "  Backend: /product-lines, /product-models, /forms"
Write-Host "  Requires entry-permission-kit (entry points and product-line scope type) and platform database session."
Write-Host "  Load a line definition file with app.core.seed_loader.apply_seed after migration."
