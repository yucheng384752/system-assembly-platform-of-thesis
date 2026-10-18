param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)
$ErrorActionPreference = "Stop"
Write-Host "batch-production-kit: batch open, dispatch, measurement entry, material weighing, sign-off and completion enabled."
Write-Host "  Backend: /batches"
Write-Host "  Requires entry-permission-kit, product-process-kit and platform database session."
Write-Host "  Apply settings with app.core.batch_settings.configure(load_batch_settings(raw)) at startup."
