export function slugify(input: string): string {
	return input
		.toLowerCase()
		.normalize('NFKD')
		.replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function generatePieceId(title: string, date: string, existingIds: ReadonlySet<string>): string {
	const slug = slugify(title) || 'untitled';
	const base = `${date}-${slug}`;
	let candidate = base;
	let suffix = 2;
	while (existingIds.has(candidate)) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

export function generateAssetId(existingIds: ReadonlySet<string>): string {
	let n = existingIds.size + 1;
	let candidate = `a${n}`;
	while (existingIds.has(candidate)) {
		n += 1;
		candidate = `a${n}`;
	}
	return candidate;
}

/** Fresh, never-reused key per upload so image cache invalidation is never needed. */
export function buildAssetKey(pieceId: string, assetId: string, ext: string): string {
	return `assets/${pieceId}/${assetId}-v${Date.now()}.${ext}`;
}
