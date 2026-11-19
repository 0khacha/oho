import { STATS_KEY, ext, getSettings, isAllowed, lastKey, tabKey, type How, type Last, type Msg, type Stats } from './shared/ext';

// Serialise counter updates so concurrent frames never lose an increment.
let queue: Promise<unknown> = Promise.resolve();

async function bump(tabId: number | undefined, id: string, how: How): Promise<void> {
  if (how === 'wall') {
    // Left alone on purpose: remember it for the popup, but it is not a handled banner.
    if (tabId !== undefined && tabId >= 0) await ext.storage.session.set({ [lastKey(tabId)]: { id, how, t: Date.now() } satisfies Last });
    return;
  }
  const r = await ext.storage.local.get(STATS_KEY);
  const stats: Stats = { total: 0, ...(r[STATS_KEY] as Stats | undefined) };
  stats.total++;
  await ext.storage.local.set({ [STATS_KEY]: stats });
  if (tabId === undefined || tabId < 0) return;
  const k = tabKey(tabId);
  const t = await ext.storage.session.get(k);
  // Last outcome per tab (extension-private; used by the popup-less live test harness).
  await ext.storage.session.set({ [k]: ((t[k] as number | undefined) ?? 0) + 1, [lastKey(tabId)]: { id, how, t: Date.now() } });
}

ext.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  if (msg?.type === 'oho_done') {
    queue = queue.then(() => bump(sender.tab?.id, msg.id, msg.how)).catch(() => {});
    return false;
  }
  if (msg?.type === 'oho_last') {
    const id = sender.tab?.id;
    if (id === undefined) return false;
    // Wait for queued updates so a frame's report that just arrived is visible.
    queue.then(() => ext.storage.session.get(lastKey(id))).then((r) => reply(r[lastKey(id)] ?? null), () => reply(null));
    return true;
  }
  if (msg?.type === 'oho_check') {
    const url = sender.tab?.url;
    getSettings().then((s) => {
      let host = '';
      try {
        host = url ? new URL(url).hostname : '';
      } catch {
        /* ignore */
      }
      reply(isAllowed(s, host));
    });
    return true; // async reply
  }
  return false;
});

ext.tabs.onRemoved.addListener((tabId) => {
  void ext.storage.session.remove([tabKey(tabId), lastKey(tabId)]);
});
