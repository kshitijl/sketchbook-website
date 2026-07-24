import L from 'leaflet';
// `?url` matters specifically because without it, Astro's own asset pipeline intercepts the
// .png import into an `{src,width,height}` object instead of a plain URL string, which is what
// iconUrl actually needs.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerIcon from 'leaflet/dist/images/marker-icon.png?url';
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url';

/** Leaflet's default marker icon resolves its image URLs relative to its own CSS file at
 * runtime, which breaks once bundled by Vite (shows up as a broken-image box with cut-off alt
 * text instead of a pin) — point it at the bundler-resolved asset URLs instead. Call once per
 * script entry point that places a default (non-custom) Leaflet marker. */
export function fixLeafletDefaultIcon(): void {
	delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
	L.Icon.Default.mergeOptions({
		iconRetinaUrl: markerIcon2x,
		iconUrl: markerIcon,
		shadowUrl: markerShadow
	});
}
