import type {
  CapacityType,
  PostCategory,
  PostScope,
  PostType,
  TransportMode,
} from "@/lib/types";

/** Soft mirror: content alignment hint (cards stay full-width in the feed) */
export const POST_TYPE_ALIGN: Record<PostType, "left" | "right"> = {
  demand: "left",
  provider: "right",
};

export const POST_CATEGORIES: readonly PostCategory[] = [
  "deliver",
  "buy",
  "onsite",
  "errand",
  "travel",
] as const;

export const POST_SCOPES: readonly PostScope[] = [
  "near",
  "city",
  "intercity",
  "cross_border",
] as const;

export const CAPACITY_TYPES: readonly CapacityType[] = [
  "backpack",
  "suitcase",
  "trunk",
] as const;

export const TRANSPORT_MODES: readonly TransportMode[] = [
  "walking",
  "scooter",
  "bicycle",
  "motorbike",
  "subway",
  "bus",
  "train",
  "flight",
  "car",
  "van",
] as const;

export const CAPACITY_EMOJI: Record<CapacityType, string> = {
  backpack: "🎒",
  suitcase: "🧳",
  trunk: "🚗",
};

/** Inner content alignment only — cards themselves stay full width */
export function postCardAlignClass(postType: PostType): string {
  return postType === "demand" ? "text-left" : "text-right";
}

export function postCardShellClass(postType: PostType): string {
  return postType === "demand"
    ? "w-full rounded-xl border border-emerald-200/70 border-l-[3px] border-l-emerald-500 bg-emerald-50/40"
    : "w-full rounded-xl border border-violet-200/70 border-r-[3px] border-r-violet-500 bg-violet-50/40";
}

export function postTypeTagClass(postType: PostType): string {
  return postType === "demand"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-violet-100 text-violet-800";
}

export function postMetaRowClass(postType: PostType): string {
  return postType === "demand"
    ? "flex flex-wrap items-center gap-1.5"
    : "flex flex-wrap items-center justify-end gap-1.5";
}
