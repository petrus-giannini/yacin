/*
 * yacin — Yet Another Cyber Incident News
 * app.js: interfaccia (lista, mappa, globo 3D, impostazioni), aggiornamento e alert.
 *
 * Copyright (C) 2026 Pietro
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version. See LICENSE.
 */
{
  'use strict';
  const Y = window.YACIN;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '#';
  const SRC_LABEL = { ransomware: 'ransomware.live', hibp: 'Have I Been Pwned', gdelt: 'GDELT', rss: 'Testata specializzata' };
  const GLOBE_LIB = 'https://unpkg.com/globe.gl@2.46.2/dist/globe.gl.min.js';
  const GLOBE_IMG = 'https://unpkg.com/three-globe@2.45.6/example/img/';

  const state = {
    all: [], cfg: null, status: {}, lastRefresh: 0, refreshing: false,
    view: 'lista', shown: 60, lastAddedIds: new Set(),
    f: { sev: new Set([1, 2, 3, 4, 5]), q: '', type: '', src: '', days: 7, country: '' }
  };

  /* ---------------- utilità di presentazione ---------------- */
  const sevColor = s => Y.SEVERITY[s].color;
  const cName = code => { const c = Y.countries() && Y.countries()[code]; return c ? c.it : ''; };
  const flag = code => code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(ch => 0x1F1A5 + ch.charCodeAt(0))) : '';
  const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
  function ago(t) {
    const s = (t - Date.now()) / 1000, a = Math.abs(s);
    if (a < 60) return 'adesso';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const fmtDate = t => t ? new Date(t).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  function toast(msg, onClick) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    t.onclick = () => { t.hidden = true; onClick && onClick(); };
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 6000);
  }

  /* ---------------- filtri (comuni a tutte le viste) ---------------- */
  function filtered(ignoreCountry) {
    const { sev, q, type, src, days, country } = state.f;
    const since = Date.now() - days * 864e5;
    const qq = q.trim().toLowerCase();
    return state.all.filter(i =>
      i.date >= since && sev.has(i.severity) &&
      (!type || i.type === type) && (!src || i.source === src) &&
      (ignoreCountry || !country || i.country === country) &&
      (!qq || [i.title, i.summary, i.actor, i.sector, cName(i.country), ...(i.sources || []).map(s => s.name)].join(' ').toLowerCase().includes(qq))
    );
  }

  function buildFilters() {
    $('#sevbar').innerHTML = [5, 4, 3, 2, 1].map(s =>
      `<button class="sev-chip" data-sev="${s}" aria-pressed="true" style="--c:${sevColor(s)}"><b id="sevn-${s}">0</b><span>${esc(s === 1 ? 'Info' : Y.SEVERITY[s].label)}</span></button>`).join('');
    $('#sevbar').addEventListener('click', e => {
      const b = e.target.closest('.sev-chip'); if (!b) return;
      const s = +b.dataset.sev, set = state.f.sev;
      // primo tocco con tutto attivo: isola quella gravità; altrimenti alterna
      if (set.size === 5) { set.clear(); set.add(s); }
      else if (set.has(s)) { set.delete(s); if (!set.size) [1, 2, 3, 4, 5].forEach(x => set.add(x)); }
      else set.add(s);
      syncSevChips(); render();
    });
    $('#f-type').insertAdjacentHTML('beforeend', Object.entries(Y.TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
    let qt;
    $('#f-q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { state.f.q = e.target.value; render(); }, 200); });
    $('#f-type').addEventListener('change', e => { state.f.type = e.target.value; render(); });
    $('#f-src').addEventListener('change', e => { state.f.src = e.target.value; render(); });
    $('#f-period').addEventListener('change', e => { state.f.days = +e.target.value; render(); });
  }
  function syncSevChips() {
    document.querySelectorAll('.sev-chip').forEach(b => b.setAttribute('aria-pressed', state.f.sev.has(+b.dataset.sev)));
  }
  function setCountry(code) {
    state.f.country = code || '';
    const el = $('#f-country');
    if (code) {
      el.hidden = false;
      el.innerHTML = `<span>${flag(code)} ${esc(cName(code) || code)}</span><button aria-label="Rimuovi filtro paese">×</button>`;
      el.querySelector('button').onclick = () => setCountry('');
    } else el.hidden = true;
    render();
  }

  /* ---------------- vista lista ---------------- */
  function itemHtml(i) {
    const isNew = state.lastAddedIds.has(i.id);
    return `<li class="item" data-id="${esc(i.id)}" style="--c:${sevColor(i.severity)}"><span class="bar"></span><div class="in">
      <div class="row"><span class="badge">${esc(Y.SEVERITY[i.severity].short)}</span>${isNew ? '<span class="new">NUOVO</span>' : ''}
      <span>${esc(Y.TYPES[i.type])}</span><span>${i.country ? flag(i.country) + ' ' + esc(cName(i.country)) : 'Paese non indicato'}</span></div>
      <h3>${esc(i.title)}</h3>
      <div class="row"><span class="time" title="${esc(fmtDate(i.date))}">${esc(ago(i.date))}</span>
      <span>${esc((i.sources || [])[0] ? i.sources[0].name : SRC_LABEL[i.source])}${i.sources && i.sources.length > 1 ? ' +' + (i.sources.length - 1) : ''}</span>
      ${i.sector ? `<span>${esc(Y.clip(i.sector, 40))}</span>` : ''}</div></div></li>`;
  }
  function renderList(list) {
    const shown = list.slice(0, state.shown);
    $('#list').innerHTML = shown.map(itemHtml).join('') +
      (list.length > shown.length ? `<li><button class="more" id="more">Mostra altri ${Math.min(60, list.length - shown.length)} di ${list.length - shown.length}</button></li>` : '');
    $('#list-empty').hidden = list.length > 0;
    const m = $('#more'); if (m) m.onclick = e => { e.stopPropagation(); state.shown += 60; renderList(list); };
  }
  $('#list').addEventListener('click', e => { const li = e.target.closest('.item'); if (li) openDetail(li.dataset.id); });

  /* ---------------- aggregazione per paese (mappa e globo) ---------------- */
  function byCountry(list) {
    const C = Y.countries() || {}, m = new Map();
    let none = 0;
    for (const i of list) {
      const c = i.country && C[i.country];
      if (!c) { none++; continue; }
      let g = m.get(i.country);
      if (!g) m.set(i.country, g = { code: i.country, name: c.it, lat: c.lat, lng: c.lon, items: [], max: 0, recent: 0 });
      g.items.push(i); g.max = Math.max(g.max, i.severity);
      if (Date.now() - i.date < 864e5) g.recent++;
    }
    return { groups: [...m.values()].sort((a, b) => b.items.length - a.items.length), none };
  }

  function countryPanel(panel, g) {
    if (!g) { panel.hidden = true; return; }
    const items = g.items.slice().sort((a, b) => b.severity - a.severity || b.date - a.date);
    panel.hidden = false;
    panel.innerHTML = `<button class="close" aria-label="Chiudi">×</button>
      <h3>${flag(g.code)} ${esc(g.name)}</h3>
      <div class="row"><span>${items.length} incidenti</span><span>gravità massima: ${esc(Y.SEVERITY[g.max].label)}</span></div>
      <button class="btn" data-filter>Filtra tutte le viste su questo paese</button>
      <ol>${items.slice(0, 50).map(i => `<li data-id="${esc(i.id)}" style="--c:${sevColor(i.severity)}"><b>${esc(Y.SEVERITY[i.severity].short)}</b> · ${esc(i.title)}<br><span class="time">${esc(ago(i.date))}</span></li>`).join('')}</ol>`;
    panel.querySelector('.close').onclick = () => { panel.hidden = true; };
    panel.querySelector('[data-filter]').onclick = () => setCountry(g.code);
    panel.querySelector('ol').onclick = e => { const li = e.target.closest('li'); if (li) openDetail(li.dataset.id); };
  }

  /* ---------------- vista mappa (Leaflet) ---------------- */
  let map, mapLayer, mapGroups = [];
  function renderMap(list) {
    if (!window.L) { $('#map-meta').textContent = 'Libreria della mappa non disponibile (offline?).'; return; }
    if (!map) {
      map = L.map('map', { worldCopyJump: true, zoomControl: true, minZoom: 2 }).setView([30, 10], 2);
      // Basemap libere, senza chiave API (dati © OpenStreetMap, ODbL)
      const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
      const bases = {
        'OSM scura': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, className: 'tiles-dark', attribution: OSM }),
        'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: OSM }),
        'OSM Humanitarian': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 12, attribution: OSM + ', stile <a href="https://www.hotosm.org/">HOT</a>' }),
        'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 12, attribution: OSM + ', SRTM, stile &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' })
      };
      let saved = 'OSM scura';
      try { if (bases[localStorage.getItem('yacin-base')]) saved = localStorage.getItem('yacin-base'); } catch (e) {}
      bases[saved].addTo(map);
      L.control.layers(bases, null, { position: 'topright' }).addTo(map);
      map.on('baselayerchange', e => { try { localStorage.setItem('yacin-base', e.name); } catch (er) {} });
      mapLayer = L.layerGroup().addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 50);
    const { groups, none } = byCountry(list);
    mapGroups = groups;
    mapLayer.clearLayers();
    const maxN = Math.max(1, ...groups.map(g => g.items.length));
    for (const g of groups) {
      const r = 6 + 22 * Math.sqrt(g.items.length / maxN);
      const mk = L.circleMarker([g.lat, g.lng], {
        radius: r, color: sevColor(g.max), weight: g.recent ? 3 : 1.5, fillColor: sevColor(g.max), fillOpacity: .45
      }).addTo(mapLayer);
      mk.bindTooltip(`${esc(g.name)}: ${g.items.length}`, { direction: 'top' });
      mk.on('click', () => countryPanel($('#map-panel'), g));
    }
    $('#map-meta').textContent = `${list.length - none} incidenti localizzati in ${groups.length} paesi · ${none} senza paese (es. violazioni globali) visibili solo in Lista · bordo spesso = attività nelle ultime 24 ore · colore = gravità massima.`;
  }

  /* ---------------- vista globo 3D (globe.gl) ----------------
   * globe.gl ridisegna la scena a ogni frame (requestAnimationFrame) anche da fermo:
   * per non tenere la CPU/GPU al 100% il ciclo di rendering resta in pausa e si
   * riattiva solo durante l'interazione, per un breve tempo dopo, o se l'utente
   * accende rotazione automatica o anelli animati (impostazioni ricordate). */
  let globe, globeLoading, globeIdle, globeDragging = false, globeGroups = [];
  const gopt = { rotate: false, rings: false };
  try { Object.assign(gopt, JSON.parse(localStorage.getItem('yacin-globe') || '{}')); } catch (e) {}
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('download fallito')); document.head.appendChild(s); });
  }
  const globeLive = () => state.view === 'globo' && !document.hidden;
  const globeContinuous = () => gopt.rotate || gopt.rings;
  function globeWake(ms) {
    if (!globe) return;
    clearTimeout(globeIdle);
    if (!globeLive()) { globe.pauseAnimation(); return; }
    globe.resumeAnimation();
    if (!globeContinuous() && !globeDragging) globeIdle = setTimeout(() => globe.pauseAnimation(), ms || 1500);
  }
  function globeApplyOptions() {
    if (!globe) return;
    // scelta esplicita dell'utente: vale anche con "riduci movimento" del sistema (che resta rispettato dai valori predefiniti, spenti)
    globe.controls().autoRotate = !!gopt.rotate;
    const recent = globeGroups.filter(g => g.recent);
    globe.ringsData(gopt.rings ? recent : []);
    document.querySelectorAll('#globe-opts input').forEach(i => { i.checked = !!gopt[i.dataset.opt]; });
    const n = $('#rings-n');
    if (n) n.textContent = recent.length ? `(${recent.length} ${recent.length === 1 ? 'paese' : 'paesi'})` : '(nessun paese con i filtri attuali)';
    globeWake(1500);
  }
  $('#globe-opts').addEventListener('change', e => {
    const k = e.target.dataset.opt; if (!k) return;
    gopt[k] = e.target.checked;
    try { localStorage.setItem('yacin-globe', JSON.stringify(gopt)); } catch (er) {}
    globeApplyOptions();
  });
  async function renderGlobe(list) {
    const el = $('#globe');
    if (!window.Globe) {
      if (!globeLoading) globeLoading = loadScript(GLOBE_LIB);
      $('#globe-meta').textContent = 'Caricamento del globo…';
      try { await globeLoading; } catch (e) { $('#globe-meta').textContent = 'Libreria del globo non disponibile (offline?).'; return; }
    }
    if (!globe) {
      globe = new window.Globe(el, {
        animateIn: false,
        rendererConfig: { antialias: false, alpha: false, powerPreference: 'low-power', precision: 'mediump' }
      })
        .globeImageUrl(GLOBE_IMG + 'earth-dark.jpg')
        .backgroundImageUrl(GLOBE_IMG + 'night-sky.png')
        .atmosphereColor('#5f7fa3').atmosphereAltitude(0.18)
        .pointLat('lat').pointLng('lng').pointRadius(d => 1.1 + Math.sqrt(d.items.length) * 0.55)
        .pointAltitude(d => 0.02 + Math.min(0.6, d.items.length / 60))
        .pointResolution(8)
        .pointColor(d => sevColor(d.max))
        .pointLabel(d => `<div class="globe-tip"><b>${esc(d.name)}</b><br>${d.items.length} incidenti · max ${esc(Y.SEVERITY[d.max].label)}</div>`)
        .onPointClick(d => countryPanel($('#globe-panel'), d))
        .ringLat('lat').ringLng('lng').ringAltitude(0.004).ringResolution(96)
        .ringColor(d => t => hexA(sevColor(d.max), Math.pow(1 - t, 0.6)))
        .ringMaxRadius(d => 6 + 2.5 * d.max + Math.min(8, d.recent)).ringPropagationSpeed(d => (6 + 2.5 * d.max) / 2.2).ringRepeatPeriod(700)
        .onGlobeReady(() => globeWake(2000));
      // densità di pixel limitata: su schermi 2x/3x dimezza o più il lavoro di rendering
      globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      const c = globe.controls();
      c.autoRotateSpeed = 0.35;
      c.addEventListener('start', () => { globeDragging = true; globeWake(); });
      c.addEventListener('end', () => { globeDragging = false; globeWake(1500); }); // lascia finire l'inerzia
      el.addEventListener('pointermove', () => { if (!globeDragging) globeWake(700); }, { passive: true }); // etichette al passaggio
      el.addEventListener('wheel', () => globeWake(1200), { passive: true });
      document.addEventListener('visibilitychange', () => globeWake(1500));
      globe.pointOfView({ lat: 35, lng: 12, altitude: 2.3 });
      new ResizeObserver(() => { globe.width(el.clientWidth).height(el.clientHeight); globeWake(800); }).observe(el);
    }
    globe.width(el.clientWidth).height(el.clientHeight);
    const { groups, none } = byCountry(list);
    globeGroups = groups;
    globe.pointsData(groups);
    globeApplyOptions();
    $('#globe-meta').textContent = `${groups.length} paesi · altezza = numero di incidenti · colore = gravità massima · ${none} incidenti senza paese.` +
      (gopt.rings ? ' Onde = paesi con incidenti nelle ultime 24 ore, ampiezza crescente con gravità e numero.' : '') +
      (globeContinuous() ? ' Con animazioni attive il globo resta sempre in rendering.' : ' Il rendering si ferma quando non interagisci.');
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(2)})`;
  }

  /* ---------------- dettaglio (identico da ogni vista) ---------------- */
  function openDetail(id) {
    const i = state.all.find(x => x.id === id);
    if (!i) { toast('Incidente non più presente in archivio.'); return; }
    const c = i.country;
    $('#d-body').innerHTML = `
      <div class="row"><span class="badge" style="--c:${sevColor(i.severity)}">${esc(Y.SEVERITY[i.severity].label.toUpperCase())} · ${i.severity}/5</span><span>${esc(Y.TYPES[i.type])}</span></div>
      <h2 id="d-title">${esc(i.title)}</h2>
      ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}
      <dl class="kv">
        <dt>Paese</dt><dd>${c ? flag(c) + ' ' + esc(cName(c)) + (i.countryHow && i.countryHow !== 'fonte' ? ' <small>(dedotto da ' + esc(i.countryHow) + ')</small>' : '') : 'Non indicato'}</dd>
        ${i.victim ? `<dt>Vittima</dt><dd>${esc(i.victim)}</dd>` : ''}
        ${i.actor ? `<dt>Attore</dt><dd>${esc(i.actor)}</dd>` : ''}
        ${i.sector ? `<dt>Settore / dominio</dt><dd>${esc(i.sector)}</dd>` : ''}
        ${i.pwnCount ? `<dt>Account</dt><dd>${esc(i.pwnCount.toLocaleString('it-IT'))}</dd>` : ''}
        <dt>Pubblicato</dt><dd>${esc(fmtDate(i.date))}</dd>
        ${i.attackDate ? `<dt>Data dell'attacco</dt><dd>${esc(fmtDate(i.attackDate))}</dd>` : ''}
        <dt>Origine dati</dt><dd>${esc(SRC_LABEL[i.source])}</dd>
      </dl>
      <h3>Perché questa gravità</h3>
      <ul class="why">${(i.reasons || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <h3>Fonti (${(i.sources || []).length})</h3>
      <ul class="srclist">${(i.sources || []).map(s => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a></li>`).join('')}</ul>
      ${c ? `<div class="btns"><button class="btn" id="d-country">Mostra tutti gli incidenti di ${esc(cName(c))}</button></div>` : ''}`;
    $('#sheet').hidden = false;
    const b = $('#d-country'); if (b) b.onclick = () => { closeDetail(); setCountry(c); };
    $('#sheet .close').focus();
  }
  function closeDetail() { $('#sheet').hidden = true; }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

  /* ---------------- render complessivo ---------------- */
  function render() {
    const withoutSev = (() => { const s = state.f.sev; state.f.sev = new Set([1, 2, 3, 4, 5]); const l = filtered(); state.f.sev = s; return l; })();
    for (let s = 1; s <= 5; s++) $('#sevn-' + s).textContent = withoutSev.filter(i => i.severity === s).length;
    const list = filtered();
    $('#list-meta').textContent = `${list.length} incidenti` + (state.all.length ? ` su ${state.all.length} in archivio` : '');
    if (state.view === 'lista') renderList(list);
    else if (state.view === 'mappa') renderMap(list);
    else if (state.view === 'globo') renderGlobe(list);
  }

  /* ---------------- stato e intestazione ---------------- */
  function renderStatus() {
    const st = Object.values(state.status), ok = st.filter(s => s.ok).length;
    const dot = !st.length ? '#7d8a97' : ok === st.length ? '#7bd389' : ok ? '#f2c14e' : '#e5383b';
    $('#status').innerHTML = `<span class="dot" style="background:${dot}"></span>` +
      (state.refreshing ? 'aggiornamento in corso…' : state.lastRefresh ? `agg. ${esc(ago(state.lastRefresh))} · ${ok}/${st.length} fonti` : 'mai aggiornato') +
      (navigator.onLine ? '' : ' · offline');
    $('#src-status').innerHTML = Object.entries(state.status).map(([n, s]) =>
      `<tr><td>${esc(n)}</td><td class="${s.ok ? 'ok' : 'ko'}">${s.ok ? 'ok' : esc('errore: ' + s.err)}</td><td class="num">${s.ok ? s.n : '—'}</td><td class="time">${esc(new Date(s.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }))}</td></tr>`).join('') ||
      '<tr><td colspan="4">Nessun aggiornamento ancora eseguito.</td></tr>';
  }

  /* ---------------- aggiornamento ---------------- */
  async function refresh(manual) {
    if (state.refreshing || !navigator.onLine) { if (manual && !navigator.onLine) toast('Sei offline: mostro i dati salvati.'); return; }
    state.refreshing = true; $('#btn-refresh').classList.add('spin'); renderStatus();
    try {
      const r = await Y.refreshAll({ jsonp: true });
      state.all = r.list; state.status = r.status; state.cfg = r.cfg; state.lastRefresh = Date.now();
      if (r.added.length) {
        state.lastAddedIds = new Set(r.added.map(i => i.id));
        const top = r.added.slice().sort((a, b) => b.severity - a.severity)[0];
        toast(`${r.added.length} nuovi incidenti · il più grave: ${Y.SEVERITY[top.severity].label} — ${Y.clip(top.title, 70)}`, () => openDetail(top.id));
        await alertNew(r.added);
      } else if (manual) toast('Nessun nuovo incidente.');
    } catch (e) {
      toast('Aggiornamento non riuscito: ' + e.message);
    } finally {
      state.refreshing = false; $('#btn-refresh').classList.remove('spin'); renderStatus(); render();
    }
  }
  function due() { return Date.now() - state.lastRefresh >= (state.cfg.refreshMin || 10) * 60000; }

  /* ---------------- alert ---------------- */
  async function alertNew(items) {
    const cfg = state.cfg;
    if (!cfg.alertsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const sel = items.filter(i => i.severity >= cfg.alertMinSeverity);
    if (!sel.length) return;
    if (navigator.vibrate && sel.some(i => i.severity >= 4)) navigator.vibrate([120, 60, 120]);
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) { reg.active.postMessage({ type: 'notify', items: sel }); return; }
    for (const i of sel.slice(0, 6)) { const t = Y.alertText(i); new Notification(t.title, { body: t.body, tag: i.id, icon: 'icons/icon-192.png' }); }
  }
  async function setAlerts(on) {
    if (on) {
      if (!('Notification' in window)) { toast('Questo browser non supporta le notifiche.'); return; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Permesso per le notifiche negato.'); on = false; }
    }
    state.cfg.alertsEnabled = on;
    await saveCfg();
    $('#btn-alert').setAttribute('aria-pressed', on);
    if (on) { await registerPeriodic(); toast('Alert attivi: notifica per ogni nuovo incidente ≥ ' + Y.SEVERITY[state.cfg.alertMinSeverity].label + '.'); }
    alertNote();
  }
  let periodicOk = false;
  async function registerPeriodic() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return;
      const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (perm.state !== 'granted') return;
      await reg.periodicSync.register('yacin-refresh', { minInterval: Math.max(15, state.cfg.refreshMin) * 60000 });
      periodicOk = true;
    } catch (e) { /* non supportato */ }
  }
  function alertNote() {
    const standalone = matchMedia('(display-mode: standalone)').matches;
    $('#alert-note').textContent = !state.cfg.alertsEnabled ? 'Alert disattivati: attivali con il pulsante Alert in alto.' :
      'Gli alert arrivano mentre l’app è aperta, anche in secondo piano. ' +
      (periodicOk ? 'Aggiornamento in background attivo: con l’app chiusa il browser controlla le fonti a intervalli decisi da lui (di solito ogni poche ore); GDELT in background non viene interrogato.' :
        standalone ? 'Questo browser non concede l’aggiornamento in background: con l’app chiusa non arrivano alert.' :
          'Per gli alert ad app chiusa installala (Aggiungi a schermata Home) con Chrome o Edge su Android.') +
      ' Notifiche push vere, istantanee, richiederebbero un server.';
  }

  /* ---------------- impostazioni ---------------- */
  async function saveCfg() { await Y.kvSet('settings', state.cfg); }
  function renderSettings() {
    const c = state.cfg;
    $('#s-alertmin').innerHTML = [1, 2, 3, 4, 5].map(s => `<option value="${s}" ${c.alertMinSeverity === s ? 'selected' : ''}>${s === 1 ? 'Tutti gli incidenti' : 'Da ' + esc(Y.SEVERITY[s].label) + ' in su'}</option>`).join('');
    const S = { ransomware: 'ransomware.live — rivendicazioni dei gruppi ransomware (via proxy)', hibp: 'Have I Been Pwned — violazioni di dati catalogate', gdelt: 'GDELT — stampa mondiale in inglese e italiano', rss: 'Feed RSS delle testate specializzate' };
    $('#s-sources').innerHTML = Object.entries(S).map(([k, v]) => `<label class="check"><input type="checkbox" data-src="${k}" ${c.sources[k] ? 'checked' : ''}> ${esc(v)}</label>`).join('');
    $('#s-feeds').innerHTML = c.feeds.map((f, n) => `<li><input type="checkbox" data-feed="${n}" ${f.on ? 'checked' : ''} aria-label="Attiva ${esc(f.name)}"><span>${esc(f.name)}<br><small>${esc(f.url)}</small></span><button data-del="${n}">Rimuovi</button></li>`).join('');
    $('#s-refresh').value = c.refreshMin; $('#s-lookback').value = c.lookbackDays;
    $('#s-proxy').value = c.proxy; $('#s-bridge').value = c.rssBridge;
    $('#legend').innerHTML = [1, 2, 3, 4, 5].map(s => `<div style="--c:${sevColor(s)}"><b>${s}</b> ${esc(Y.SEVERITY[s].label)}</div>`).join('');
    alertNote();
  }
  function bindSettings() {
    $('#s-alertmin').onchange = async e => { state.cfg.alertMinSeverity = +e.target.value; await saveCfg(); };
    $('#s-sources').onchange = async e => { const k = e.target.dataset.src; if (k) { state.cfg.sources[k] = e.target.checked; await saveCfg(); } };
    $('#s-feeds').onchange = async e => { const n = e.target.dataset.feed; if (n != null) { state.cfg.feeds[n].on = e.target.checked; await saveCfg(); } };
    $('#s-feeds').onclick = async e => { const n = e.target.dataset.del; if (n != null) { state.cfg.feeds.splice(+n, 1); await saveCfg(); renderSettings(); } };
    $('#s-addfeed').onsubmit = async e => {
      e.preventDefault();
      const name = $('#s-feedname').value.trim(), url = $('#s-feedurl').value.trim();
      if (!/^https?:\/\//.test(url)) return toast('Indirizzo del feed non valido.');
      state.cfg.feeds.push({ name, url, on: true }); await saveCfg(); e.target.reset(); renderSettings();
      toast('Feed aggiunto: verrà letto al prossimo aggiornamento.');
    };
    $('#s-save').onclick = async () => {
      const p = $('#s-proxy').value.trim(), b = $('#s-bridge').value.trim();
      if ((p && !p.includes('{url}')) || !b.includes('{url}')) return toast('Proxy e convertitore devono contenere {url}.');
      Object.assign(state.cfg, {
        refreshMin: Math.max(5, Math.min(240, +$('#s-refresh').value || 10)),
        lookbackDays: Math.max(3, Math.min(90, +$('#s-lookback').value || 30)), proxy: p, rssBridge: b
      });
      await saveCfg(); renderSettings(); toast('Impostazioni salvate.');
    };
    $('#s-reset').onclick = async () => {
      const keep = state.cfg.alertsEnabled;
      state.cfg = JSON.parse(JSON.stringify(Y.DEFAULTS)); state.cfg.alertsEnabled = keep;
      await saveCfg(); renderSettings(); toast('Impostazioni predefinite ripristinate.');
    };
    let armed = false;
    $('#s-wipe').onclick = async e => {
      if (!armed) { armed = true; e.target.textContent = 'Tocca di nuovo per confermare'; setTimeout(() => { armed = false; e.target.textContent = 'Cancella dati locali'; }, 4000); return; }
      await Y.kvSet('incidents', []); await Y.kvSet('initialized', false); await Y.kvSet('status', {});
      state.all = []; state.status = {}; state.lastRefresh = 0; render(); renderStatus();
      e.target.textContent = 'Cancella dati locali'; armed = false; toast('Archivio locale svuotato.');
    };
    $('#s-test').onclick = async () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') { await setAlerts(true); if (Notification.permission !== 'granted') return; }
      const fake = state.all[0] || { id: 'test', title: 'Notifica di prova', severity: 3, type: 'other' };
      const reg = await navigator.serviceWorker.getRegistration();
      const t = Y.alertText(fake);
      if (reg) reg.showNotification('Prova · ' + t.title, { body: t.body, tag: 'yacin-test', icon: 'icons/icon-192.png', data: { id: fake.id } });
      else new Notification('Prova · ' + t.title, { body: t.body });
    };
  }

  /* ---------------- navigazione ---------------- */
  const VIEWS = ['lista', 'mappa', 'globo', 'fonti'];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lista';
    state.view = v;
    for (const x of VIEWS) $('#v-' + x).hidden = x !== v;
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelector('.filters').hidden = v === 'fonti';
    if (globe) globeWake(1500);
    if (v === 'fonti') { renderSettings(); renderStatus(); } else render();
    window.scrollTo(0, 0);
  }

  /* ---------------- avvio ---------------- */
  async function start() {
    buildFilters(); bindSettings();
    try { Y.loadCountries(await (await fetch('countries.json')).json()); } catch (e) { toast('Elenco paesi non caricato.'); }
    state.cfg = await Y.getSettings();
    state.all = (await Y.kvGet('incidents')) || [];
    state.status = (await Y.kvGet('status')) || {};
    state.lastRefresh = (await Y.kvGet('lastRefresh')) || 0;
    $('#btn-alert').setAttribute('aria-pressed', !!state.cfg.alertsEnabled && 'Notification' in window && Notification.permission === 'granted');

    $('#btn-refresh').onclick = () => refresh(true);
    $('#btn-alert').onclick = () => setAlerts($('#btn-alert').getAttribute('aria-pressed') !== 'true');
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { renderStatus(); if (due()) refresh(); });
    window.addEventListener('offline', renderStatus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderStatus(); if (due()) refresh(); if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } });
    setInterval(() => { renderStatus(); if (due()) refresh(); }, 60000);

    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { /* es. file:// */ }
      navigator.serviceWorker.addEventListener('message', async e => {
        if (e.data && e.data.type === 'refreshed') { state.all = (await Y.kvGet('incidents')) || []; render(); }
        if (e.data && e.data.type === 'open' && e.data.id) openDetail(e.data.id);
      });
      if (state.cfg.alertsEnabled) registerPeriodic();
    }
    route(); renderStatus();
    const inc = new URLSearchParams(location.search).get('inc');
    if (inc) openDetail(inc);
    if (due()) refresh();
  }
  start();
}
