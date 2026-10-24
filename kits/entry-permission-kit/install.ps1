param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)

$ErrorActionPreference = "Stop"
Write-Host "No additional kit setup required. Python packages are listed in requirements.txt; the initial administrator is created with python -m app.entry_permission.create_admin."
