import { describe, it, expect } from 'vitest';
import { slugify, generatePieceId, generateAssetId, buildAssetKey } from './ids';

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Hawa Mahal, Morning Light')).toBe('hawa-mahal-morning-light');
	});

	it('strips accents', () => {
		expect(slugify('Café à Paris')).toBe('cafe-a-paris');
	});

	it('collapses repeated separators and trims leading/trailing hyphens', () => {
		expect(slugify('  --Weird!!  Title--  ')).toBe('weird-title');
	});

	it('returns empty string for input with nothing sluggable', () => {
		expect(slugify('!!!')).toBe('');
	});
});

describe('generatePieceId', () => {
	it('combines date and slugified title', () => {
		const id = generatePieceId('Hawa Mahal', '2023-11-14', new Set());
		expect(id).toBe('2023-11-14-hawa-mahal');
	});

	it('falls back to "untitled" when the title has nothing sluggable', () => {
		const id = generatePieceId('!!!', '2023-11-14', new Set());
		expect(id).toBe('2023-11-14-untitled');
	});

	it('appends a numeric suffix on collision, and keeps incrementing until free', () => {
		const existing = new Set(['2023-11-14-hawa-mahal', '2023-11-14-hawa-mahal-2']);
		const id = generatePieceId('Hawa Mahal', '2023-11-14', existing);
		expect(id).toBe('2023-11-14-hawa-mahal-3');
	});

	it('does not collide when the set is empty', () => {
		const id = generatePieceId('Hawa Mahal', '2023-11-14', new Set());
		expect(id).toBe('2023-11-14-hawa-mahal');
	});
});

describe('generateAssetId', () => {
	it('starts from a1 when nothing exists', () => {
		expect(generateAssetId(new Set())).toBe('a1');
	});

	it('skips ids already in the set', () => {
		expect(generateAssetId(new Set(['a1', 'a2']))).toBe('a3');
	});

	it('keeps incrementing past a collision even when the size-based initial guess collides', () => {
		// size is 1, so the initial guess is 'a2' — which is already taken here. Confirms the
		// while-loop actually checks membership rather than trusting size+1 to be free.
		const id = generateAssetId(new Set(['a2']));
		expect(id).toBe('a3');
	});
});

describe('buildAssetKey', () => {
	it('is namespaced under assets/<pieceId>/ and versioned by timestamp', () => {
		const key = buildAssetKey('2023-11-14-hawa-mahal', 'a1', 'png');
		expect(key).toMatch(/^assets\/2023-11-14-hawa-mahal\/a1-v\d+\.png$/);
	});

	it('produces a different key for the same asset when called again (never reused)', async () => {
		const key1 = buildAssetKey('piece', 'a1', 'png');
		await new Promise((resolve) => setTimeout(resolve, 2));
		const key2 = buildAssetKey('piece', 'a1', 'png');
		expect(key1).not.toBe(key2);
	});
});
