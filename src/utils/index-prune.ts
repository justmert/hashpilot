/**
 * Deciding which chunks a full re-index left behind.
 *
 * Indexing upserts, so a page deleted or renamed upstream keeps its old chunks
 * forever, and a page that shrinks keeps its trailing ones. After a complete
 * run, anything in the collection that the run did not write is stale. Pruning
 * it is also the one step that can destroy the index, so the plan refuses when
 * the numbers look like a failed run rather than normal churn.
 */

export interface PrunePlan {
  /** Chunk ids to delete */
  stale: string[];
  existing: number;
  written: number;
  /** False when deleting would be unsafe; `reason` says why */
  safe: boolean;
  reason?: string;
}

/** Largest share of the collection one run may delete */
export const MAX_PRUNE_FRACTION = 0.15;

export function planPrune(
  existingIds: string[],
  writtenIds: Set<string>,
  maxFraction: number = MAX_PRUNE_FRACTION
): PrunePlan {
  const stale = existingIds.filter((id) => !writtenIds.has(id));
  const plan = { stale, existing: existingIds.length, written: writtenIds.size };

  if (writtenIds.size === 0) {
    return { ...plan, safe: false, reason: 'the run wrote no chunks' };
  }
  if (existingIds.length > 0 && stale.length / existingIds.length > maxFraction) {
    const percent = ((stale.length / existingIds.length) * 100).toFixed(1);
    return {
      ...plan,
      safe: false,
      reason:
        `${stale.length} of ${existingIds.length} chunks (${percent}%) would be deleted, ` +
        `above the ${maxFraction * 100}% limit; this looks like a failed source, not churn`,
    };
  }
  return { ...plan, safe: true };
}

/** Parse a manifest written during a run into the ids for one collection */
export function readManifest(text: string, collection: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0 && line.slice(0, tab) === collection) ids.add(line.slice(tab + 1));
  }
  return ids;
}
