# 在目標機器執行，輸出授權綁定所需的機器指紋（spec 12.2、D38）。
# 算法與 kits/platform-core-kit 的 license.py 相同：MachineGuid 去空白、轉小寫後取 UTF-8 的 SHA-256。
# 存成 UTF-8 with BOM，Windows PowerShell 5.1 才能正確讀取中文。
$ErrorActionPreference = 'Stop'
try {
    $guid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
} catch {
    Write-Error "無法讀取 MachineGuid：$($_.Exception.Message)"
    exit 1
}
$raw = "$guid".Trim().ToLowerInvariant()
if (-not $raw) { Write-Error 'MachineGuid 為空，無法產生指紋。'; exit 1 }
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $hash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($raw)) | ForEach-Object { $_.ToString('x2') }) -join ''
} finally { $sha.Dispose() }
[ordered]@{ machineFingerprint = $hash; fingerprintSource = 'windows-machine-guid' } | ConvertTo-Json -Compress
