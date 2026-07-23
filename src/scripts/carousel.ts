/** Left/right paging for the home page's image carousels (Carousel.astro). Each `.carousel` is a
 * scroll-snap track showing one piece at a time; the arrows just scroll it by one slide. Native
 * horizontal swipe works too, for free — this only wires the buttons. */
export function setupCarousels(): void {
	document.querySelectorAll<HTMLElement>('.carousel').forEach((carousel) => {
		const track = carousel.querySelector<HTMLElement>('.carousel-track');
		const prev = carousel.querySelector<HTMLButtonElement>('.carousel-prev');
		const next = carousel.querySelector<HTMLButtonElement>('.carousel-next');
		if (!track || !prev || !next) return;
		prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }));
		next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }));
	});
}
