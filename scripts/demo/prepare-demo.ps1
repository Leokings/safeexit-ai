. (Join-Path $PSScriptRoot "common.ps1")

$existingListener = Get-NetTCPConnection -LocalPort 8545 -State Listen -ErrorAction SilentlyContinue
if ($null -ne $existingListener) {
    $managedPid = if (Test-Path -LiteralPath $script:DemoAnvilPidPath) {
        [int](Get-Content -LiteralPath $script:DemoAnvilPidPath -Raw)
    } else { 0 }
    $listenerPid = [int]($existingListener | Select-Object -First 1 -ExpandProperty OwningProcess)
    if ($managedPid -eq 0 -or $listenerPid -ne $managedPid) {
        throw "Port 8545 is already in use by an unmanaged process. Stop it before preparing the SAFEEXIT fixture."
    }
    Stop-Process -Id $managedPid -Force
    Start-Sleep -Milliseconds 500
}

$demoDirectory = Split-Path -Parent $script:DemoStatePath
New-Item -ItemType Directory -Path $demoDirectory -Force | Out-Null
$anvil = Get-FoundryTool "anvil"
$stdout = Join-Path $demoDirectory "anvil.out.log"
$stderr = Join-Path $demoDirectory "anvil.err.log"
$anvilArguments = "--host 127.0.0.1 --port 8545 --chain-id $script:DemoChainId --mnemonic `"$script:DemoMnemonic`""
$process = Start-Process -FilePath $anvil -ArgumentList $anvilArguments -WorkingDirectory $script:SafeExitRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
$process.Id | Set-Content -LiteralPath $script:DemoAnvilPidPath -Encoding ascii

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
        Assert-LocalAnvil
        $ready = $true
        break
    }
    catch {
        if ($process.HasExited) {
            throw "Anvil exited before the SAFEEXIT demo chain was ready."
        }
    }
}
if (-not $ready) {
    throw "Timed out waiting for the SAFEEXIT Anvil chain."
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "seed-demo.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "SAFEEXIT demo preparation failed."
}
