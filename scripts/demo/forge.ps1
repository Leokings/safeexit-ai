param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$ForgeArguments = @("test")
)

. (Join-Path $PSScriptRoot "common.ps1")

$forge = Get-FoundryTool "forge"
& $forge @ForgeArguments --root (Join-Path $script:SafeExitRoot "contracts")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
