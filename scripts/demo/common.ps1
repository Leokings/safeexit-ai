Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:SafeExitRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$script:DemoRpcUrl = "http://127.0.0.1:8545"
$script:DemoChainId = 31337
$script:DemoMnemonic = "test test test test test test test test test test test junk"

# Public Anvil development credentials. Never fund or reuse these accounts outside this demo.
$script:DemoDeployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
$script:DemoDeployerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$script:DemoCompromised = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
$script:DemoCompromisedKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
$script:DemoAttackerSink = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
$script:DemoDestination = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"
$script:DemoToken = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
$script:DemoNft = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
$script:DemoAirdrop = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
$script:DemoAttackerSimulation = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
$script:DemoStatePath = Join-Path $script:SafeExitRoot ".demo\demo-state.json"
$script:DemoReportPath = Join-Path $script:SafeExitRoot ".demo\demo-report.json"
$script:DemoAnvilPidPath = Join-Path $script:SafeExitRoot ".demo\anvil.pid"

function Get-FoundryTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    $localTool = Join-Path $script:SafeExitRoot ".tools\foundry\$Name.exe"
    if (Test-Path -LiteralPath $localTool) {
        return $localTool
    }

    $installedTool = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $installedTool) {
        return $installedTool.Source
    }

    throw "Foundry tool '$Name' was not found. Install Foundry using the official instructions in README.md."
}

function Invoke-Foundry {
    param(
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $executable = Get-FoundryTool $Tool
    $output = & $executable @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "$Tool failed:`n$($output -join [Environment]::NewLine)"
    }

    return $output
}

function Assert-LocalAnvil {
    $chainIdOutput = Invoke-Foundry "cast" @("chain-id", "--rpc-url", $script:DemoRpcUrl)
    $chainId = [int](($chainIdOutput | Select-Object -First 1).ToString().Trim())
    if ($chainId -ne $script:DemoChainId) {
        throw "Refusing demo operation: expected chain ID $script:DemoChainId, received $chainId."
    }
}

function Get-FirstUint {
    param([Parameter(Mandatory = $true)][object[]]$Output)

    $text = ($Output -join " ").Trim()
    if ($text -notmatch "^(\d+)") {
        throw "Expected an unsigned integer, received: $text"
    }
    return [System.Numerics.BigInteger]::Parse($Matches[1])
}

function Read-DemoState {
    if (-not (Test-Path -LiteralPath $script:DemoStatePath)) {
        throw "Demo state not found. Run 'npm run demo:setup' first."
    }

    $state = Get-Content -LiteralPath $script:DemoStatePath -Raw | ConvertFrom-Json
    if ($state.chainId -ne $script:DemoChainId -or
        $state.rpcUrl -ne $script:DemoRpcUrl -or
        $state.compromised.ToLowerInvariant() -ne $script:DemoCompromised.ToLowerInvariant() -or
        $state.destination.ToLowerInvariant() -ne $script:DemoDestination.ToLowerInvariant() -or
        $state.attackerSink.ToLowerInvariant() -ne $script:DemoAttackerSink.ToLowerInvariant() -or
        $state.token.ToLowerInvariant() -ne $script:DemoToken.ToLowerInvariant() -or
        $state.nft.ToLowerInvariant() -ne $script:DemoNft.ToLowerInvariant() -or
        $state.airdrop.ToLowerInvariant() -ne $script:DemoAirdrop.ToLowerInvariant() -or
        $state.attackerSimulation.ToLowerInvariant() -ne $script:DemoAttackerSimulation.ToLowerInvariant() -or
        $state.nftTokenId -ne 1) {
        throw "Demo state does not match the fixed local SAFEEXIT scenario."
    }

    return $state
}

function Get-DemoTimestamp {
    return (Get-Date).ToUniversalTime().ToString("o")
}

function Write-DemoJson {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = "$Path.tmp"
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Read-DemoReport {
    if (-not (Test-Path -LiteralPath $script:DemoReportPath)) {
        throw "Demo report not found. Run 'npm run demo:seed' first."
    }
    return Get-Content -LiteralPath $script:DemoReportPath -Raw | ConvertFrom-Json
}

function Write-DemoReport {
    param([Parameter(Mandatory = $true)][object]$Report)

    $Report.updatedAt = Get-DemoTimestamp
    Write-DemoJson $Report $script:DemoReportPath
}

function Convert-HexQuantityToString {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value -match '^0x[0-9a-fA-F]+$') {
        $hex = $Value.Substring(2)
        if ($hex.Length % 2 -eq 1) {
            $hex = "0$hex"
        }
        $bytes = New-Object byte[] ($hex.Length / 2 + 1)
        for ($index = 0; $index -lt $hex.Length; $index += 2) {
            $bytes[($hex.Length - $index) / 2 - 1] = [Convert]::ToByte($hex.Substring($index, 2), 16)
        }
        return ([System.Numerics.BigInteger]::new($bytes)).ToString()
    }
    return ([System.Numerics.BigInteger]::Parse($Value)).ToString()
}

function Invoke-DemoTransaction {
    param(
        [Parameter(Mandatory = $true)][string]$PrivateKey,
        [Parameter(Mandatory = $true)][string]$Contract,
        [Parameter(Mandatory = $true)][string]$Signature,
        [string[]]$FunctionArguments = @()
    )

    $arguments = @("send", $Contract, $Signature)
    $arguments += $FunctionArguments
    $arguments += @(
        "--rpc-url", $script:DemoRpcUrl,
        "--private-key", $PrivateKey,
        "--json"
    )
    $output = Invoke-Foundry "cast" $arguments
    $receipt = ($output -join [Environment]::NewLine) | ConvertFrom-Json
    if ($receipt.status -ne "0x1" -or $receipt.transactionHash -notmatch '^0x[a-fA-F0-9]{64}$') {
        throw "The fixed demo transaction did not produce a successful receipt."
    }
    return [ordered]@{
        transactionHash = $receipt.transactionHash
        gasUsed = Convert-HexQuantityToString $receipt.gasUsed
    }
}
