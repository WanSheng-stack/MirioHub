import type { Post } from "@/lib/types";

export type CreditStats = {
  totalCompletionRate: number;
  standardRate: number;
  autoMeltRate: number;
  autoMeltNotes: string[];
};

type CompletionRow = Pick<Post, "status" | "completion_type" | "completion_note">;

export function computeCreditStats(rows: CompletionRow[]): CreditStats {
  const finished = rows.filter(
    (r) => r.status === "completed" || r.status === "pending_completion",
  );
  if (finished.length === 0) {
    return {
      totalCompletionRate: 0,
      standardRate: 0,
      autoMeltRate: 0,
      autoMeltNotes: [],
    };
  }

  const standard = finished.filter((r) => r.completion_type === "standard" || !r.completion_type);
  const autoMelt = finished.filter((r) => r.completion_type === "auto_melt");
  const total = finished.length;

  return {
    totalCompletionRate: (finished.filter((r) => r.status === "completed").length / total) * 100,
    standardRate: (standard.length / total) * 100,
    autoMeltRate: (autoMelt.length / total) * 100,
    autoMeltNotes: autoMelt
      .map((r) => r.completion_note)
      .filter((n): n is string => Boolean(n?.trim())),
  };
}
