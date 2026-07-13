param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$ForgeArguments = @("test")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$localForge = Join-Path $root ".tools\foundry\forge.exe"
$forge = if (Test-Path -LiteralPath $localForge) {
    $localForge
} else {
    (Get-Command forge -ErrorAction Stop).Source
}

& $forge @ForgeArguments --root (Join-Path $root "contracts")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
