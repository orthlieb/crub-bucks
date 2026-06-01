/**
 * Client-side image downsampling for avatar uploads. Produces a square
 * `size`×`size` image (center-cropped, "cover" fit) encoded as WebP — keeping
 * the uploaded payload tiny and the heavy lifting off the server.
 */
export async function resizeToSquare(file: File, size = 512): Promise<Blob> {
	const bitmap = await loadBitmap(file);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');

		// Cover-fit: scale so the shorter side fills the square, then center-crop.
		const scale = Math.max(size / bitmap.width, size / bitmap.height);
		const w = bitmap.width * scale;
		const h = bitmap.height * scale;
		ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);

		const blob = await new Promise<Blob | null>((resolve) =>
			// WebP where supported; browsers that don't support it fall back to PNG,
			// which the server also accepts.
			canvas.toBlob(resolve, 'image/webp', 0.85)
		);
		if (!blob) throw new Error('Could not encode image');
		return blob;
	} finally {
		if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
	}
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
	if (typeof createImageBitmap === 'function') {
		try {
			// Respect EXIF orientation so phone photos aren't sideways.
			return await createImageBitmap(file, {
				imageOrientation: 'from-image'
			} as ImageBitmapOptions);
		} catch {
			// fall through to the <img> path
		}
	}
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Could not load image'));
			img.src = url;
		});
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}
