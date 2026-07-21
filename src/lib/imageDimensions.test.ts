import { describe, it, expect } from 'vitest';
import { getImageDimensions } from './imageDimensions';

/** Only what getPngDimensions actually reads: an 8-byte signature, then width/height as
 * big-endian uint32 at fixed offsets 16 and 20 — no real chunk/CRC structure needed. */
function buildMinimalPng(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width, false);
	view.setUint32(20, height, false);
	return bytes;
}

/** SOI, a dummy APP0 segment (to exercise the segment-skipping logic), then a SOF0 segment
 * carrying the real height/width. */
function buildMinimalJpeg(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	const view = new DataView(bytes.buffer);
	bytes[0] = 0xff;
	bytes[1] = 0xd8; // SOI
	bytes[2] = 0xff;
	bytes[3] = 0xe0; // APP0 marker
	view.setUint16(4, 5, false); // segment length: 2 length bytes + 3 payload bytes
	// bytes[6..9) payload, left as zero
	bytes[9] = 0xff;
	bytes[10] = 0xc0; // SOF0 marker
	view.setUint16(11, 17, false); // segment length (unused by the parser, just realistic)
	bytes[13] = 0x08; // precision
	view.setUint16(14, height, false);
	view.setUint16(16, width, false);
	return bytes;
}

describe('getImageDimensions — PNG', () => {
	it('reads width/height from a minimal PNG header', () => {
		expect(getImageDimensions(buildMinimalPng(400, 300))).toEqual({ width: 400, height: 300 });
	});

	it('returns null for a PNG signature that is too short to contain IHDR', () => {
		const truncated = buildMinimalPng(400, 300).slice(0, 20);
		expect(getImageDimensions(truncated)).toBeNull();
	});
});

describe('getImageDimensions — JPEG', () => {
	it('reads width/height from a minimal JPEG, skipping a preceding APP0 segment', () => {
		expect(getImageDimensions(buildMinimalJpeg(400, 300))).toEqual({ width: 400, height: 300 });
	});

	it('returns null when no SOF marker is found before running out of bytes', () => {
		const noSof = new Uint8Array(24);
		noSof[0] = 0xff;
		noSof[1] = 0xd8;
		// rest zeroed — no valid markers at all
		expect(getImageDimensions(noSof)).toBeNull();
	});

	it('returns null (does not infinite-loop) on a malformed segment length', () => {
		const malformed = new Uint8Array(24);
		malformed[0] = 0xff;
		malformed[1] = 0xd8;
		malformed[2] = 0xff;
		malformed[3] = 0xe0;
		new DataView(malformed.buffer).setUint16(4, 0, false); // invalid: length < 2
		expect(getImageDimensions(malformed)).toBeNull();
	});
});

describe('getImageDimensions — unrecognized format', () => {
	it('returns null instead of throwing', () => {
		expect(getImageDimensions(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
	});

	it('returns null for an empty buffer', () => {
		expect(getImageDimensions(new Uint8Array(0))).toBeNull();
	});
});
