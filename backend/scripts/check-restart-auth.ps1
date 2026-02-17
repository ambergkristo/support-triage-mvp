$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $PSScriptRoot
$tokenDir = Join-Path $backendDir "data"
$tokenPath = Join-Path $tokenDir "token.json"
$backupPath = Join-Path $tokenDir "token.backup.json"
$stdoutPath = Join-Path $backendDir "qa-restart.out"
$stderrPath = Join-Path $backendDir "qa-restart.err"
$port = "3105"
$baseUrl = "http://localhost:$port"
$proc1 = $null
$proc2 = $null

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Parse-Json {
    param([string]$InputText)
    return $InputText | ConvertFrom-Json
}

function Start-Server {
    Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
    return Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "set PORT=$port&& npm.cmd run dev:safe" -WorkingDirectory $backendDir -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
}

function Stop-Server {
    param($Process)
    if ($null -ne $Process -and (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $Process.Id -Force
        Start-Sleep -Seconds 1
    }
}

function Get-AuthStatus {
    $raw = curl.exe -s "$baseUrl/auth/status"
    return Parse-Json $raw
}

function Verify-AuthenticatedStatus {
    $status = Get-AuthStatus
    Assert-True ($status.authenticated -eq $true) "Expected authenticated=true after restart."
    Assert-True ($status.hasRefreshToken -eq $true) "Expected hasRefreshToken=true after restart."
    Assert-True ($status.tokenFilePresent -eq $true) "Expected tokenFilePresent=true after restart."
}

try {
    New-Item -ItemType Directory -Force -Path $tokenDir | Out-Null

    if (Test-Path $tokenPath) {
        Copy-Item $tokenPath $backupPath -Force
    }

    $tokenFixture = @{
        access_token = "fixture-access-token"
        refresh_token = "fixture-refresh-token"
        expiry_date = 4102444800000
        token_type = "Bearer"
        scope = "https://www.googleapis.com/auth/gmail.readonly"
    } | ConvertTo-Json
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tokenPath, $tokenFixture, $utf8NoBom)

    $proc1 = Start-Server
    Start-Sleep -Seconds 7
    Verify-AuthenticatedStatus
    Stop-Server $proc1

    $proc2 = Start-Server
    Start-Sleep -Seconds 7
    Verify-AuthenticatedStatus

    $logout = curl.exe -s -X POST "$baseUrl/auth/logout"
    $logoutObj = Parse-Json $logout
    Assert-True ($logoutObj.message -eq "logged_out") "Expected logout response to contain message=logged_out."

    $statusAfterLogout = Get-AuthStatus
    Assert-True ($statusAfterLogout.authenticated -eq $false) "Expected authenticated=false after logout."
    Assert-True ($statusAfterLogout.hasRefreshToken -eq $false) "Expected hasRefreshToken=false after logout."
    Assert-True ($statusAfterLogout.tokenFilePresent -eq $false) "Expected token file to be deleted after logout."
    Assert-True (-not (Test-Path $tokenPath)) "Expected backend/data/token.json to be removed after logout."

    Write-Output "PASS: restart-safe auth persistence verified"
    exit 0
} catch {
    Write-Output "FAIL: $($_.Exception.Message)"
    if (Test-Path $stdoutPath) {
        Write-Output "--- SERVER STDOUT ---"
        Get-Content $stdoutPath
    }
    if (Test-Path $stderrPath) {
        Write-Output "--- SERVER STDERR ---"
        Get-Content $stderrPath
    }
    exit 1
} finally {
    Stop-Server $proc1
    Stop-Server $proc2

    if (Test-Path $backupPath) {
        Move-Item $backupPath $tokenPath -Force
    } else {
        Remove-Item $tokenPath -ErrorAction SilentlyContinue
    }

    Remove-Item $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
}
