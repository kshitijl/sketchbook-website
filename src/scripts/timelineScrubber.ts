interface TimelinePiece {
	id: string;
	title: string;
	date: string;
	imageUrl: string;
}

interface TimelineMonth {
	month: string;
	pieces: TimelinePiece[];
}

/** Range scrubber (one step per month, not per piece — "not tryna do fine dextrous movement")
 * with a small gallery frame below it. Moving the slider jumps to a month; prev/next arrows page
 * through that month's pieces when there's more than one, since a slider alone can't cleanly pick
 * a specific piece within a month. */
export function setupTimelineScrubber(): void {
	const dataEl = document.getElementById('timeline-data');
	const range = document.getElementById('timeline-range') as HTMLInputElement | null;
	const img = document.getElementById('timeline-image') as HTMLImageElement | null;
	const link = document.getElementById('timeline-piece-link') as HTMLAnchorElement | null;
	const caption = document.getElementById('timeline-caption');
	const prevBtn = document.getElementById('timeline-prev') as HTMLButtonElement | null;
	const nextBtn = document.getElementById('timeline-next') as HTMLButtonElement | null;
	if (!dataEl || !range || !img || !link || !caption || !prevBtn || !nextBtn) return;

	const months: TimelineMonth[] = JSON.parse(dataEl.textContent || '[]');
	if (months.length === 0) return;

	let pieceIndex = 0;

	function render() {
		const bucket = months[Number(range!.value)];
		if (!bucket || bucket.pieces.length === 0) return;
		pieceIndex = Math.max(0, Math.min(pieceIndex, bucket.pieces.length - 1));
		const piece = bucket.pieces[pieceIndex];

		img!.src = piece.imageUrl;
		img!.alt = piece.title;
		link!.href = `/piece/${piece.id}`;
		caption!.textContent =
			bucket.pieces.length > 1
				? `${piece.title} — ${piece.date} (${pieceIndex + 1} of ${bucket.pieces.length} that month)`
				: `${piece.title} — ${piece.date}`;

		const hasMultiple = bucket.pieces.length > 1;
		prevBtn!.hidden = !hasMultiple;
		nextBtn!.hidden = !hasMultiple;
	}

	range.addEventListener('input', () => {
		pieceIndex = 0;
		render();
	});
	prevBtn.addEventListener('click', () => {
		const bucket = months[Number(range.value)];
		if (!bucket) return;
		pieceIndex = (pieceIndex - 1 + bucket.pieces.length) % bucket.pieces.length;
		render();
	});
	nextBtn.addEventListener('click', () => {
		const bucket = months[Number(range.value)];
		if (!bucket) return;
		pieceIndex = (pieceIndex + 1) % bucket.pieces.length;
		render();
	});

	render();
}
