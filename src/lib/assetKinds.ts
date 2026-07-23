import type { AssetKind } from './types';

/** Human-readable label for every asset kind — used by the "additional photos" kind selector shown
 * at upload time, the edit form's per-asset re-kind selector, and the /kind/<kind> page header.
 * `unsorted` is the fallback kind for an "additional photo" uploaded without a kind actually picked
 * (missing/invalid `kind_extra_<i>` field) — normally every photo gets tagged with a real kind
 * immediately at selection time, not left as `unsorted` to sort out later. */
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
	final: 'Final piece',
	unsorted: 'Unsorted',
	'reference-photo': 'Reference photo',
	'in-progress': 'In-progress photo',
	'value-study': 'Value study scan',
	setup: 'Setup / easel photo'
};

export const ASSET_KINDS = Object.keys(ASSET_KIND_LABELS) as AssetKind[];
