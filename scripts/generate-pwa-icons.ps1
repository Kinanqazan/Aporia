Add-Type -AssemblyName System.Drawing

if (-not ('PwaIconArtwork' -as [type])) {
	$systemDrawingDirectory = Split-Path ([System.Drawing.Image].Assembly.Location)
	$drawingReferences = @([System.Drawing.Image].Assembly.Location)
	foreach ($assemblyName in @(
		'System.Private.Windows.GdiPlus.dll',
		'System.Private.Windows.Core.dll',
		'System.Drawing.Primitives.dll'
	)) {
		$assemblyPath = Join-Path $systemDrawingDirectory $assemblyName
		if (Test-Path $assemblyPath) {
			$drawingReferences += $assemblyPath
		}
	}
	Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PwaIconArtwork
{
	public static Bitmap CreateWhiteArtwork(Image source)
	{
		var artwork = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
		using (var graphics = Graphics.FromImage(artwork))
		{
			graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
			graphics.DrawImage(source, new Rectangle(0, 0, source.Width, source.Height));
		}

		var bounds = new Rectangle(0, 0, artwork.Width, artwork.Height);
		var data = artwork.LockBits(bounds, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
		try
		{
			var pixels = new byte[Math.Abs(data.Stride) * artwork.Height];
			Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
			for (var index = 0; index < pixels.Length; index += 4)
			{
				if (pixels[index + 3] == 0) continue;
				pixels[index] = 255;
				pixels[index + 1] = 255;
				pixels[index + 2] = 255;
			}
			Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
		}
		finally
		{
			artwork.UnlockBits(data);
		}

		return artwork;
	}
}
"@ -ReferencedAssemblies $drawingReferences -ErrorAction Stop
}

$staticDirectory = Join-Path $PSScriptRoot '..\static'
$sourcePath = Join-Path $staticDirectory 'aporia-logo.png'
$source = [System.Drawing.Image]::FromFile($sourcePath)
$whiteArtwork = [PwaIconArtwork]::CreateWhiteArtwork($source)
$pwaBackgroundColor = '#A64D53'

function New-PwaIcon {
	param(
		[int] $Size,
		[double] $ArtworkScale,
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

	$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($pwaBackgroundColor))

	$artworkSize = [Math]::Round($Size * $ArtworkScale)
	$offset = [Math]::Round(($Size - $artworkSize) / 2)
	$destination = [System.Drawing.Rectangle]::new($offset, $offset, $artworkSize, $artworkSize)
	$graphics.DrawImage($whiteArtwork, $destination)

	$outputPath = Join-Path $staticDirectory $OutputName
	$fileStream = [System.IO.File]::Open(
		$outputPath,
		[System.IO.FileMode]::Create,
		[System.IO.FileAccess]::Write,
		[System.IO.FileShare]::None
	)
	$canvas.Save($fileStream, [System.Drawing.Imaging.ImageFormat]::Png)
	$fileStream.Dispose()
	$graphics.Dispose()
	$canvas.Dispose()
}

try {
	# PWA installation icons use the white logo on an opaque, muted red canvas.
	New-PwaIcon -Size 192 -ArtworkScale 0.78 -OutputName 'aporia-icon-192.png'
	New-PwaIcon -Size 512 -ArtworkScale 0.78 -OutputName 'aporia-icon-512.png'

	# Maskable icons keep the logo inside the circular safe zone.
	New-PwaIcon -Size 192 -ArtworkScale 0.58 -OutputName 'aporia-icon-maskable-192.png'
	New-PwaIcon -Size 512 -ArtworkScale 0.58 -OutputName 'aporia-icon-maskable-512.png'

	# Safari uses this icon for home-screen installation.
	New-PwaIcon -Size 180 -ArtworkScale 0.78 -OutputName 'aporia-icon-apple-touch.png'
} finally {
	$whiteArtwork.Dispose()
	$source.Dispose()
}
