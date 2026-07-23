interface TimelinePiece {
	id: string;
	title: string;
	date: string;
	imageUrl: string;
}

interface TimelineMonth {
	label: string;
	pieces: TimelinePiece[];
}

/** Activity bar chart, one bar per month (built server-side in index.astro). Clicking a bar picks
 * a month and shows its pieces in the gallery frame below; prev/next page through that month when
 * it has more than one. The bars themselves are the "what have I been doing" visual — this script
 * only handles selection, not any drawing. */
export function setupTimelineChart(): void {
	const dataEl = document.getElementById('timeline-data');
	const chart = document.getElementById('timeline-chart');
	const img = document.getElementById('timeline-image') as HTMLImageElement | null;
	const link = document.getElementById('timeline-piece-link') as HTMLAnchorElement | null;
	const monthLabel = document.getElementById('timeline-month');
	const caption = document.getElementById('timeline-caption');
	const prevBtn = document.getElementById('timeline-prev') as HTMLButtonElement | null;
	const nextBtn = document.getElementById('timeline-next') as HTMLButtonElement | null;
	if (!dataEl || !chart || !img || !link || !monthLabel || !caption || !prevBtn || !nextBtn) return;

	const byMonth: Record<string, TimelineMonth> = JSON.parse(dataEl.textContent || '{}');
	const bars = [...chart.querySelectorAll<HTMLButtonElement>('.timeline-bar:not(:disabled)')];
	if (bars.length === 0) return;

	let month = bars[bars.length - 1].dataset.month!; // open on the most recent non-empty month
	let pieceIndex = 0;

	function render() {
		const bucket = byMonth[month];
		if (!bucket || bucket.pieces.length === 0) return;
		pieceIndex = Math.max(0, Math.min(pieceIndex, bucket.pieces.length - 1));
		const piece = bucket.pieces[pieceIndex];

		img!.src = piece.imageUrl;
		img!.alt = piece.title;
		link!.href = `/piece/${piece.id}`;
		const count = bucket.pieces.length;
		monthLabel!.textContent = `${bucket.label} · ${count} ${count === 1 ? 'piece' : 'pieces'}`;
		caption!.textContent =
			count > 1
				? `${piece.title} — ${piece.date} (${pieceIndex + 1} of ${count})`
				: `${piece.title} — ${piece.date}`;

		prevBtn!.hidden = count <= 1;
		nextBtn!.hidden = count <= 1;

		for (const bar of bars) bar.classList.toggle('selected', bar.dataset.month === month);
	}

	for (const bar of bars) {
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
}
