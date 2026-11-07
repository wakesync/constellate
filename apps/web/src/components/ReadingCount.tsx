// The one place the "N readings cast" copy lives. When credits arrive, this
// becomes "N readings cast · M credits left" here and everywhere at once.
// Used in the manuscript header, the readings drawer, and the pair card.

export function readingCountCopy(total: number): string {
  return `${total} reading${total === 1 ? "" : "s"} cast`;
}

export function ReadingCount({ total, dark = false }: { total: number; dark?: boolean }) {
  return (
    <span
      className="micro lowercase"
      style={{ color: dark ? "#a08c5c" : "var(--gold-deep)", letterSpacing: "0.08em" }}
    >
      {readingCountCopy(total)}
    </span>
  );
}
