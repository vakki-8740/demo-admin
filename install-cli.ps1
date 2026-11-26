$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'cli'
if (-not (Test-Path (Join-Path $source 'cli.js'))) { throw 'The cli folder is missing. Extract the full ZIP first.' }
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    $answer = Read-Host 'Node.js is needed to run the CLI. Install the free Node.js LTS runtime with winget now? (Y/N)'
    if ($answer -match '^[Yy]') {
      winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
      $nodePath = Join-Path $env:ProgramFiles 'nodejs'
      if (Test-Path (Join-Path $nodePath 'node.exe')) { $env:Path = "$nodePath;$env:Path" }
    }
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is required. Install the LTS version from https://nodejs.org, then run this installer again.' -ForegroundColor Yellow
  exit 1
}
$target = Join-Path $env:LOCALAPPDATA 'Programs\GitHubProjectManagerCLI'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source 'cli.js') $target -Force
Copy-Item (Join-Path $source 'windows-vault.ps1') $target -Force
Copy-Item (Join-Path $source 'ghpm.cmd') $target -Force
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $target) {
  $newPath = (($parts + $target) -join ';')
  [Environment]::SetEnvironmentVariable('Path',$newPath,'User')
}
Write-Host "Installed to $target" -ForegroundColor Green
Write-Host 'Close and reopen Windows Terminal, then run:' -ForegroundColor Cyan
Write-Host '  ghpm auth login'
Write-Host '  ghpm help'
Write-Host 'The first login saves your token encrypted for your Windows user.'
