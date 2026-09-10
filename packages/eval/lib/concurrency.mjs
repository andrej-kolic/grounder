/**
 * Runs `fn` over `items`, at most `limit` in flight at once. Preserves
 * `items` order in the returned array regardless of completion order.
 *
 * A full default sweep crosses up to 11 (host, model) pairs by up to 6
 * probes — 66 unbounded `execFile` calls would share one scratch cwd/vault,
 * race each host CLI's own session files, and likely trip rate limits.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}
