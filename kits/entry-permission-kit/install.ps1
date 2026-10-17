param(
    [string]$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
)
$ErrorActionPreference = "Stop"
Write-Host "entry-permission-kit: account login, role defaults and per-account entry overrides enabled."
Write-Host "  Backend: /auth (login, me, change-password), /users (manage, entry overrides, scopes)"
Write-Host "  Requires platform settings JWT_SECRET (secret reference), ACCESS_TOKEN_EXPIRE_MINUTES, PASSWORD_MIN_LENGTH."
