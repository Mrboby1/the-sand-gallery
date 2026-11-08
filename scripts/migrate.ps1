param(
    # Run only files whose name matches this pattern (default: all migrations, in order). They are idempotent.
    [string]$Pattern = '*.sql',
    # Run an ad-hoc SQL string instead of the migration files (prints the JSON result).
    [string]$Sql
)
# Applies supabase/migrations/*.sql through the Supabase Management API.
# The access token is decrypted in memory only; it is never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$ref = 'etpckqbzxaqbupvatcuy'
$token = & powershell -NoProfile -File (Join-Path $root 'infra\get-secret.ps1') -Name supabase-access-token
$headers = @{ Authorization = "Bearer $token" }
$uri = "https://api.supabase.com/v1/projects/$ref/database/query"

function Invoke-Sql([string]$query) {
    $body = [Text.Encoding]::UTF8.GetBytes((@{ query = $query } | ConvertTo-Json -Compress))
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body
}

if ($Sql) {
    Invoke-Sql $Sql | ConvertTo-Json -Depth 8
    return
}
Get-ChildItem (Join-Path $root 'supabase\migrations') -Filter $Pattern | Sort-Object Name | ForEach-Object {
    Write-Host "applying $($_.Name)"
    Invoke-Sql ([IO.File]::ReadAllText($_.FullName)) | Out-Null
}
Write-Host 'done'
