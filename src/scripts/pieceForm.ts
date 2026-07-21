import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

export interface PieceFormOptions {
	initialLat?: number;
	initialLng?: number;
	/** Fire geolocation automatically on load — only appropriate for a brand-new piece with no
	 * location set yet, not when editing something that already has one. */
	autoUseCurrentLocation?: boolean;
}

/** Wires up the location map, tag-frequency chips, asset previews, and filename-derived title
 * suggestion shared by the new-piece and edit-piece admin forms. */
export function setupPieceForm(options: PieceFormOptions = {}): void {
	setupLocationPicker(options);
	setupAssetPreviews();
	setupTitleSuggestion();
	setupTagChips();
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

	function setLocation(lat: number, lng: number) {
		latInput!.value = lat.toFixed(6);
		lngInput!.value = lng.toFixed(6);
		locationReadout!.textContent = `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
		if (marker) {
			marker.setLatLng([lat, lng]);
		} else {
			marker = L.marker([lat, lng]).addTo(map);
		}
		map.setView([lat, lng], 13);

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

	map.on('click', (e) => setLocation(e.latlng.lat, e.latlng.lng));

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
			preview.src = URL.createObjectURL(file);
			preview.style.display = 'block';
		});
	});
}

function setupTitleSuggestion(): void {
	const finalInput = document.getElementById('finalImageInput') as HTMLInputElement | null;
	const titleInput = document.getElementById('titleInput') as HTMLInputElement | null;
	if (!finalInput || !titleInput) return;

	finalInput.addEventListener('change', () => {
		const file = finalInput.files?.[0];
		// Only ever fills an empty title — never overwrites something already typed/set.
		if (file && !titleInput.value.trim()) {
			titleInput.value = suggestTitleFromFilename(file.name);
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

function setupTagChips(): void {
	const tagsInput = document.getElementById('tagsInput') as HTMLInputElement | null;
	if (!tagsInput) return;
	document.querySelectorAll<HTMLButtonElement>('.tag-chip').forEach((chip) => {
		chip.addEventListener('click', () => {
			const tag = chip.dataset.tag;
			if (!tag) return;
			const current = tagsInput.value
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			if (!current.includes(tag)) {
				current.push(tag);
				tagsInput.value = current.join(', ');
			}
		});
	});
}
