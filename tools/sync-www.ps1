$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$www = Join-Path $root 'www'
New-Item -ItemType Directory -Force $www | Out-Null
$files = @('index.html','app.css','seabirds.css','app.js','sync.js','plot-core.js','manifest.webmanifest','icon.svg','firebase-config.js','sw.js')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $www $file) -Force }
New-Item -ItemType Directory -Force (Join-Path $www 'vendor/firebase') | Out-Null
Copy-Item -Path (Join-Path $root 'vendor/firebase/*') -Destination (Join-Path $www 'vendor/firebase') -Force
