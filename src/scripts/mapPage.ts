import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { imageUrl } from '../lib/images';
import { getPrimaryAsset, orderAssetsFinalFirst } from '../lib/facets';
import type { Piece } from '../lib/types';

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
			return `<figure style="margin:0 0 1rem 0;"><img src="${imageUrl(asset.r2Key)}" alt="${escapeHtml(piece.title)}"${dims} style="max-width:100%; height:auto;" /><figcaption>${escapeHtml(asset.kind)}</figcaption></figure>`;
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

	const map = L.map(mapEl).setView([20, 0], 2);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors',
		maxZoom: 19
	}).addTo(map);

	const bounds: L.LatLngTuple[] = [];

	for (const piece of pieces) {
		const { lat, lng } = piece.location;
		bounds.push([lat, lng]);
		const marker = L.marker([lat, lng]).addTo(map);

		const primary = getPrimaryAsset(piece);
		const popupHtml = primary
			? `<strong>${escapeHtml(piece.title)}</strong><br /><img src="${imageUrl(primary.r2Key)}" alt="${escapeHtml(piece.title)}" style="width:120px; height:auto; margin-top:0.25rem;" />`
			: `<strong>${escapeHtml(piece.title)}</strong>`;
		marker.bindPopup(popupHtml);

		marker.on('mouseover', () => marker.openPopup());
		marker.on('click', () => {
			detailEl.innerHTML = renderDetail(piece);
			detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
		});
	}

	if (bounds.length > 0) {
		map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
	}
}
