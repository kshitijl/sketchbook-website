import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { heicTo, isHeic } from 'heic-to';
import Pica from 'pica';
import { SIZE_WIDTHS } from '../lib/images';
import { fixLeafletDefaultIcon } from './leafletIcons';

// One shared instance. Pica does Lanczos downscaling (sharper than a plain canvas draw) and tiles
// large sources internally, so it avoids Safari's canvas-area limit on big scans. No SharedArrayBuffer
// / cross-origin isolation needed (unlike wasm-vips), so it doesn't affect the admin map/geocoding.
const pica = Pica();

fixLeafletDefaultIcon();

interface NominatimReverseResult {
	display_name?: string;
	address?: {
		city?: string;
		town?: string;
		village?: string;
		hamlet?: string;
		county?: string;
		country?: string;
	};
}

interface NominatimSearchResult {
	lat: string;
	lon: string;
}

export interface PieceFormOptions {
	initialLat?: number;
	initialLng?: number;
	/** Fire geolocation automatically on load — only appropriate for a brand-new piece with no
	 * location set yet, not when editing something that already has one. */
	autoUseCurrentLocation?: boolean;
}

/** Wires up the location map, tag-frequency chips, asset previews, per-file kind tagging on the
 * "additional photos" input, and filename-derived title/date suggestions shared by the new-piece
 * and edit-piece admin forms. */
export function setupPieceForm(options: PieceFormOptions = {}): void {
	setupLocationPicker(options);
	setupAssetPreviews();
	setupExtraAssetTagging();
	setupFilenameSuggestions();
	setupSubmitWithProgress();
	setupDragAndDrop();
	setupTagChips();
}

/**
 * Lets you drag images straight from Photos/Finder onto a `.dropzone[data-drop-for]` instead of the
 * scroll-heavy file picker. The dropped files are loaded into the referenced file input and a
 * `change` event is fired, so the existing preview / kind-tagging / filename-suggestion / submit
 * handlers all treat it exactly like a picked file — no separate code path.
 */
function setupDragAndDrop(): void {
	document.querySelectorAll<HTMLElement>('.dropzone[data-drop-for]').forEach((zone) => {
		const input = document.getElementById(zone.dataset.dropFor ?? '') as HTMLInputElement | null;
		if (!input) return;

		zone.addEventListener('dragover', (e) => {
			e.preventDefault();
			zone.classList.add('dragover');
		});
		zone.addEventListener('dragleave', (e) => {
			// Ignore dragleave that only crossed into a child element, so the highlight doesn't flicker.
			if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove('dragover');
		});
		zone.addEventListener('drop', (e) => {
			e.preventDefault();
			zone.classList.remove('dragover');
			const dropped = e.dataTransfer?.files;
			if (!dropped || dropped.length === 0) return;
			const dt = new DataTransfer();
			if (input.multiple) {
				// Keep whatever's already selected and add the newly dropped files on top, so
				// dropping one photo at a time accumulates instead of each drop replacing the last.
				for (const file of input.files ?? []) dt.items.add(file);
				for (const file of dropped) {
					if (file.type.startsWith('image/')) dt.items.add(file);
				}
			} else {
				// Single-file inputs (the main image) take just the first, replacing whatever was there.
				const file = dropped[0];
				if (file.type.startsWith('image/')) dt.items.add(file);
			}
			if (dt.files.length === 0) return;
			input.files = dt.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
	});
}

const VARIANT_SIZES = ['thumb', 'card', 'big'] as const;
type VariantSize = (typeof VARIANT_SIZES)[number];

/** Losslessly replaces a HEIC file with a PNG — used both for browser `<img>` previews (HEIC
 * can't be rendered outside Safari) and for the archival master upload itself. PNG, never a lossy
 * JPEG/WebP re-encode: this is an archival site, so converting away from HEIC is purely a format-
 * compatibility move for the rest of the system — the pixel data has to come through unchanged.
 * Non-HEIC files pass through untouched. */
async function pngIfHeic(file: File): Promise<File> {
	if (!(await isHeic(file))) return file;
	const png = await heicTo({ blob: file, type: 'image/png' });
	return new File([png], file.name.replace(/\.hei[cf]$/i, '.png'), { type: 'image/png' });
}

/** A raw `URL.createObjectURL(file)` is enough for an `<img>` preview of any format the browser
 * can natively decode — but that's not HEIC outside Safari, so it needs converting first just to
 * be previewable at all. */
async function previewUrlFor(file: File): Promise<string> {
	try {
		return URL.createObjectURL(await pngIfHeic(file));
	} catch (err) {
		console.error('HEIC preview conversion failed:', err);
		return URL.createObjectURL(file); // best effort — browser will show a broken image
	}
}

/**
 * Generate the three pre-generated WebP display variants for an uploaded image, entirely in the
 * browser — the site no longer resizes on the fly, so every uploaded image must arrive with these.
 * Decodes with EXIF orientation applied, downscales each size with Pica (Lanczos, tiled so large
 * scans don't hit Safari's canvas-area limit), and encodes WebP. Returns null on any failure (the
 * server then rejects the upload rather than storing a variant-less record). Isolated here so the
 * resize/encode engine stays swappable.
 */
async function makeVariants(file: File): Promise<Record<VariantSize, File> | null> {
	try {
		// HEIC needs a WASM decode to get a bitmap at all — `createImageBitmap` can't read it in
		// any browser but Safari. libheif applies the container's own orientation transform during
		// that decode, so the bitmap comes out right-side up without a separate orientation step.
		//
		// `imageOrientation: 'from-image'` on the non-HEIC path applies the photo's EXIF orientation
		// (phone photos are often stored landscape with a "rotate 90°" tag) so the variant pixels
		// come out the right way up — the old Cloudflare Images binding did this automatically; a
		// plain decode would not.
		const bitmap = (await isHeic(file))
			? await heicTo({ blob: file, type: 'bitmap' })
			: await createImageBitmap(file, { imageOrientation: 'from-image' });
		const out = {} as Record<VariantSize, File>;
		for (const size of VARIANT_SIZES) {
			const scale = Math.min(1, SIZE_WIDTHS[size] / bitmap.width); // cap width, never enlarge
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			await pica.resize(bitmap, canvas); // Lanczos downscale into the target-sized canvas
			const blob = await pica.toBlob(canvas, 'image/webp', 0.82);
			out[size] = new File([blob], `${size}.webp`, { type: 'image/webp' });
		}
		bitmap.close();
		return out;
	} catch (err) {
		console.error('Image resize failed:', err); // unsupported format, out of memory, etc.
		return null;
	}
}

/**
 * Intercepts the piece form's submit to (1) show per-step feedback — resizing each image, then
 * uploading — and (2) surface every failure as a visible message instead of dumping to a blank
 * error page. Generates the WebP variants at submit time and posts everything (fields, master files,
 * and the generated variants) via fetch. Shared by the new-piece and edit-piece forms; the separate
 * delete-piece form isn't touched (this only binds the form containing the image inputs).
 */
function setupSubmitWithProgress(): void {
	const finalInput = document.getElementById('finalImageInput') as HTMLInputElement | null;
	const form = finalInput?.closest('form');
	if (!finalInput || !form) return;
	const extraInput = document.getElementById('extraAssetInput') as HTMLInputElement | null;
	const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
	const status = document.getElementById('saveStatus');

	function log(msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
		if (!status) return;
		const line = document.createElement('div');
		line.textContent = (kind === 'ok' ? '✓ ' : kind === 'error' ? '⚠ ' : '') + msg;
		if (kind === 'error') line.style.color = 'var(--accent-3)';
		status.appendChild(line);
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (status) status.innerHTML = '';
		if (submitBtn) submitBtn.disabled = true;
		try {
			const data = new FormData(form); // all text fields, kind selects, and the master file inputs

			const finalFile = finalInput.files?.[0];
			if (finalFile) {
				log('Resizing main image…');
				// The archival master itself must not stay HEIC either — swap in the lossless PNG
				// conversion so nothing gets stored in a format the rest of the system can't use.
				data.set('asset_final', await pngIfHeic(finalFile));
				const variants = await makeVariants(finalFile);
				if (!variants) throw new Error(`Couldn't resize the main image "${finalFile.name}" — try a JPEG or PNG.`);
				for (const size of VARIANT_SIZES) data.set(`asset_final_${size}`, variants[size]);
				log('Main image resized.', 'ok');
			}

			const extras = extraInput?.files ? [...extraInput.files] : [];
			data.delete('asset_extra'); // re-added below in the same order, HEIC ones swapped for PNG
			for (let i = 0; i < extras.length; i++) {
				log(`Resizing additional photo ${i + 1} of ${extras.length}…`);
				data.append('asset_extra', await pngIfHeic(extras[i]));
				const variants = await makeVariants(extras[i]);
				if (!variants) throw new Error(`Couldn't resize additional photo ${i + 1} ("${extras[i].name}").`);
				for (const size of VARIANT_SIZES) data.set(`asset_extra_${size}_${i}`, variants[size]);
				log(`Additional photo ${i + 1} resized.`, 'ok');
			}

			log('Uploading…');
			const res = await fetch(form.action, { method: 'POST', body: data });
			if (res.redirected) {
				window.location.assign(res.url); // success -> /piece/<id>?added=1
				return;
			}
			if (res.ok) {
				// The server re-rendered the form with validation errors (its <ul> of messages) — show them.
				const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
				const errors = [...doc.querySelectorAll('ul[style*="accent-3"] li')]
					.map((li) => li.textContent?.trim())
					.filter(Boolean) as string[];
				(errors.length ? errors : ['The submission was rejected, but no error detail came back.']).forEach((msg) =>
					log(msg, 'error')
				);
			} else {
				const body = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
				log(`Upload failed — HTTP ${res.status}. ${body}`, 'error');
			}
		} catch (err) {
			log(`Something went wrong: ${(err as Error)?.message ?? String(err)}`, 'error');
		} finally {
			if (submitBtn) submitBtn.disabled = false;
		}
	});
}

function setupLocationPicker(options: PieceFormOptions): void {
	const latInput = document.getElementById('latInput') as HTMLInputElement | null;
	const lngInput = document.getElementById('lngInput') as HTMLInputElement | null;
	const locationReadout = document.getElementById('locationReadout');
	const placeNameInput = document.getElementById('placeNameInput') as HTMLInputElement | null;
	const mapEl = document.getElementById('locationMap');
	if (!latInput || !lngInput || !locationReadout || !placeNameInput || !mapEl) return;

	const hasInitial = typeof options.initialLat === 'number' && typeof options.initialLng === 'number';
	const map = L.map(mapEl).setView(
		hasInitial ? [options.initialLat as number, options.initialLng as number] : [40.7128, -74.006],
		hasInitial ? 13 : 3
	);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors',
		maxZoom: 19
	}).addTo(map);

	let marker: L.Marker | null = null;
	let lastSuggestedPlaceName = '';

	if (hasInitial) {
		marker = L.marker([options.initialLat as number, options.initialLng as number]).addTo(map);
		locationReadout.textContent = `Selected: ${(options.initialLat as number).toFixed(5)}, ${(options.initialLng as number).toFixed(5)}`;
	}

	async function reverseGeocodePlaceName(lat: number, lng: number): Promise<string | null> {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=en`
			);
			if (!res.ok) return null;
			const result = (await res.json()) as NominatimReverseResult;
			const addr = result.address ?? {};
			const place = addr.city || addr.town || addr.village || addr.hamlet || addr.county || '';
			const parts = [place, addr.country].filter(Boolean);
			return parts.length > 0 ? parts.join(', ') : (result.display_name ?? null);
		} catch {
			return null; // offline, rate-limited, etc. — leave place name as-is, it's just a suggestion
		}
	}

	// `moveView` is false for a direct map click — the clicked point is already on screen, so
	// snapping the view to a fixed zoom there just to place a pin was the jarring "zooms out
	// suddenly" bug. Search and "use current location" still jump the view (the target usually
	// isn't visible yet), but never zoom out below whatever the map is already zoomed to.
	function setLocation(lat: number, lng: number, moveView = true) {
		latInput!.value = lat.toFixed(6);
		lngInput!.value = lng.toFixed(6);
		locationReadout!.textContent = `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
		if (marker) {
			marker.setLatLng([lat, lng]);
		} else {
			marker = L.marker([lat, lng]).addTo(map);
		}
		if (moveView) {
			map.setView([lat, lng], Math.max(map.getZoom(), 13));
		}

		reverseGeocodePlaceName(lat, lng).then((suggestion) => {
			if (!suggestion) return;
			// Never clobber a manually-typed place name — only fill if empty or still exactly
			// what we last suggested.
			if (placeNameInput!.value.trim() === '' || placeNameInput!.value === lastSuggestedPlaceName) {
				placeNameInput!.value = suggestion;
				lastSuggestedPlaceName = suggestion;
			}
		});
	}

	map.on('click', (e) => setLocation(e.latlng.lat, e.latlng.lng, false));

	// Typing a place name and searching (forward geocoding) instead of having to click the right
	// spot on a zoomed-out world map — same Nominatim service already used for reverse geocoding
	// above, just the other direction. Takes the single best match rather than offering a list of
	// candidates to pick from; good enough for searching a named place like "Prospect Park" on a
	// single-editor admin tool, not worth the extra UI for picking among ambiguous results.
	const searchInput = document.getElementById('locationSearchInput') as HTMLInputElement | null;
	const searchBtn = document.getElementById('locationSearchBtn') as HTMLButtonElement | null;
	const searchStatus = document.getElementById('locationSearchStatus');

	async function searchPlace(query: string): Promise<{ lat: number; lng: number } | null> {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=1`
			);
			if (!res.ok) return null;
			const results = (await res.json()) as NominatimSearchResult[];
			if (results.length === 0) return null;
			return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
		} catch {
			return null; // offline, rate-limited, etc.
		}
	}

	async function runLocationSearch() {
		const query = searchInput?.value.trim();
		if (!query || !searchStatus) return;
		searchStatus.textContent = 'Searching…';
		const result = await searchPlace(query);
		if (!result) {
			searchStatus.textContent = `No results for "${query}" — try clicking the map instead.`;
			return;
		}
		searchStatus.textContent = '';
		setLocation(result.lat, result.lng);
	}

	searchBtn?.addEventListener('click', runLocationSearch);
	searchInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			// This input sits inside the main admin <form> — without this, Enter would submit
			// the whole piece form instead of just running the search.
			e.preventDefault();
			runLocationSearch();
		}
	});

	function useCurrentLocation() {
		if (!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition(
			(pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
			() => {
				/* permission denied or unavailable — leave the map at its current view */
			}
		);
	}

	document.getElementById('useCurrentLocationBtn')?.addEventListener('click', useCurrentLocation);
	if (options.autoUseCurrentLocation) {
		// This is the admin's own tool on their own device, not a public page, so an automatic
		// permission prompt on load is fine.
		useCurrentLocation();
	}
}

function setupAssetPreviews(): void {
	document.querySelectorAll<HTMLInputElement>('.asset-preview-input').forEach((input) => {
		const previewId = input.dataset.previewId;
		const preview = previewId ? (document.getElementById(previewId) as HTMLImageElement | null) : null;
		if (!preview) return;
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) {
				preview.style.display = 'none';
				return;
			}
			previewUrlFor(file).then((url) => {
				preview.src = url;
				preview.style.display = 'block';
			});
		});
	});
}

// Mirrors ASSET_KIND_LABELS in src/lib/assetKinds.ts, minus `final` (that one has its own
// dedicated slot, not a per-file selector). Duplicated rather than imported: this script bundles
// standalone for the browser, and the kind list is small and rarely changes.
const EXTRA_KIND_OPTIONS: Array<[string, string]> = [
	['unsorted', 'Unsorted'],
	['reference-photo', 'Reference photo'],
	['in-progress', 'In-progress photo'],
	['value-study', 'Value study scan'],
	['setup', 'Setup / easel photo']
];

// File objects have no stable id of their own, so this is what identifies "the same file" across
// a list rebuild (e.g. after a drop adds another file, or a row's remove button is clicked).
function fileIdentity(file: File): string {
	return `${file.name}:${file.size}:${file.lastModified}`;
}

/** The "additional photos" input used to show one generic preview and always upload as
 * `unsorted`, tagged for real only later on the edit page. Now each selected file gets its own
 * thumbnail plus a kind selector immediately, right here — tagging happens once, at selection
 * time, no second trip needed. Selects are named `kind_extra_<i>`, indexed to match the order
 * files appear in the input's FileList, which is also the order the server sees them in via
 * `formData.getAll('asset_extra')`. */
function setupExtraAssetTagging(): void {
	const input = document.getElementById('extraAssetInput') as HTMLInputElement | null;
	const list = document.getElementById('extraAssetList');
	if (!input || !list) return;

	// Chosen kinds survive the list being torn down and rebuilt (on every drop/remove) by keying
	// on file identity rather than list position.
	const kindByFile = new Map<string, string>();

	function removeFile(index: number): void {
		const dt = new DataTransfer();
		(input!.files ? Array.from(input!.files) : []).forEach((file, i) => {
			if (i !== index) dt.items.add(file);
		});
		input!.files = dt.files;
		input!.dispatchEvent(new Event('change', { bubbles: true }));
	}

	input.addEventListener('change', () => {
		list.innerHTML = '';
		const files = input.files ? Array.from(input.files) : [];
		files.forEach((file, i) => {
			const row = document.createElement('div');
			row.style.cssText = 'display:flex; align-items:center; gap:0.75rem; margin:0.5rem 0;';

			const img = document.createElement('img');
			img.alt = file.name;
			img.style.cssText = 'max-width:100px; max-height:100px; display:block;';
			previewUrlFor(file).then((url) => {
				img.src = url;
			});

			const select = document.createElement('select');
			select.name = `kind_extra_${i}`;
			for (const [value, label] of EXTRA_KIND_OPTIONS) {
				const option = document.createElement('option');
				option.value = value;
				option.textContent = label;
				select.appendChild(option);
			}
			const identity = fileIdentity(file);
			const savedKind = kindByFile.get(identity);
			if (savedKind) select.value = savedKind;
			select.addEventListener('change', () => kindByFile.set(identity, select.value));

			const removeBtn = document.createElement('button');
			removeBtn.type = 'button'; // this sits inside the main form — must not submit it
			removeBtn.textContent = 'Remove';
			removeBtn.addEventListener('click', () => removeFile(i));

			row.appendChild(img);
			row.appendChild(select);
			row.appendChild(removeBtn);
			list.appendChild(row);
		});
	});
}

function setupFilenameSuggestions(): void {
	const finalInput = document.getElementById('finalImageInput') as HTMLInputElement | null;
	const titleInput = document.getElementById('titleInput') as HTMLInputElement | null;
	const dateInput = document.getElementById('dateInput') as HTMLInputElement | null;
	if (!finalInput) return;

	// The date field always starts with a real value (today, for a new piece; the existing date,
	// when editing) rather than being empty like the title field does — so "only fill if empty"
	// can't tell "still the untouched default" apart from "the user already set this on purpose."
	// Tracking the value as it stood at page load can: only overwrite it while it's still exactly
	// that, same idea as the reverse-geocoded place name above.
	let lastSuggestedDate = dateInput?.value ?? '';

	finalInput.addEventListener('change', () => {
		const file = finalInput.files?.[0];
		if (!file) return;

		// Only ever fills an empty title — never overwrites something already typed/set.
		if (titleInput && !titleInput.value.trim()) {
			titleInput.value = suggestTitleFromFilename(file.name);
		}

		const suggestedDate = suggestDateFromFilename(file.name);
		if (suggestedDate && dateInput && dateInput.value === lastSuggestedDate) {
			dateInput.value = suggestedDate;
			lastSuggestedDate = suggestedDate;
		}
	});
}

function suggestTitleFromFilename(filename: string): string {
	const base = filename.replace(/\.[^.]+$/, '');
	const words = base
		.replace(/[-_]+/g, ' ')
		.replace(/[0-9]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return words.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** Looks for a `YYYY-MM-DD`/`YYYY_MM_DD` or bare `YYYYMMDD` run in the filename (the latter is
 * how most phone camera apps name files, e.g. `IMG_20231114_153022.jpg`) and returns it as an
 * ISO date string if found and it looks like a real calendar date. Best-effort, not exhaustive —
 * covers the common cases, never blocks manual entry since the caller only uses this as a
 * pre-fill. */
function suggestDateFromFilename(filename: string): string | null {
	const patterns = [/(?:^|\D)(\d{4})[-_](\d{2})[-_](\d{2})(?:\D|$)/, /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/];
	for (const pattern of patterns) {
		const match = filename.match(pattern);
		if (!match) continue;
		const [, year, month, day] = match;
		if (isPlausibleDate(Number(year), Number(month), Number(day))) {
			return `${year}-${month}-${day}`;
		}
	}
	return null;
}

function isPlausibleDate(year: number, month: number, day: number): boolean {
	return year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Chips both add/remove tags on click (toggling) and, in either direction, show which tags are
 * currently in the box — including tags typed by hand, not just ones added by clicking — so
 * selection state stays visible even once the box has more tags in it than fit on one line.
 * Shared by the new/edit piece forms (a `<textarea id="tagsInput">`) and the bulk-tag admin page
 * (a plain `<input id="tagsInput">`) — exported since bulk-tag doesn't need the rest of
 * `setupPieceForm` (no location map, no file inputs). */
export function setupTagChips(): void {
	const tagsInput = document.getElementById('tagsInput') as HTMLInputElement | HTMLTextAreaElement | null;
	if (!tagsInput) return;
	const chips = document.querySelectorAll<HTMLButtonElement>('.tag-chip');

	function currentTags(): string[] {
		return tagsInput!.value
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	function refreshChipStates(): void {
		const current = new Set(currentTags());
		chips.forEach((chip) => {
			const tag = chip.dataset.tag;
			chip.classList.toggle('selected', !!tag && current.has(tag));
		});
	}

	chips.forEach((chip) => {
		chip.addEventListener('click', () => {
			const tag = chip.dataset.tag;
			if (!tag) return;
			const current = currentTags();
			const index = current.indexOf(tag);
			if (index === -1) {
				current.push(tag);
			} else {
				current.splice(index, 1);
			}
			tagsInput.value = current.join(', ');
			refreshChipStates();
		});
	});

	tagsInput.addEventListener('input', refreshChipStates);
	refreshChipStates();
}
