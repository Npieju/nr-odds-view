param(
 [Parameter(Mandatory=$true)][string]$NodeDirectory,
 [string]$Destination = (Join-Path $PSScriptRoot '..\work')
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$node = Join-Path $NodeDirectory 'node.exe'
$license = Join-Path $NodeDirectory 'LICENSE'
$expected = 'd702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5'
if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ne $expected) {
 throw 'Use the official Node.js v24.22.1 Windows x64 executable.'
}
if (!(Test-Path -LiteralPath $license -PathType Leaf)) { throw 'The Node.js LICENSE is required.' }
$stage = Join-Path $Destination 'OddsObserver-Windows-x64'
$zip = Join-Path $Destination 'OddsObserver-Windows-x64.zip'
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zip)) {
 throw 'Choose a new destination for the package.'
}
foreach ($directory in @('src','public','runtime')) {
 New-Item -ItemType Directory -Path (Join-Path $stage $directory) | Out-Null
}
Copy-Item -LiteralPath (Join-Path $repo 'Start-Local.cmd'),(Join-Path $repo 'package.json') -Destination $stage
Copy-Item -LiteralPath (Join-Path $repo 'docs\local.md') -Destination (Join-Path $stage 'README-local.md')
Get-ChildItem -LiteralPath (Join-Path $repo 'src') -Filter '*.mjs' -File |
 Copy-Item -Destination (Join-Path $stage 'src')
foreach ($name in @('index.html','app.js','style.css','history.mjs','chart.mjs','demo.mjs')) {
 Copy-Item -LiteralPath (Join-Path $repo "public\$name") -Destination (Join-Path $stage 'public')
}
Copy-Item -LiteralPath $node,$license -Destination (Join-Path $stage 'runtime')
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
(Resolve-Path -LiteralPath $zip).Path
