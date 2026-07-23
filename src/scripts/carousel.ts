/** Left/right paging for the home page's image carousels (Carousel.astro). Each `.carousel` is a
 * scroll-snap track showing one piece at a time; the arrows scroll it by one slide, and are dimmed
 * out at the start/end so it's clear there's nothing further that way. Native horizontal swipe works
 * too, for free — this only wires the buttons and the end state. */
export function setupCarousels(): void {
	document.querySelectorAll<HTMLElement>('.carousel').forEach((carousel) => {
		const track = carousel.querySelector<HTMLElement>('.carousel-track');
		const prev = carousel.querySelector<HTMLButtonElement>('.carousel-prev');
		const next = carousel.querySelector<HTMLButtonElement>('.carousel-next');
		if (!track || !prev || !next) return;

		const updateEnds = () => {
			prev.disabled = track.scrollLeft <= 1;
			next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
		};

		prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }));
		next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }));
		track.addEventListener('scroll', updateEnds, { passive: true });
		window.addEventListener('resize', updateEnds);
		updateEnds();
	});
}
