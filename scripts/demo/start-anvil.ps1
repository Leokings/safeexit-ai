. (Join-Path $PSScriptRoot "common.ps1")

$anvil = Get-FoundryTool "anvil"
Write-Host "Starting SAFEEXIT local demo chain at $script:DemoRpcUrl (chain ID $script:DemoChainId)."
Write-Host "All displayed accounts and keys are public Anvil development fixtures."

& $anvil --host 127.0.0.1 --port 8545 --chain-id $script:DemoChainId --mnemonic $script:DemoMnemonic
exit $LASTEXITCODE
