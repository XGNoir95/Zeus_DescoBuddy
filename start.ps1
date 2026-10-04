param(
    [ValidateSet('run', 'setup', 'doctor', 'health')]
    [string]$Action = 'run'
)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $botPython = Join-Path $PSScriptRoot '.venv-win\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $botPython)) {
        $botPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    }
    if (-not (Test-Path -LiteralPath $botPython)) {
        throw 'Python environment not found. Follow README.md to install dependencies first.'
    }
    & $botPython -m descobuddy $Action
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
