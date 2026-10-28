param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)

$ErrorActionPreference = "Stop"
Write-Host "No additional kit setup required. Python packages are listed in requirements.txt; the factory tables are created by the system init step (python -m app.system_init)."
