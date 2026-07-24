interface TimelinePiece {
	id: string;
	title: string;
	date: string;
	imageUrl: string;
	placeName: string;
	extra: number;
}

interface TimelineBucket {
	label: string;
	pieces: TimelinePiece[];
}

interface TimelineData {
	months: Record<string, TimelineBucket>;
	years: Record<string, TimelineBucket>;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'];

/** Two-level activity bar chart (built server-side in index.astro): year bars by default, drill
 * into a year to see its (at most 12) month bars — bounded at both levels so bars stay comfortably
 * tappable no matter how many years of pieces pile up, unlike one flat row of every month ever.
 * Clicking a year browses every piece that year in the gallery frame below; clicking one of its
 * month bars narrows that down to just that month. A breadcrumb ("All years › 2013 › May") tracks
 * the current depth — "All years" and the year are clickable jumps back up, same as a directory
 * path. prev/next page through whichever set is current — month or year — stopping at both ends
 * rather than wrapping around. The bars themselves are the "what have I been doing" visual — this
 * script only handles selection/drill-down, not any drawing. */
export function setupTimelineChart(): void {
	const dataEl = document.getElementById('timeline-data');
	const yearsSection = document.getElementById('timeline-years');
	const monthsSection = document.getElementById('timeline-months');
	const crumbYearsBtn = document.getElementById('timeline-crumb-years');
	const crumbYearWrap = document.getElementById('timeline-crumb-year-wrap');
	const crumbYearBtn = document.getElementById('timeline-crumb-year');
	const crumbMonthWrap = document.getElementById('timeline-crumb-month-wrap');
	const crumbMonthText = document.getElementById('timeline-crumb-month');
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
		!crumbYearsBtn ||
		!crumbYearWrap ||
		!crumbYearBtn ||
		!crumbMonthWrap ||
		!crumbMonthText ||
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

	const { months: byMonth, years: byYear }: TimelineData = JSON.parse(dataEl.textContent || '{"months":{},"years":{}}');
	const yearBars = [...yearsSection.querySelectorAll<HTMLButtonElement>('.timeline-bar')];
	const monthGroups = [...monthsSection.querySelectorAll<HTMLElement>('.timeline-month-group')];
	const monthBars = [...monthsSection.querySelectorAll<HTMLButtonElement>('.timeline-bar:not(:disabled)')];
	if (monthBars.length === 0) return;

	let bucket: TimelineBucket = byMonth[monthBars[monthBars.length - 1].dataset.month!]; // open on the most recent non-empty month
	let selectedMonth = monthBars[monthBars.length - 1].dataset.month!;
	let currentYear = selectedMonth.slice(0, 4);
	// Buckets are oldest-first (see index.astro), so the most recent piece — the one the page
	// should actually land on — is the *last* index, not the first.
	let pieceIndex = bucket.pieces.length - 1;

	// Browse every piece in a year — deselects whichever month was picked, if any. This is also
	// what clicking the year crumb (while already drilled into one of its months) does: "go back
	// up" from a specific month to the whole year, without leaving the drilled-in month-bars view.
	function browseYear(year: string) {
		currentYear = year;
		selectedMonth = '';
		for (const bar of monthBars) bar.classList.remove('selected');
		for (const bar of yearBars) bar.classList.toggle('selected', bar.dataset.year === year);
		crumbYearWrap!.classList.remove('timeline-hidden');
		crumbYearBtn!.textContent = year;
		crumbMonthWrap!.classList.add('timeline-hidden');
		setBucket(byYear[year]);
	}

	function showYear(year: string) {
		for (const group of monthGroups) group.classList.toggle('timeline-hidden', group.dataset.year !== year);
		yearsSection!.classList.add('timeline-hidden');
		monthsSection!.classList.remove('timeline-hidden');
		browseYear(year);
	}

	function showYears() {
		monthsSection!.classList.add('timeline-hidden');
		yearsSection!.classList.remove('timeline-hidden');
		crumbYearWrap!.classList.add('timeline-hidden');
		crumbMonthWrap!.classList.add('timeline-hidden');
	}

	function setBucket(next: TimelineBucket | undefined) {
		if (!next || next.pieces.length === 0) return;
		bucket = next;
		pieceIndex = 0;
		render();
	}

	function render() {
		if (!bucket || bucket.pieces.length === 0) return;
		const count = bucket.pieces.length;
		pieceIndex = Math.max(0, Math.min(pieceIndex, count - 1));
		const piece = bucket.pieces[pieceIndex];

		img!.src = piece.imageUrl;
		img!.alt = piece.title;
		link!.href = `/piece/${piece.id}`;
		captionLink!.href = `/piece/${piece.id}`;
		// Month/year + position is the timeline's temporal context; the piece caption below matches
		// the home-page carousels (title — date, then a location/more-photos/explore hint).
		monthLabel!.textContent = count > 1 ? `${bucket.label} · ${pieceIndex + 1} of ${count}` : bucket.label;
		title!.textContent = `${piece.title} — ${piece.date}`;
		hint!.textContent =
			`${piece.placeName}${piece.extra > 0 ? ` · ${piece.extra} more photo${piece.extra > 1 ? 's' : ''}` : ''} · click to explore →`;

		prevBtn!.hidden = count <= 1;
		nextBtn!.hidden = count <= 1;
		prevBtn!.disabled = pieceIndex === 0;
		nextBtn!.disabled = pieceIndex === count - 1;

		for (const bar of monthBars) bar.classList.toggle('selected', bar.dataset.month === selectedMonth);
	}

	for (const bar of yearBars) {
		if (bar.disabled) continue;
		bar.addEventListener('click', () => showYear(bar.dataset.year!));
	}
	crumbYearsBtn.addEventListener('click', showYears);
	crumbYearBtn.addEventListener('click', () => browseYear(currentYear));
	for (const bar of monthBars) {
		bar.addEventListener('click', () => {
			selectedMonth = bar.dataset.month!;
			crumbMonthWrap!.classList.remove('timeline-hidden');
			crumbMonthText!.textContent = MONTH_NAMES[Number(selectedMonth.slice(5, 7)) - 1];
			setBucket(byMonth[selectedMonth]);
		});
	}
	prevBtn.addEventListener('click', () => {
		if (pieceIndex === 0) return;
		pieceIndex -= 1;
		render();
	});
	nextBtn.addEventListener('click', () => {
		if (pieceIndex >= bucket.pieces.length - 1) return;
		pieceIndex += 1;
		render();
	});

	render();
	// Land on the years view with an empty breadcrumb (per the design — it only grows as you
	// actually navigate deeper), but mark the year containing the initially-selected (most recent)
	// month as selected on the year bars themselves, so it's clear at a glance which year that
	// piece is from without the breadcrumb claiming you're already drilled in.
	for (const bar of yearBars) bar.classList.toggle('selected', bar.dataset.year === currentYear);
}
