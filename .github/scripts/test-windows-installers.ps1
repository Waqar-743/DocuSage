$ErrorActionPreference = 'Stop'
$evidence = Join-Path $env:RUNNER_TEMP 'docusage-installer-evidence'
New-Item -ItemType Directory -Force $evidence | Out-Null
$results = [System.Collections.Generic.List[object]]::new()

function Test-InstalledApp([string] $Directory, [string] $Package) {
    $executable = Join-Path $Directory 'docusage.exe'
    if (-not (Test-Path $executable)) { throw "Installed executable is missing: $executable" }
    $profile = Join-Path $env:RUNNER_TEMP "docusage-$Package-profile"
    $env:APPDATA = Join-Path $profile 'config'
    $env:LOCALAPPDATA = Join-Path $profile 'data'
    $env:MODEL_PATH = Join-Path $profile 'models'
    New-Item -ItemType Directory -Force $env:APPDATA, $env:LOCALAPPDATA, $env:MODEL_PATH | Out-Null
    $process = Start-Process -FilePath $executable -PassThru
    try {
        Start-Sleep -Seconds 10
        if ($process.HasExited) { throw "$Package app exited during startup: $($process.ExitCode)" }
        # A second invocation should show the first instance's hidden window.
        $second = Start-Process -FilePath $executable -PassThru
        if (-not $second.WaitForExit(15000)) {
            Stop-Process -Id $second.Id
            throw "$Package app did not enforce a single instance"
        }
        if ($second.ExitCode -ne 0) { throw "$Package second invocation failed: $($second.ExitCode)" }
        $visible = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $process.Refresh()
            if ($process.HasExited) { throw "$Package app exited while showing its window" }
            if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $visible = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $visible) { throw "$Package installed app did not show its native window" }
        $results.Add(@{ package = $Package; installed = $true; launch = 'passed'; singleInstance = 'passed'; visibleWindow = 'passed' })
        Write-Output "$Package installation, native startup, single instance, and visible window passed."
    } finally {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id
            $process.WaitForExit()
        }
    }
}

$nsis = @(Get-ChildItem DocuSage/src-tauri/target/release/bundle/nsis/*-setup.exe)
$msi = @(Get-ChildItem DocuSage/src-tauri/target/release/bundle/msi/*.msi)
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) { throw 'Expected exactly one installer of each format' }
$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
try {
    $nsisDir = Join-Path $env:RUNNER_TEMP 'docusage-nsis-installed'
    $install = Start-Process -FilePath $nsis[0].FullName -ArgumentList "/S /D=$nsisDir" -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "NSIS installation failed: $($install.ExitCode)" }
    Test-InstalledApp $nsisDir 'nsis'
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
    $uninstaller = @(Get-ChildItem $nsisDir/*uninstall*.exe)
    if ($uninstaller.Count -ne 1) { throw 'NSIS uninstaller is missing' }
    $uninstall = Start-Process -FilePath $uninstaller[0].FullName -ArgumentList "/S _?=$nsisDir" -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed: $($uninstall.ExitCode)" }

    $msiDir = Join-Path $env:RUNNER_TEMP 'docusage-msi-installed'
    $log = Join-Path $evidence 'msi-install.log'
    $install = Start-Process msiexec.exe -ArgumentList "/i `"$($msi[0].FullName)`" /qn /norestart INSTALLDIR=`"$msiDir`" /L*v `"$log`"" -Wait -PassThru
    if ($install.ExitCode -notin @(0, 3010)) { throw "MSI installation failed: $($install.ExitCode)" }
    Test-InstalledApp $msiDir 'msi'
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
    $uninstall = Start-Process msiexec.exe -ArgumentList "/x `"$($msi[0].FullName)`" /qn /norestart" -Wait -PassThru
    if ($uninstall.ExitCode -notin @(0, 3010)) { throw "MSI uninstall failed: $($uninstall.ExitCode)" }
    @{ completed = $true; scope = 'Installation, startup, single instance, and visible native window; no inference or interactive UI certification'; checks = $results.ToArray() } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'results.json') -Encoding utf8NoBOM
} finally {
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
}
