# One-time setup for timer notifications (Web Push). Secrets are kept in memory, stored DPAPI-encrypted in
# %LOCALAPPDATA%\sand-gallery\ and as Worker secrets. Nothing secret is printed. Prints only the PUBLIC VAPID key.
#   vapid-private.key  -> Worker secret VAPID_PRIVATE_JWK
#   hook-secret.key    -> Worker secret HOOK_SECRET and private.hook_config in the database
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $env:LOCALAPPDATA 'sand-gallery'
$gs = Join-Path $root 'infra\get-secret.ps1'

function Save-Secret([string]$name, [string]$plain) {
    $sec = ConvertTo-SecureString $plain -AsPlainText -Force
    ConvertFrom-SecureString $sec | Set-Content -Path (Join-Path $dir "$name.key") -Encoding ascii
}

# VAPID key pair
$json = node (Join-Path $PSScriptRoot 'gen-vapid.mjs') | Out-String
$obj = $json | ConvertFrom-Json
Save-Secret 'vapid-private' ($obj.privateJwk | ConvertTo-Json -Compress)
$public = $obj.publicKey
Remove-Variable json, obj

# hook secret
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hook = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
Save-Secret 'hook-secret' $hook
& powershell -NoProfile -File (Join-Path $PSScriptRoot 'migrate.ps1') -Sql "insert into private.hook_config (id, url, secret) values (1, 'https://api.thesandgallery.workers.dev/api/hooks/session', '$hook') on conflict (id) do update set url = excluded.url, secret = excluded.secret" | Out-Null
Remove-Variable hook

# Worker secrets (piped through cmd so no newline is added)
$env:CLOUDFLARE_API_TOKEN = & powershell -NoProfile -File $gs -Name cloudflare-api-token
$env:CLOUDFLARE_ACCOUNT_ID = '92c0925f1726a45f64556448560d3cd0'
Push-Location (Join-Path $root 'worker')
foreach ($p in @(@('vapid-private', 'VAPID_PRIVATE_JWK'), @('hook-secret', 'HOOK_SECRET'))) {
    cmd /c "powershell -NoProfile -File `"$gs`" -Name $($p[0]) | npx wrangler secret put $($p[1]) 2>&1" | Select-Object -Last 1
}
Pop-Location
$env:CLOUDFLARE_API_TOKEN = ''
Write-Host "VAPID public key: $public"
