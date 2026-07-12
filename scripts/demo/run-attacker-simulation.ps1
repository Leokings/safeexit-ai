. (Join-Path $PSScriptRoot "common.ps1")

Assert-LocalAnvil
$state = Read-DemoState

Write-Warning "DEMO ATTACKER SIMULATION - LOCAL ANVIL FIXTURE ONLY"
Write-Host "This action can target only the hardcoded Anvil development wallet: $script:DemoCompromised"

$target = ((Invoke-Foundry "cast" @(
    "call", $state.attackerSimulation, "DEMO_TARGET()(address)",
    "--rpc-url", $script:DemoRpcUrl
)) | Select-Object -First 1).ToString().Trim()
if ($target.ToLowerInvariant() -ne $script:DemoCompromised.ToLowerInvariant()) {
    throw "Attacker fixture target does not match the fixed demo wallet."
}

$null = Invoke-Foundry "cast" @(
    "send", $state.attackerSimulation, "attemptDemoSweep()",
    "--rpc-url", $script:DemoRpcUrl,
    "--private-key", $script:DemoDeployerKey
)
Write-Host "The fixed demo allowance was exercised. Reset Anvil before running the rescue walkthrough."
