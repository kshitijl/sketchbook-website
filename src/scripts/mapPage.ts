import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// leaflet.markercluster ships its own CSS (dist/MarkerCluster.css, dist/MarkerCluster.Default.css)
// that's normally imported the same way as leaflet's own — but doing that here silently produced
// no output (confirmed the import path itself does resolve correctly: pointing it at a
// deliberately wrong filename correctly errors the build, so this isn't a typo — the real files'
// content just never made it into any emitted CSS chunk, seemingly a bundler quirk). Inlined
// directly into Base.astro's global stylesheet instead — see the comment there.
import 'leaflet.markercluster';
// Leaflet's default marker icon resolves its image URLs relative to its own CSS file at runtime,
// which breaks once bundled by Vite — the icon's <img> 404s, which is what showed up live as a
// broken-image box with cut-off alt text instead of an actual pin. Pointing it at the
// bundler-resolved asset URLs directly is the standard fix for Leaflet under Vite/Rollup.
//
// The `?url` suffix matters, and was the actual remaining bug after the first attempt at this
// fix: without it, Astro's built-in asset pipeline intercepts every image import project-wide
// (even in a plain .ts file, not just .astro components) and hands back an
// `{ src, width, height, format }` metadata object instead of a plain string — `iconUrl` needs a
// string, and Leaflet has no idea to unwrap `.src` from something built for Astro's own <Image>.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerIcon from 'leaflet/dist/images/marker-icon.png?url';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url';
import { imageUrl } from '../lib/images';
import { getPrimaryAsset, orderAssetsFinalFirst } from '../lib/facets';
import type { Piece } from '../lib/types';

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
	iconRetinaUrl: markerIcon2x,
	iconUrl: markerIcon,
	shadowUrl: markerShadow
});

/** Escapes untrusted text for safe interpolation into innerHTML — this data ultimately comes
 * from the site owner's own admin form, but the click-to-detail panel is built via innerHTML, so
 * this is cheap insurance rather than trusting that unconditionally. */
function escapeHtml(s: string): string {
	const div = document.createElement('div');
	div.textContent = s;
	return div.innerHTML;
}

function renderDetail(piece: Piece): string {
	const ordered = orderAssetsFinalFirst(piece.assets);
	const imagesHtml = ordered
		.map((asset) => {
			const dims = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
			return `<figure style="margin:0 0 1rem 0;"><img src="${imageUrl(asset.r2Key, 'big')}" alt="${escapeHtml(piece.title)}"${dims} style="max-width:100%; max-height:85vh; width:auto; height:auto;" /><figcaption>${escapeHtml(asset.kind)}</figcaption></figure>`;
		})
		.join('');
	const tagsHtml = piece.tags.map((t) => `<a href="/tag/${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join(' ');

	return `
		<article>
			<h2><a href="/piece/${encodeURIComponent(piece.id)}">${escapeHtml(piece.title)}</a></h2>
			<p>${escapeHtml(piece.date)} &middot; ${escapeHtml(piece.stage)} &middot; ${escapeHtml(piece.location.placeName)}</p>
			<p>${tagsHtml}</p>
			${imagesHtml}
			${piece.notes ? `<p>${escapeHtml(piece.notes)}</p>` : ''}
		</article>
	`;
}

export function setupMap(): void {
	const dataEl = document.getElementById('pieces-data');
	const mapEl = document.getElementById('map');
	const detailEl = document.getElementById('piece-detail');
	if (!dataEl || !mapEl || !detailEl) return;

	const pieces: Piece[] = JSON.parse(dataEl.textContent || '[]');

	// Starts zoomed out on the whole world, not auto-fit to wherever the pieces happen to be —
	// the point of opening the map is seeing the globe, then zooming into a pin yourself.
	const map = L.map(mapEl).setView([20, 0], 2);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors',
		maxZoom: 19
	}).addTo(map);

	// Real, zoom-dependent clustering — two pieces on opposite sides of a city are only a few
	// pixels apart at world zoom (should merge into one badge) but hundreds of pixels apart once
	// zoomed into that city (should split back into individual pins). That can only be computed
	// live off the map's current zoom/pixel geometry, not from a fixed grouping key on the data
	// itself — a rounded-coordinate key and a place-name key were both tried and both wrong for
	// this reason, neither has any notion of "current zoom level." spiderfyOnMaxZoom (the
	// library's default) is what handles pieces sitting at the literal same point once you're
	// zoomed in as far as possible — clicking the cluster fans them out into individually
	// clickable markers instead of needing a custom prev/next UI for that case.
	const clusterGroup = L.markerClusterGroup();

	for (const piece of pieces) {
		const { lat, lng } = piece.location;
		const marker = L.marker([lat, lng]);

		const primary = getPrimaryAsset(piece);
		const popupHtml = primary
			? `<strong>${escapeHtml(piece.title)}</strong><br /><img src="${imageUrl(primary.r2Key, 'thumb')}" alt="${escapeHtml(piece.title)}" style="width:120px; height:auto; margin-top:0.25rem;" />`
			: `<strong>${escapeHtml(piece.title)}</strong>`;
		marker.bindPopup(popupHtml);

		marker.on('mouseover', () => marker.openPopup());
		marker.on('click', () => {
			detailEl.innerHTML = renderDetail(piece);
			detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});

		clusterGroup.addLayer(marker);
	}

	map.addLayer(clusterGroup);
}
