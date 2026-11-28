/** Abbreviated "P" header label; screen readers still announce "Partition". */
export function PartitionLabel() {
  return (
    <>
      <span aria-hidden title="Partition">
        P
      </span>
      <span className="sr-only">Partition</span>
    </>
  );
}
