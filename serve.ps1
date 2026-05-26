$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Read-DotEnv {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $parts = $line.Split("=", 2)
        if ($parts.Length -eq 2 -and -not [Environment]::GetEnvironmentVariable($parts[0], "Process")) {
            [Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
        }
    }
}

Read-DotEnv ".env"

if (-not $env:MYSQL_HOST) { $env:MYSQL_HOST = "172.17.10.101" }
if (-not $env:MYSQL_PORT) { $env:MYSQL_PORT = "3306" }
if (-not $env:MYSQL_USER) { $env:MYSQL_USER = "logistica" }
if (-not $env:MYSQL_ACUSE_DATABASE) { $env:MYSQL_ACUSE_DATABASE = "BD_ALAS_ACUSE" }
if (-not $env:MYSQL_SAP_DATABASE) { $env:MYSQL_SAP_DATABASE = "BD_ALAS_SAP" }
if (-not $env:ACUSE_DEFAULT_USER) { $env:ACUSE_DEFAULT_USER = "Operador General" }

if (-not $env:MYSQL_PASSWORD -or $env:MYSQL_PASSWORD -eq "colocar_password_localmente") {
    $securePassword = Read-Host "Password MySQL" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $env:MYSQL_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (-not (Test-Path "node_modules")) {
    Write-Host "No existe node_modules. Ejecuta primero: npm install" -ForegroundColor Yellow
}

npm start
