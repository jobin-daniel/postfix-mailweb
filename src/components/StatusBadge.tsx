import type { DeliveryStatus, OverallMessageStatus } from "@/lib/postfix/types";

type AnyStatus = OverallMessageStatus | DeliveryStatus;

const STATUS_STYLES: Record<AnyStatus, { label: string; classes: string }> = {
  delivered: {
    label: "Delivered",
    classes:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  sent: {
    label: "Sent",
    classes:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  deferred: {
    label: "Deferred",
    classes:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  bounced: {
    label: "Bounced",
    classes:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
  },
  expired: {
    label: "Expired",
    classes:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
  },
  "in-queue": {
    label: "In Queue",
    classes:
      "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
  },
  rejected: {
    label: "Rejected",
    classes:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
  },
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  const cfg = STATUS_STYLES[status] ?? {
    label: status,
    classes:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}
