export interface Dimensions {
	width: number;
	height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads width/height directly from PNG/JPEG headers — no image decoder needed, just the first
 * few bytes. Workers has no native image library, and pulling in a full decoder for this alone
 * would be overkill. Returns null for anything else (e.g. unrecognized format); callers should
 * fall back to 0, 0 rather than fail the upload over it.
 */
export function getImageDimensions(bytes: Uint8Array): Dimensions | null {
	if (isPng(bytes)) return getPngDimensions(bytes);
	if (isJpeg(bytes)) return getJpegDimensions(bytes);
	return null;
}

function isPng(bytes: Uint8Array): boolean {
	return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function getPngDimensions(bytes: Uint8Array): Dimensions | null {
	if (bytes.length < 24) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function isJpeg(bytes: Uint8Array): boolean {
	return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function getJpegDimensions(bytes: Uint8Array): Dimensions | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset++;
			continue;
		}
		const marker = bytes[offset + 1];
		// SOF0-SOF15 markers carry the dimensions, except DHT/JPG/DAC which share the range.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
		}
		const segmentLength = view.getUint16(offset + 2, false);
		if (segmentLength < 2) return null; // malformed — bail rather than loop forever
		offset += 2 + segmentLength;
	}
	return null;
}
