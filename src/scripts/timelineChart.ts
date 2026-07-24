interface TimelinePiece {
	id: string;
	title: string;
	date: string;
	imageUrl: string;
	placeName: string;
	extra: number;
}

interface TimelineMonth {
	label: string;
	pieces: TimelinePiece[];
}

/** Two-level activity bar chart (built server-side in index.astro): year bars by default, drill
 * into a year to see its (at most 12) month bars — bounded at both levels so bars stay comfortably
 * tappable no matter how many years of pieces pile up, unlike one flat row of every month ever.
 * Clicking a month bar picks it and shows its pieces in the gallery frame below; prev/next page
 * through that month when it has more than one. The bars themselves are the "what have I been
 * doing" visual — this script only handles selection/drill-down, not any drawing. */
export function setupTimelineChart(): void {
	const dataEl = document.getElementById('timeline-data');
	const yearsSection = document.getElementById('timeline-years');
	const monthsSection = document.getElementById('timeline-months');
	const yearLabel = document.getElementById('timeline-year-label');
	const backBtn = document.getElementById('timeline-back');
	const img = document.getElementById('timeline-image') as HTMLImageElement | null;
	const link = document.getElementById('timeline-piece-link') as HTMLAnchorElement | null;
	const captionLink = document.getElementById('timeline-caption') as HTMLAnchorElement | null;
	const monthLabel = document.getElementById('timeline-month');
	const title = document.getElementById('timeline-title');
	const hint = document.getElementById('timeline-hint');
	const prevBtn = document.getElementById('timeline-prev') as HTMLButtonElement | null;
	const nextBtn = document.getElementById('timeline-next') as HTMLButtonElement | null;
	if (
		!dataEl ||
		!yearsSection ||
		!monthsSection ||
		!yearLabel ||
		!backBtn ||
		!img ||
		!link ||
		!captionLink ||
		!monthLabel ||
		!title ||
		!hint ||
		!prevBtn ||
		!nextBtn
	) {
		return;
	}

	const byMonth: Record<string, TimelineMonth> = JSON.parse(dataEl.textContent || '{}');
	const yearBars = [...yearsSection.querySelectorAll<HTMLButtonElement>('.timeline-bar')];
	const monthGroups = [...monthsSection.querySelectorAll<HTMLElement>('.timeline-month-group')];
	const monthBars = [...monthsSection.querySelectorAll<HTMLButtonElement>('.timeline-bar:not(:disabled)')];
	if (monthBars.length === 0) return;

	let month = monthBars[monthBars.length - 1].dataset.month!; // open on the most recent non-empty month
	let pieceIndex = 0;

	function showYear(year: string) {
		for (const group of monthGroups) group.classList.toggle('timeline-hidden', group.dataset.year !== year);
		for (const bar of yearBars) bar.classList.toggle('selected', bar.dataset.year === year);
		yearLabel!.textContent = year;
		yearsSection!.classList.add('timeline-hidden');
		monthsSection!.classList.remove('timeline-hidden');
	}

	function render() {
		const bucket = byMonth[month];
		if (!bucket || bucket.pieces.length === 0) return;
		pieceIndex = Math.max(0, Math.min(pieceIndex, bucket.pieces.length - 1));
		const piece = bucket.pieces[pieceIndex];

		img!.src = piece.imageUrl;
		img!.alt = piece.title;
		link!.href = `/piece/${piece.id}`;
		captionLink!.href = `/piece/${piece.id}`;
		const count = bucket.pieces.length;
		// Month + position is the timeline's temporal context; the piece caption below matches the
		// home-page carousels (title — date, then a location/more-photos/explore hint).
		monthLabel!.textContent =
			count > 1 ? `${bucket.label} · ${pieceIndex + 1} of ${count}` : bucket.label;
		title!.textContent = `${piece.title} — ${piece.date}`;
		hint!.textContent =
			`${piece.placeName}${piece.extra > 0 ? ` · ${piece.extra} more photo${piece.extra > 1 ? 's' : ''}` : ''} · click to explore →`;

		prevBtn!.hidden = count <= 1;
		nextBtn!.hidden = count <= 1;

		for (const bar of monthBars) bar.classList.toggle('selected', bar.dataset.month === month);
	}

	for (const bar of yearBars) {
		if (bar.disabled) continue;
		bar.addEventListener('click', () => showYear(bar.dataset.year!));
	}
	backBtn.addEventListener('click', () => {
		monthsSection!.classList.add('timeline-hidden');
		yearsSection!.classList.remove('timeline-hidden');
	});
	for (const bar of monthBars) {
		bar.addEventListener('click', () => {
			month = bar.dataset.month!;
			pieceIndex = 0;
			render();
		});
	}
	prevBtn.addEventListener('click', () => {
		const count = byMonth[month]?.pieces.length ?? 0;
		if (count === 0) return;
		pieceIndex = (pieceIndex - 1 + count) % count;
		render();
	});
	nextBtn.addEventListener('click', () => {
		const count = byMonth[month]?.pieces.length ?? 0;
		if (count === 0) return;
		pieceIndex = (pieceIndex + 1) % count;
		render();
	});

	render();
	// Land on the years view (per the design), but mark the year containing the initially-selected
	// (most recent) month as selected, so it's clear at a glance which year that piece is from —
	// without actually drilling in and hiding the year row.
	const initialYear = month.slice(0, 4);
	for (const bar of yearBars) bar.classList.toggle('selected', bar.dataset.year === initialYear);
}
