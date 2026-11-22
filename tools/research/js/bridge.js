/* Research Hub — bridge client. When the hub is opened through scripts/hub_bridge.py, it sends the hub's
   data to the agents as you work (research/hub-export.json) and takes in the files they write
   (research/hub-import-<agent>.json). Opened any other way, it does nothing. */
'use strict';
(function (RH) {
const { $, h, toast } = RH;
const LABEL = { docs: 'sources', nodes: 'map nodes', links: 'map links', trails: 'trails', steps: 'trail steps', data: 'data points', etym: 'etymology' };
const B = RH.bridge = { on: false, lost: false, why: new Set(), timer: null, pushing: false, delivering: false, sent: null, got: null };

async function api(path, body) {
  const r = await fetch('/bridge/' + path, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: { 'X-Hub-Bridge': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/* hub → agents: send after a short pause in your work */
B.schedule = why => { if (why) B.why.add(why); clearTimeout(B.timer); B.timer = setTimeout(() => B.push(), 3000); };
B.push = async function (why) {
  if (why) B.why.add(why);
  if (!B.on || B.lost) return;
  if (B.pushing) { B.schedule(); return; }
  B.pushing = true; const reasons = [...B.why]; B.why.clear();
  try { await api('export', { export: RH.exportHub(), why: reasons.join(', ') }); B.sent = new Date(); }
  catch (e) { reasons.forEach(r => B.why.add(r)); console.warn('bridge: send failed', e); }
  finally { B.pushing = false; paint(); }
};

/* agents → hub: take in finished agent files */
const said = m => Object.entries(m || {}).map(([k, v]) => `${v.new + v.updated} ${LABEL[k] || k}`).join(', ') || 'nothing new';
async function takeIn(file) {
  let c; try { c = await api('claim', { file }); } catch (e) { return; }
  B.receiving = c.agent;
  try {
    const merged = await RH.importHub(c.content, { quiet: true });
    await api('ack', { file, token: c.token, result: 'delivered', merged });
    B.got = new Date(); toast(`🌉 From ${c.agent}: ${said(merged)}`); refreshView();
  } catch (e) {
    await api('ack', { file, token: c.token, result: 'failed', error: e.message }).catch(() => { });
    toast(`🌉 Could not take in ${file}: ${e.message}`, 6000);
  } finally { B.receiving = null; }
}
function refreshView() {
  if (!['map', 'trails', 'archive', 'data'].includes(RH.route?.view)) return;
  const a = document.activeElement;
  if (document.querySelector('.modal-bg') || a?.isContentEditable || (a?.closest('#view') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  RH.rerender();
}
async function poll() {
  clearTimeout(B.pollTimer);
  if (!document.hidden) {
    try {
      const s = await api('status'); const wasLost = B.lost; B.lost = false;
      if (wasLost) B.push('the bridge came back');
      if (s.incoming?.length && !B.delivering) { B.delivering = true; try { for (const f of s.incoming) await takeIn(f.file); } finally { B.delivering = false; } }
    } catch (e) { B.lost = true; }
    paint();
  }
  B.pollTimer = setTimeout(poll, B.lost ? 8000 : 3000);
}

function paint() {
  const el = $('#bridgepill'); if (!el) return; el.innerHTML = '';
  if (!B.on) return;
  const t = d => d ? d.toLocaleTimeString() : '—';
  if (B.standby) { el.append(h('span', { class: 'bp off', title: 'The hub is also open in another tab, and that tab is syncing with the agents. Edits made here are not sent until you close the other tab.' }, '🌉 ', h('span', {}, 'Bridge: other tab'))); return; }
  el.append(h('span', { class: 'bp ' + (B.lost ? 'off' : 'ok'), title: B.lost ? 'The bridge program is not running. Start it again with: python3 scripts/hub_bridge.py — the hub reconnects by itself.' : `Your hub and the agents stay in sync automatically.\nLast sent to agents: ${t(B.sent)}\nLast received from agents: ${t(B.got)}` },
    '🌉 ', h('span', {}, B.lost ? 'Bridge offline' : B.pushing ? 'Sending…' : 'Bridge on')));
}

function activate() {
  B.standby = false;
  RH.on('change', ({ store }) => B.schedule(B.receiving ? `taking in ${B.receiving}’s additions` : `changes to ${LABEL[store] || store}`));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  paint(); B.push('the hub connected'); poll();
}
B.start = async function () {
  if (!/^https?:$/.test(location.protocol)) return;
  try { if ((await api('status')).bridge !== 'research-hub') return; } catch (e) { return; }
  B.on = true;
  // Only one tab syncs with the agents, so two open tabs can't overwrite each other's transfers.
  if (navigator.locks) { B.standby = true; paint(); navigator.locks.request('research-hub-bridge', () => { activate(); return new Promise(() => { }); }); }
  else activate();
};

})(window.RH);
