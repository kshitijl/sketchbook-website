import type { AssetKind } from './types';

/** Shared between the admin upload form and its POST handler (and, later, the edit form). */
export const ASSET_KIND_FIELDS: { kind: AssetKind; field: string; label: string; required?: boolean }[] = [
	{ kind: 'final', field: 'asset_final', label: 'Final piece', required: true },
	{ kind: 'reference-photo', field: 'asset_reference_photo', label: 'Reference photo' },
	{ kind: 'in-progress', field: 'asset_in_progress', label: 'In-progress photo' },
	{ kind: 'value-study', field: 'asset_value_study', label: 'Value study scan' },
	{ kind: 'setup', field: 'asset_setup', label: 'Setup / easel photo' }
];
