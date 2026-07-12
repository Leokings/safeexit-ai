. (Join-Path $PSScriptRoot "common.ps1")

function Deploy-Contract {
    param(
        [Parameter(Mandatory = $true)][string]$Contract,
        [string[]]$ConstructorArguments = @()
    )

    $arguments = @(
        "create",
        $Contract,
        "--root", (Join-Path $script:SafeExitRoot "contracts"),
        "--rpc-url", $script:DemoRpcUrl,
        "--private-key", $script:DemoDeployerKey,
        "--broadcast"
    )
    if ($ConstructorArguments.Count -gt 0) {
        $arguments += "--constructor-args"
        $arguments += $ConstructorArguments
    }

    $output = Invoke-Foundry "forge" $arguments
    $deploymentText = $output -join [Environment]::NewLine
    if ($deploymentText -notmatch "Deployed to:\s*(0x[a-fA-F0-9]{40})") {
        throw "Could not parse deployed contract address:`n$deploymentText"
    }
    return $Matches[1]
}

function Send-DemoTransaction {
    param(
        [Parameter(Mandatory = $true)][string]$PrivateKey,
        [Parameter(Mandatory = $true)][string]$Contract,
        [Parameter(Mandatory = $true)][string]$Signature,
        [string[]]$FunctionArguments = @()
    )

    $arguments = @("send", $Contract, $Signature)
    $arguments += $FunctionArguments
    $arguments += @("--rpc-url", $script:DemoRpcUrl, "--private-key", $PrivateKey)
    $null = Invoke-Foundry "cast" $arguments
}

Assert-LocalAnvil
Write-Host "Setting up the fixed SAFEEXIT local demo."

$deployerNonce = Get-FirstUint (Invoke-Foundry "cast" @(
    "nonce", $script:DemoDeployer, "--rpc-url", $script:DemoRpcUrl
))
if ($deployerNonce -ne 0) {
    throw "The SAFEEXIT demo requires a fresh Anvil chain. Restart Anvil or run 'npm run demo:prepare'."
}

$token = Deploy-Contract "src/RescueToken.sol:RescueToken" @($script:DemoDeployer)
$nft = Deploy-Contract "src/DemoNFT.sol:DemoNFT" @($script:DemoDeployer)
$airdrop = Deploy-Contract "src/DemoAirdrop.sol:DemoAirdrop" @($token, $script:DemoDeployer)
$attacker = Deploy-Contract "src/DemoAttackerSimulation.sol:DemoAttackerSimulation" @($token, "25000000000000000000")

Send-DemoTransaction $script:DemoDeployerKey $token "mint(address,uint256)" @($script:DemoCompromised, "100000000000000000000")
Send-DemoTransaction $script:DemoDeployerKey $token "mint(address,uint256)" @($airdrop, "50000000000000000000")
Send-DemoTransaction $script:DemoDeployerKey $nft "mint(address)" @($script:DemoCompromised)
Send-DemoTransaction $script:DemoDeployerKey $airdrop "setClaimable(address,uint256)" @($script:DemoCompromised, "50000000000000000000")
Send-DemoTransaction $script:DemoCompromisedKey $token "approve(address,uint256)" @($attacker, "25000000000000000000")

$stateDirectory = Split-Path -Parent $script:DemoStatePath
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
[ordered]@{
    chainId = $script:DemoChainId
    rpcUrl = $script:DemoRpcUrl
    compromised = $script:DemoCompromised
    destination = $script:DemoDestination
    attackerSink = $script:DemoAttackerSink
    token = $token
    nft = $nft
    airdrop = $airdrop
    attackerSimulation = $attacker
    nftTokenId = 1
} | ConvertTo-Json | Set-Content -LiteralPath $script:DemoStatePath -Encoding utf8

$expectedContracts = @(
    $script:DemoToken,
    $script:DemoNft,
    $script:DemoAirdrop,
    $script:DemoAttackerSimulation
)
$actualContracts = @($token, $nft, $airdrop, $attacker)
for ($index = 0; $index -lt $expectedContracts.Count; $index++) {
    if ($actualContracts[$index].ToLowerInvariant() -ne $expectedContracts[$index].ToLowerInvariant()) {
        throw "Demo deployment address mismatch. The local chain was not in the expected fresh state."
    }
}

$report = [ordered]@{
    schemaVersion = "safeexit-demo-v1"
    incidentId = "demo-31337"
    phase = "READY"
    updatedAt = Get-DemoTimestamp
    executionStartedAt = $null
    executionCompletedAt = $null
    error = $null
    simulation = [ordered]@{
        status = "NOT_RUN"
        verifiedAt = $null
        snapshotReverted = $false
        actions = @()
    }
    actions = @(
        [ordered]@{ id = "action:claim"; title = "Claim configured reward"; status = "READY"; transactionHash = $null; gasUsed = $null },
        [ordered]@{ id = "action:token"; title = "Transfer RescueToken"; status = "READY"; transactionHash = $null; gasUsed = $null },
        [ordered]@{ id = "action:nft"; title = "Transfer Demo NFT #1"; status = "READY"; transactionHash = $null; gasUsed = $null },
        [ordered]@{ id = "action:revoke"; title = "Revoke demo allowance"; status = "READY"; transactionHash = $null; gasUsed = $null }
    )
    events = @(
        [ordered]@{ sequence = 0; label = "Fixture deployed and seeded"; status = "COMPLETED"; at = Get-DemoTimestamp }
    )
}
Write-DemoReport $report

Write-Host "Demo deployed."
Write-Host "  Compromised demo wallet: $script:DemoCompromised"
Write-Host "  Safe destination:        $script:DemoDestination"
Write-Host "  RescueToken:             $token"
Write-Host "  DemoNFT:                 $nft"
Write-Host "  DemoAirdrop:             $airdrop"
Write-Host "  DEMO ATTACKER SIMULATION: $attacker"
Write-Host "Run 'npm run demo:seed' for simulation evidence, or 'npm run demo:rescue' to execute."
