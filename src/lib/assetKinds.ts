import type { AssetKind } from './types';

/** Human-readable label for every asset kind — used by the edit form's per-asset kind selector
 * and the /kind/<kind> page header. `unsorted` is the default kind for newly-uploaded "additional
 * photos": upload everything in one go, then come back and tag each one afterward, rather than
 * having to pick a kind per photo while still in the photos app. */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
	final: 'Final piece',
	unsorted: 'Unsorted',
	'reference-photo': 'Reference photo',
	'in-progress': 'In-progress photo',
	'value-study': 'Value study scan',
	setup: 'Setup / easel photo'
};

export const ASSET_KINDS = Object.keys(ASSET_KIND_LABELS) as AssetKind[];
