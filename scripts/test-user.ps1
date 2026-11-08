param(
    [ValidateSet('create', 'delete')][string]$Action = 'create',
    [string]$Email = 'sand-test@example.com',
    # create: where to write the session JSON (for injecting into a test browser). Delete the file afterwards.
    [string]$SessionFile
)
# E2E testing helper: creates a confirmed email/password test user through the Supabase admin API and
# writes a fresh session for it, or deletes the test user (and, via ON DELETE CASCADE, all its rows).
# Secrets are decrypted in memory only and never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$url = 'https://etpckqbzxaqbupvatcuy.supabase.co'
$anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cGNrcWJ6eGFxYnVwdmF0Y3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNTQzNDgsImV4cCI6MjEwOTczMDM0OH0.B0nGdU06yayLXeTo8k8RlmaqFu3KJT3YrxCSyUd17Ls'
$svc = & powershell -NoProfile -File (Join-Path $root 'infra\get-secret.ps1') -Name supabase-service-role
$admin = @{ Authorization = "Bearer $svc"; apikey = $svc }

function Find-User {
    $list = Invoke-RestMethod -Uri "$url/auth/v1/admin/users?per_page=200" -Headers $admin
    $list.users | Where-Object { $_.email -eq $Email } | Select-Object -First 1
}

if ($Action -eq 'delete') {
    $u = Find-User
    if ($u) { Invoke-RestMethod -Method Delete -Uri "$url/auth/v1/admin/users/$($u.id)" -Headers $admin | Out-Null; Write-Host "deleted $($u.id)" }
    else { Write-Host 'no test user' }
    return
}

$pw = [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
$u = Find-User
if ($u) {
    Invoke-RestMethod -Method Put -Uri "$url/auth/v1/admin/users/$($u.id)" -Headers $admin -ContentType 'application/json' -Body (@{ password = $pw } | ConvertTo-Json) | Out-Null
} else {
    $u = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/admin/users" -Headers $admin -ContentType 'application/json' `
        -Body (@{ email = $Email; password = $pw; email_confirm = $true; user_metadata = @{ full_name = 'Sand Test' } } | ConvertTo-Json)
}
$session = Invoke-RestMethod -Method Post -Uri "$url/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon } `
    -ContentType 'application/json' -Body (@{ email = $Email; password = $pw } | ConvertTo-Json)
if ($SessionFile) { [IO.File]::WriteAllText($SessionFile, ($session | ConvertTo-Json -Depth 10 -Compress)) }
Write-Host "test user $($u.id)"
