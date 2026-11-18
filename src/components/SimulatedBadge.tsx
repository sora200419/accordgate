/**
 * SECURITY S3: visible marker for any result that did not happen on chain or was not
 * cryptographically proved. `reason` is shown as the tooltip.
 */
export function SimulatedBadge({ reason, label = '模拟' }: { reason: string; label?: string }) {
  return (
    <span
      title={reason}
      aria-label={`${label}：${reason}`}
      className="inline-flex shrink-0 items-center rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-900 whitespace-nowrap dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      {label}
    </span>
  );
}
