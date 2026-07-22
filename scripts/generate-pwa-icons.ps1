Add-Type -AssemblyName System.Drawing

$staticDirectory = Join-Path $PSScriptRoot '..\static'
$sourcePath = Join-Path $staticDirectory 'aporia-logo.png'
$source = [System.Drawing.Image]::FromFile($sourcePath)

function New-PwaIcon {
	param(
		[int] $Size,
		[double] $ArtworkScale,
		[bool] $UseLauncherBackground,
		[string] $OutputName
	)

	$canvas = [System.Drawing.Bitmap]::new(
		$Size,
		$Size,
		[System.Drawing.Imaging.PixelFormat]::Format32bppArgb
	)
	$graphics = [System.Drawing.Graphics]::FromImage($canvas)
	$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
	$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
	$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

	if ($UseLauncherBackground) {
		$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#191919'))
	} else {
		$graphics.Clear([System.Drawing.Color]::Transparent)
	}

	$artworkSize = [Math]::Round($Size * $ArtworkScale)
	$offset = [Math]::Round(($Size - $artworkSize) / 2)
	$destination = [System.Drawing.Rectangle]::new($offset, $offset, $artworkSize, $artworkSize)
	$graphics.DrawImage($source, $destination)

	$outputPath = Join-Path $staticDirectory $OutputName
	$canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
	$graphics.Dispose()
	$canvas.Dispose()
}

try {
	# Regular icons retain a confident visual size without touching the launcher mask.
	New-PwaIcon -Size 192 -ArtworkScale 0.78 -UseLauncherBackground $false -OutputName 'aporia-icon-192.png'
	New-PwaIcon -Size 512 -ArtworkScale 0.78 -UseLauncherBackground $false -OutputName 'aporia-icon-512.png'

	# Maskable icons need an opaque full canvas and a smaller, circular safe zone.
	New-PwaIcon -Size 192 -ArtworkScale 0.50 -UseLauncherBackground $true -OutputName 'aporia-icon-maskable-192.png'
	New-PwaIcon -Size 512 -ArtworkScale 0.50 -UseLauncherBackground $true -OutputName 'aporia-icon-maskable-512.png'

	# Safari ignores the manifest icon list, so it receives the regular padded icon directly.
	New-PwaIcon -Size 180 -ArtworkScale 0.78 -UseLauncherBackground $false -OutputName 'aporia-icon-apple-touch.png'
} finally {
	$source.Dispose()
}
