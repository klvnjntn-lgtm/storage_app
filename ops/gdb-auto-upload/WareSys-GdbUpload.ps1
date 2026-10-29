<#
.SYNOPSIS
  Uploads the newest Accurate .gdb in a folder to WareSys (Upload Order -> Accurate GDB),
  skipping a file that has already been uploaded. Meant to run from Windows Task Scheduler.

.EXAMPLE
  # One-time: save the MASTER account's login (encrypted for this Windows user only)
  .\WareSys-GdbUpload.ps1 -SetupCredential

  # One-time: create the scheduled task (every Monday 07:00)
  .\WareSys-GdbUpload.ps1 -Install -Folder "D:\Accurate\Backup" -Day Monday -At 07:00

  # Manual run (what the task does)
  .\WareSys-GdbUpload.ps1 -Folder "D:\Accurate\Backup"
#>
[CmdletBinding()]
param(
  [string]$Folder,
  [ValidateSet('products_only', 'full_invoices', 'full_invoices_and_purchase_orders')]
  [string]$Target = 'full_invoices',
  [string]$BaseUrl = 'https://waresys.id',
  # A file written to within this many minutes is treated as still being
  # copied/backed up and left for the next run.
  [int]$SettleMinutes = 5,
  [switch]$SetupCredential,
  [switch]$Install,
  [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
  [string]$Day = 'Monday',
  [string]$At = '07:00',
  # A weekly run that fails would otherwise wait a whole week, so each run
  # retries this many times, RetryMinutes apart.
  [int]$Attempts = 3,
  [int]$RetryMinutes = 15,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'WareSys GDB Upload'
$StateDir = Join-Path $env:LOCALAPPDATA 'WareSys-GdbUpload'
$CredFile = Join-Path $StateDir 'credential.xml'
$DoneFile = Join-Path $StateDir 'uploaded.txt'
$LogFile = Join-Path $StateDir 'upload.log'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

# JSON bodies go through a temp file (no BOM) so the password never shows
# up in the process list and PowerShell's argument quoting can't mangle it.
function Write-JsonTemp($obj) {
  $path = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  return $path
}

# Runs curl.exe (built into Windows 10/11) and returns status + parsed body.
function Invoke-Curl([string[]]$curlArgs) {
  $out = [IO.Path]::GetTempFileName()
  try {
    $code = & curl.exe -sS -o $out -w '%{http_code}' @curlArgs
    if ($LASTEXITCODE -ne 0) { throw "curl failed (exit $LASTEXITCODE)" }
    $text = [IO.File]::ReadAllText($out)
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ Status = [int]$code; Text = $text; Json = $json }
  } finally {
    Remove-Item $out -ErrorAction SilentlyContinue
  }
}

function Get-ErrorText($res) {
  if ($res.Json -and $res.Json.message) { return ($res.Json.message -join '; ') }
  return $res.Text
}

$csrf = 'x-requested-with: waresys'

# Signs in and leaves the session cookie in $jar; throws if it can't.
function Connect-WareSys($cred, [string]$jar) {
  $body = Write-JsonTemp @{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password }
  try {
    $res = Invoke-Curl @('-c', $jar, '-H', 'Content-Type: application/json', '-H', $csrf,
      '--data-binary', "@$body", "$BaseUrl/api/auth/login")
  } finally { Remove-Item $body -ErrorAction SilentlyContinue }
  if ($res.Status -ne 200 -and $res.Status -ne 201) { throw "Login failed ($($res.Status)): $(Get-ErrorText $res)" }
  if ($res.Json.mfaRequired) { throw 'This account has two-factor sign-in on; the task cannot type a code' }
}

# -- one-time setup modes ------------------------------------------------
if ($SetupCredential) {
  # Typed in this window rather than Get-Credential, whose popup in Windows
  # PowerShell 5.1 often opens behind other windows and looks like a hang.
  Write-Host 'WareSys MASTER account (two-factor sign-in must be off)'
  $email = Read-Host 'Email'
  $password = Read-Host 'Password' -AsSecureString
  $cred = New-Object System.Management.Automation.PSCredential ($email.Trim(), $password)

  # Check it now, so a wrong password shows up here and not in next week's log.
  Write-Host "Checking login at $BaseUrl ..."
  $jar = [IO.Path]::GetTempFileName()
  try {
    Connect-WareSys $cred $jar
  } catch {
    Write-Host "NOT saved: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  } finally {
    Remove-Item $jar -ErrorAction SilentlyContinue
  }

  # DPAPI: only this Windows user on this PC can decrypt it.
  $cred | Export-Clixml -Path $CredFile
  Write-Host "Login OK, saved to $CredFile" -ForegroundColor Green
  exit 0
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed task '$TaskName'"
  exit 0
}

if ($Install) {
  if (-not $Folder) { throw '-Folder is required' }
  if (-not (Test-Path $CredFile)) { throw 'Run with -SetupCredential first' }
  $script = $MyInvocation.MyCommand.Path
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" " +
         "-Folder `"$Folder`" -Target $Target -BaseUrl $BaseUrl -SettleMinutes $SettleMinutes"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At
  # StartWhenAvailable: if the PC was off at the scheduled time, run as soon
  # as it's back on instead of skipping the week.
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 8)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Uploads the newest Accurate .gdb to WareSys' -Force | Out-Null
  Write-Host "Task '$TaskName' runs every $Day at $At. Log: $LogFile"
  exit 0
}

# -- normal run ----------------------------------------------------------
if (-not $Folder) { throw '-Folder is required' }
if (-not (Test-Path $CredFile)) { Log 'No saved login; run with -SetupCredential'; exit 1 }

function Get-NewestGdb {
  Get-ChildItem -Path $Folder -Filter *.gdb -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# A run can't come back in an hour, so wait (up to 2 hours) for a backup
# that's still being written instead of giving up on it.
for ($i = 0; $i -lt 24; $i++) {
  $file = Get-NewestGdb
  if (-not $file) { Log "No .gdb in $Folder"; exit 0 }
  if ($file.LastWriteTime -le (Get-Date).AddMinutes(-$SettleMinutes)) { break }
  if ($i -eq 0) { Log "$($file.Name) is still being written; waiting" }
  Start-Sleep -Seconds 300
}
if ($file.LastWriteTime -gt (Get-Date).AddMinutes(-$SettleMinutes)) {
  Log "$($file.Name) kept changing for 2 hours; skipped this week"
  exit 1
}

# Same path + size + modified time = same file. A file overwritten in place
# with new content counts as new and is uploaded again.
$key = '{0}|{1}|{2}' -f $file.FullName, $file.Length, $file.LastWriteTimeUtc.Ticks
$done = @()
if (Test-Path $DoneFile) { $done = Get-Content $DoneFile }
if ($done -contains $key) { Log "Already uploaded: $($file.Name); nothing new this week"; exit 0 }

$cred = Import-Clixml -Path $CredFile

# Login -> upload -> confirm. Returns once the file is imported (or the server
# is still importing it); throws on anything worth retrying.
function Send-Gdb {
  $jar = [IO.Path]::GetTempFileName()
  try {
    # 1. Log in
    Connect-WareSys $cred $jar

    # 2. Upload -> preview + token
    $sizeMb = [math]::Round($file.Length / 1MB)
    Log "Uploading $($file.Name) ($sizeMb MB)"
    $res = Invoke-Curl @('-b', $jar, '-H', $csrf, '-F', "file=@$($file.FullName)",
      "$BaseUrl/api/integrations/accurate-gdb/upload")
    if ($res.Status -ne 200 -and $res.Status -ne 201) { throw "Upload failed ($($res.Status)): $(Get-ErrorText $res)" }
    $p = $res.Json
    Log ("Preview: {0} items, {1} invoices, {2} customers, {3} POs" -f
      $p.itemCount, $p.invoiceCount, $p.customerCount, $(if ($null -eq $p.purchaseOrderCount) { 0 } else { $p.purchaseOrderCount }))

    # Same guard as the page: no PO data -> import invoices without POs.
    $useTarget = $Target
    if ($useTarget -eq 'full_invoices_and_purchase_orders' -and -not $p.purchaseOrderCount) {
      Log 'No purchase-order data in this file; importing as full_invoices'
      $useTarget = 'full_invoices'
    }

    # 3. Confirm import
    $body = Write-JsonTemp @{ target = $useTarget }
    try {
      $res = Invoke-Curl @('-b', $jar, '-H', 'Content-Type: application/json', '-H', $csrf,
        '--data-binary', "@$body", "$BaseUrl/api/integrations/accurate-gdb/confirm/$($p.token)")
    } finally { Remove-Item $body -ErrorAction SilentlyContinue }

    # 502/504 are the proxy giving up, not the import: the server keeps going,
    # so count the file as done rather than import it a second time.
    if ($res.Status -eq 502 -or $res.Status -eq 504) {
      Log "Import of $($file.Name) still running on the server (HTTP $($res.Status)); marked as done"
      return
    }
    if ($res.Status -ne 200 -and $res.Status -ne 201) { throw "Import failed ($($res.Status)): $(Get-ErrorText $res)" }

    $r = $res.Json
    $summary = "items +$($r.items.created)/~$($r.items.updated)"
    if ($r.invoices) { $summary += ", invoices +$($r.invoices.created)/~$($r.invoices.updated) ($($r.invoices.errors.Count) errors)" }
    if ($r.purchaseOrders) { $summary += ", POs +$($r.purchaseOrders.created)/~$($r.purchaseOrders.updated)" }
    Log "Imported $($file.Name) as ${useTarget}: $summary"
  } finally {
    Remove-Item $jar -ErrorAction SilentlyContinue
  }
}

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  try {
    Send-Gdb
    Add-Content -Path $DoneFile -Value $key
    exit 0
  } catch {
    Log "ERROR (attempt $attempt of $Attempts): $($_.Exception.Message)"
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds ($RetryMinutes * 60) }
  }
}
# Not marked as done, so next week's run tries again (if no newer file by then).
exit 1
