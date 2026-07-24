import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fixLeafletDefaultIcon } from './leafletIcons';

fixLeafletDefaultIcon();

interface NearbyPoint {
	id: string;
	title: string;
	lat: number;
	lng: number;
	thumb: string;
	miles: number;
}

interface NearbyData {
	current: { title: string; lat: number; lng: number };
	nearby: NearbyPoint[];
}

/** Escapes untrusted text for safe interpolation into innerHTML — this data ultimately comes
 * from the site owner's own admin form, but popups are built via innerHTML, so this is cheap
 * insurance rather than trusting that unconditionally. */
function escapeHtml(s: string): string {
	const div = document.createElement('div');
	div.textContent = s;
	return div.innerHTML;
}

/** Small per-piece map: a highlighted marker for this piece plus pins for whatever other pieces
 * were painted nearby, each linking straight to its own page — a simple "explore in space" from
 * wherever you're currently looking. */
export function setupNearbyMap(): void {
	const dataEl = document.getElementById('nearby-data');
	const mapEl = document.getElementById('nearby-map');
	if (!dataEl || !mapEl) return;

	const { current, nearby }: NearbyData = JSON.parse(dataEl.textContent || '{}');
	if (!current) return;

	const map = L.map(mapEl);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors',
		maxZoom: 19
	}).addTo(map);

	// A colored circle marker, not the default pin, so this piece's own location reads as visually
	// distinct from the nearby pins around it at a glance.
	const pink = getComputedStyle(document.documentElement).getPropertyValue('--pink').trim() || '#ff3d8f';
	L.circleMarker([current.lat, current.lng], { radius: 10, color: pink, fillColor: pink, fillOpacity: 1 })
		.addTo(map)
		.bindPopup(`<strong>${escapeHtml(current.title)}</strong> — this piece`);

	const bounds = L.latLngBounds([[current.lat, current.lng]]);

	for (const p of nearby) {
		const marker = L.marker([p.lat, p.lng]).addTo(map);
		const milesLabel = p.miles < 1 ? '< 1 mi away' : `${Math.round(p.miles)} mi away`;
		marker.bindPopup(
			`<a href="/piece/${encodeURIComponent(p.id)}">` +
				`<strong>${escapeHtml(p.title)}</strong><br />` +
				`<img src="${p.thumb}" alt="${escapeHtml(p.title)}" style="width:120px; height:auto; margin-top:0.25rem;" />` +
				`</a><br />${milesLabel}`
		);
		marker.on('mouseover', () => marker.openPopup());
		// The popup's own link handles a click there, but the marker (pin) itself should be a
		// shortcut straight to the piece too — no reason clicking the pin should only pop up a
		// popup you then have to click again.
		marker.on('click', () => {
			window.location.href = `/piece/${encodeURIComponent(p.id)}`;
		});
		bounds.extend([p.lat, p.lng]);
	}

	if (nearby.length > 0) {
		map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
	} else {
		map.setView([current.lat, current.lng], 11);
	}
}
