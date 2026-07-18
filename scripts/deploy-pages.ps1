param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$SkipChecks,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Executable failed with exit code $LASTEXITCODE"
    }
  }
  finally {
    Pop-Location
  }
}

function Get-HashedAssetRefs([string]$HtmlPath) {
  if (-not (Test-Path -LiteralPath $HtmlPath -PathType Leaf)) { return @() }
  $html = [System.IO.File]::ReadAllText($HtmlPath)
  return [regex]::Matches($html, 'assets/index-[^"''?]+\.(?:js|css)') |
    ForEach-Object Value |
    Sort-Object -Unique
}

$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$dist = Join-Path $repo 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { throw 'RepoRoot is not a Git checkout.' }

if (-not $SkipChecks) {
  Invoke-Checked 'npm.cmd' @('test') $repo
  Invoke-Checked 'npm.cmd' @('run', 'build') $repo
}
if (-not (Test-Path -LiteralPath (Join-Path $dist 'index.html') -PathType Leaf)) { throw 'dist/index.html is missing.' }

$remoteUrl = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) { throw 'Could not resolve the origin remote.' }

$tempBase = (Resolve-Path -LiteralPath $env:TEMP).Path
$tempRoot = Join-Path $tempBase ("n9nes9-pages-" + [guid]::NewGuid().ToString('N'))
$checkout = Join-Path $tempRoot 'checkout'
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  Invoke-Checked 'git' @('clone', '--branch', 'gh-pages', '--single-branch', $remoteUrl, $checkout) $repo
  $previousRefs = @(Get-HashedAssetRefs (Join-Path $checkout 'index.html'))

  Get-ChildItem -LiteralPath $dist -Force | Copy-Item -Destination $checkout -Recurse -Force
  $currentRefs = @(Get-HashedAssetRefs (Join-Path $checkout 'index.html'))
  $requiredRefs = @($previousRefs + $currentRefs | Sort-Object -Unique)

  foreach ($ref in $requiredRefs) {
    $candidate = Join-Path $checkout ($ref -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Deployment would break cached HTML: missing $ref"
    }
  }

  $retainedAssets = @(Get-ChildItem -LiteralPath (Join-Path $checkout 'assets') -File -Filter 'index-*' |
    ForEach-Object { "assets/$($_.Name)" } |
    Sort-Object -Unique)
  $build = (Get-Content -Raw (Join-Path $checkout 'version.json') | ConvertFrom-Json).build
  $compatibility = [ordered]@{
    build = $build
    previousIndexAssets = $previousRefs
    currentIndexAssets = $currentRefs
    retainedAssets = $retainedAssets
  }
  $compatibilityJson = $compatibility | ConvertTo-Json -Depth 3
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $checkout 'assets/deploy-compatibility.json'), $compatibilityJson, $utf8WithoutBom)

  Invoke-Checked 'git' @('-C', $checkout, 'add', '-A') $repo
  $changes = (& git -C $checkout status --porcelain)
  if ($DryRun) {
    Write-Output ("DRY_RUN_BUILD=" + $build)
    Write-Output ("PREVIOUS_INDEX_ASSETS=" + $previousRefs.Count)
    Write-Output ("CURRENT_INDEX_ASSETS=" + $currentRefs.Count)
    Write-Output ("RETAINED_ASSETS=" + $retainedAssets.Count)
  }
  elseif (-not $changes) {
    Write-Output 'Pages already matches the tested build.'
  }
  else {
    Invoke-Checked 'git' @('-C', $checkout, 'config', 'user.name', 'chickendavefifteen') $repo
    Invoke-Checked 'git' @('-C', $checkout, 'config', 'user.email', '24751216+chickendavefifteen@users.noreply.github.com') $repo
    Invoke-Checked 'git' @('-C', $checkout, 'commit', '-m', "Deploy Chipvault build $build") $repo
    Invoke-Checked 'git' @('-C', $checkout, 'push', 'origin', 'gh-pages') $repo
    Write-Output ("DEPLOYED=" + (& git -C $checkout rev-parse HEAD).Trim())
    Write-Output ("RETAINED_ASSETS=" + $retainedAssets.Count)
  }
}
finally {
  $resolvedTemp = Resolve-Path -LiteralPath $tempRoot -ErrorAction SilentlyContinue
  if ($resolvedTemp) {
    $safePrefix = $tempBase.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $isSafe = $resolvedTemp.Path.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemp.Path).StartsWith('n9nes9-pages-', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $isSafe) { throw "Refusing to remove unexpected temp path: $($resolvedTemp.Path)" }
    Remove-Item -LiteralPath $resolvedTemp.Path -Recurse -Force
  }
}
