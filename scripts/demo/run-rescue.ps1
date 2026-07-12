param([switch]$SimulationOnly)

. (Join-Path $PSScriptRoot "common.ps1")

function Set-ActionState {
    param(
        [Parameter(Mandatory = $true)][object]$Report,
        [Parameter(Mandatory = $true)][string]$ActionId,
        [Parameter(Mandatory = $true)][string]$Status,
        [object]$Receipt = $null
    )

    $action = $Report.actions | Where-Object { $_.id -eq $ActionId } | Select-Object -First 1
    if ($null -eq $action) {
        throw "Unknown fixed demo action: $ActionId"
    }
    $action.status = $Status
    if ($null -ne $Receipt) {
        $action.transactionHash = $Receipt.transactionHash
        $action.gasUsed = $Receipt.gasUsed
    }
}

function Add-DemoEvent {
    param(
        [Parameter(Mandatory = $true)][object]$Report,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Status
    )

    $Report.events = @($Report.events) + @([ordered]@{
        sequence = @($Report.events).Count
        label = $Label
        status = $Status
        at = Get-DemoTimestamp
    })
}

function Assert-RescueOutcome {
    param([Parameter(Mandatory = $true)][object]$State)

    $allowance = Get-FirstUint (Invoke-Foundry "cast" @(
        "call", $State.token, "allowance(address,address)(uint256)",
        $script:DemoCompromised, $State.attackerSimulation,
        "--rpc-url", $script:DemoRpcUrl
    ))
    $destinationBalance = Get-FirstUint (Invoke-Foundry "cast" @(
        "call", $State.token, "balanceOf(address)(uint256)", $script:DemoDestination,
        "--rpc-url", $script:DemoRpcUrl
    ))
    $nftOwner = ((Invoke-Foundry "cast" @(
        "call", $State.nft, "ownerOf(uint256)(address)", $State.nftTokenId.ToString(),
        "--rpc-url", $script:DemoRpcUrl
    )) | Select-Object -First 1).ToString().Trim()
    $claimable = Get-FirstUint (Invoke-Foundry "cast" @(
        "call", $State.airdrop, "claimable(address)(uint256)", $script:DemoCompromised,
        "--rpc-url", $script:DemoRpcUrl
    ))

    if ($allowance -ne 0 -or
        $destinationBalance -ne 150000000000000000000 -or
        $nftOwner.ToLowerInvariant() -ne $script:DemoDestination.ToLowerInvariant() -or
        $claimable -ne 0) {
        throw "Post-rescue verification failed."
    }
}

function Assert-DemoSweepBlocked {
    param([Parameter(Mandatory = $true)][object]$State)

    $cast = Get-FoundryTool "cast"
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $null = & $cast send $State.attackerSimulation "attemptDemoSweep()" --rpc-url $script:DemoRpcUrl --private-key $script:DemoDeployerKey 2>&1
    $attackExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($attackExitCode -eq 0) {
        throw "DEMO ATTACKER SIMULATION unexpectedly succeeded after rescue."
    }
}

Assert-LocalAnvil
$state = Read-DemoState
$report = Read-DemoReport

if (-not $SimulationOnly -and $report.phase -eq "COMPLETED") {
    throw "The fixed demo rescue is already complete. Reseed before executing it again."
}

$snapshotId = $null
$simulationReceipts = @()
try {
    if ($SimulationOnly) {
        $snapshotId = ((Invoke-Foundry "cast" @("rpc", "evm_snapshot", "--rpc-url", $script:DemoRpcUrl)) | Select-Object -First 1).ToString().Trim('"')
        $report.simulation.status = "RUNNING"
        Write-DemoReport $report
        Write-Host "Simulating the fixed rescue on Anvil snapshot $snapshotId."
    }
    else {
        $report.phase = "EXECUTING"
        $report.executionStartedAt = Get-DemoTimestamp
        $report.error = $null
        Add-DemoEvent $report "Local demo execution started" "EXECUTING"
        Write-DemoReport $report
    }

    $claimable = Get-FirstUint (Invoke-Foundry "cast" @(
        "call", $state.airdrop, "claimable(address)(uint256)", $script:DemoCompromised,
        "--rpc-url", $script:DemoRpcUrl
    ))
    if ($claimable -ne 50000000000000000000) {
        throw "Expected the fixed 50 SRT demo reward. Reseed the fixture."
    }

    $steps = @(
        [ordered]@{ id = "action:claim"; label = "Claiming 50 SRT reward"; contract = $state.airdrop; signature = "claim()"; arguments = @() },
        [ordered]@{ id = "action:token"; label = "Transferring 150 SRT"; contract = $state.token; signature = "transfer(address,uint256)"; arguments = @($script:DemoDestination, "150000000000000000000") },
        [ordered]@{ id = "action:nft"; label = "Transferring Demo NFT #1"; contract = $state.nft; signature = "safeTransferFrom(address,address,uint256)"; arguments = @($script:DemoCompromised, $script:DemoDestination, "1") },
        [ordered]@{ id = "action:revoke"; label = "Revoking 25 SRT allowance"; contract = $state.token; signature = "approve(address,uint256)"; arguments = @($state.attackerSimulation, "0") }
    )

    foreach ($step in $steps) {
        Write-Host $step.label
        if (-not $SimulationOnly) {
            Set-ActionState $report $step.id "EXECUTING"
            Add-DemoEvent $report $step.label "EXECUTING"
            Write-DemoReport $report
        }

        $receipt = Invoke-DemoTransaction $script:DemoCompromisedKey $step.contract $step.signature $step.arguments
        if ($SimulationOnly) {
            $simulationReceipts += [ordered]@{
                id = $step.id
                status = "PASSED"
                gasUsed = $receipt.gasUsed
                transactionHash = $receipt.transactionHash
            }
        }
        else {
            Set-ActionState $report $step.id "COMPLETED" $receipt
            Add-DemoEvent $report "$($step.label) confirmed" "COMPLETED"
            Write-DemoReport $report
            Start-Sleep -Milliseconds 350
        }
    }

    Assert-RescueOutcome $state
    Assert-DemoSweepBlocked $state

    if ($SimulationOnly) {
        $report.simulation.status = "PASSED"
        $report.simulation.verifiedAt = Get-DemoTimestamp
        $report.simulation.actions = $simulationReceipts
    }
    else {
        $report.phase = "COMPLETED"
        $report.executionCompletedAt = Get-DemoTimestamp
        Add-DemoEvent $report "Final state verified; fixed demo sweep blocked" "COMPLETED"
    }
}
catch {
    if ($SimulationOnly) {
        $report.simulation.status = "FAILED"
    }
    else {
        $report.phase = "FAILED"
        $report.error = $_.Exception.Message
        Add-DemoEvent $report "Execution failed" "FAILED"
    }
    throw
}
finally {
    if ($SimulationOnly -and $null -ne $snapshotId) {
        $reverted = ((Invoke-Foundry "cast" @("rpc", "evm_revert", $snapshotId, "--rpc-url", $script:DemoRpcUrl)) | Select-Object -First 1).ToString().Trim()
        $report.simulation.snapshotReverted = $reverted -eq "true"
        $report.phase = "READY"
    }
    Write-DemoReport $report
}

if ($SimulationOnly) {
    Write-Host "SAFEEXIT local simulation passed and the Anvil snapshot was reverted."
}
else {
    Write-Host "SAFEEXIT demo rescue complete: reward claimed, token and NFT transferred, approval revoked."
    Write-Host "DEMO ATTACKER SIMULATION blocked as expected."
}
