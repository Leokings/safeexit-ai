. (Join-Path $PSScriptRoot "common.ps1")

if (-not (Test-Path -LiteralPath $script:DemoAnvilPidPath)) {
    Write-Host "No managed SAFEEXIT Anvil process is recorded."
    exit 0
}

$managedPid = [int](Get-Content -LiteralPath $script:DemoAnvilPidPath -Raw)
$process = Get-Process -Id $managedPid -ErrorAction SilentlyContinue
if ($null -ne $process -and $process.ProcessName -eq "anvil") {
    Stop-Process -Id $managedPid -Force
    Write-Host "Stopped SAFEEXIT Anvil process $managedPid."
}
Remove-Item -LiteralPath $script:DemoAnvilPidPath -Force
