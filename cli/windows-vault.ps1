param(
  [Parameter(Mandatory=$true)][ValidateSet('store','read','clear')][string]$Action,
  [Parameter(Mandatory=$true)][string]$VaultPath
)
$ErrorActionPreference = 'Stop'
$VaultPath = [IO.Path]::GetFullPath($VaultPath)
switch ($Action) {
  'store' {
    $plain = [Console]::In.ReadLine()
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Secret input was empty.' }
    $secure = ConvertTo-SecureString $plain -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString $secure
    $parent = [IO.Path]::GetDirectoryName($VaultPath)
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    [IO.File]::WriteAllText($VaultPath, $encrypted, [Text.Encoding]::UTF8)
    $plain = $null
    $secure.Dispose()
  }
  'read' {
    if (-not (Test-Path -LiteralPath $VaultPath)) { throw 'Encrypted secret file not found. Run ghpm auth login.' }
    $encrypted = [IO.File]::ReadAllText($VaultPath)
    $secure = ConvertTo-SecureString $encrypted
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Console]::Out.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
  }
  'clear' {
    if (Test-Path -LiteralPath $VaultPath) { Remove-Item -LiteralPath $VaultPath -Force }
  }
}
