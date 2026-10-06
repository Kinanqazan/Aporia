$ErrorActionPreference = 'Stop'

$gradleWrapper = Join-Path $PSScriptRoot 'gradlew.bat'
$apkSource = Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk'
$apkDestination = Join-Path $PSScriptRoot 'Aporia.apk'
$appBuildDirectory = Join-Path $PSScriptRoot 'app\build'

& $gradleWrapper assembleDebug
if ($LASTEXITCODE -ne 0) {
	throw "Gradle assembleDebug failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $apkSource -PathType Leaf)) {
	throw "Gradle completed, but the expected APK was not found: $apkSource"
}

Copy-Item -LiteralPath $apkSource -Destination $apkDestination -Force

if (Test-Path -LiteralPath $appBuildDirectory -PathType Container) {
	Remove-Item -LiteralPath $appBuildDirectory -Recurse -Force
}

Write-Host "Built APK: $apkDestination"
