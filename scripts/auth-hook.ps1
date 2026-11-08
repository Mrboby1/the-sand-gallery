param(
    [ValidateSet('status', 'enable', 'disable')][string]$Action = 'status'
)
# Turns the Supabase Auth hook "before user created" (public.hook_before_user_created, migration 0011) on or off.
# With it on, Google sign-in creates accounts only for e-mails on public.allowed_emails.
# The access token is decrypted in memory only; it is never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$ref = 'etpckqbzxaqbupvatcuy'
$token = & powershell -NoProfile -File (Join-Path $root 'infra\get-secret.ps1') -Name supabase-access-token
$headers = @{ Authorization = "Bearer $token" }
$uri = "https://api.supabase.com/v1/projects/$ref/config/auth"

if ($Action -ne 'status') {
    $body = @{
        hook_before_user_created_enabled = ($Action -eq 'enable')
        hook_before_user_created_uri     = 'pg-functions://postgres/public/hook_before_user_created'
    } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
}
$cfg = Invoke-RestMethod -Uri $uri -Headers $headers
[pscustomobject]@{
    enabled = $cfg.hook_before_user_created_enabled
    uri     = $cfg.hook_before_user_created_uri
} | ConvertTo-Json
