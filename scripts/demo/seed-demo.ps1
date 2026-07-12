. (Join-Path $PSScriptRoot "common.ps1")

Assert-LocalAnvil
Write-Host "1/3 Verifying the fixed SAFEEXIT demo contracts."
$forge = Get-FoundryTool "forge"
& $forge test --root (Join-Path $script:SafeExitRoot "contracts") --match-contract SafeExitDemoTest
if ($LASTEXITCODE -ne 0) {
    throw "The SAFEEXIT demo contract tests failed."
}

Write-Host "2/3 Deploying and seeding the fixed local incident."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "setup-anvil.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "The SAFEEXIT demo fixture setup failed."
}

Write-Host "3/3 Capturing local simulation receipts on an Anvil snapshot."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-rescue.ps1") -SimulationOnly
if ($LASTEXITCODE -ne 0) {
    throw "The SAFEEXIT demo simulation failed."
}

Write-Host "SAFEEXIT demo ready. Open http://localhost:3001/demo"
