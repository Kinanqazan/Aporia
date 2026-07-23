export type ImageDimensions = {
	width: number;
	height: number;
};

/**
 * Keeps an image within its containing block without changing its aspect ratio.
 */
export function constrainImageSizeToWidth(
	dimensions: ImageDimensions,
	maxWidth: number
): ImageDimensions {
	if (!Number.isFinite(maxWidth) || maxWidth <= 0 || dimensions.width <= maxWidth) {
		return dimensions;
	}

	const scale = maxWidth / dimensions.width;
	return {
		width: maxWidth,
		height: dimensions.height * scale
	};
}
