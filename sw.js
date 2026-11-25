/*
 * yacin — service worker: cache dell'app, aggiornamento periodico in background, notifiche.
 * Copyright (C) 2026 Pietro
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
importScripts('./core.js');

const CACHE = 'yacin-v5';
const SHELL = [
  './', './index.html', './app.js', './core.js', './style.css', './countries.json',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/globe.gl@2.46.2/dist/globe.gl.min.js',
  'https://unpkg.com/three-globe@2.45.6/example/img/earth-dark.jpg',
  'https://unpkg.com/three-globe@2.45.6/example/img/night-sky.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // le librerie CDN sono facoltative: se una non si scarica l'installazione prosegue
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const own = u.origin === self.location.origin;
  const cdn = /(^|\.)unpkg\.com$/.test(u.hostname);
  const tiles = /(^|\.)tile\.openstreetmap\.(org|fr)$|(^|\.)tile\.opentopomap\.org$|fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (own) { // rete prima (aggiornamenti), cache se offline
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
  } else if (cdn || tiles) { // cache prima
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') { const cl = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); }
      return res;
    })));
  }
  // API: sempre rete, nessuna intercettazione
});

async function ensureCountries() {
  if (YACIN.countries()) return;
  const r = (await caches.match('./countries.json')) || (await fetch('./countries.json'));
  YACIN.loadCountries(await r.json());
}

async function backgroundRefresh() {
  await ensureCountries();
  const { added, cfg } = await YACIN.refreshAll({ jsonp: false });
  await notify(added, cfg);
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const c of clients) c.postMessage({ type: 'refreshed' });
}

async function notify(added, cfg) {
  if (!cfg.alertsEnabled || !added.length) return;
  const sel = added.filter(i => i.severity >= cfg.alertMinSeverity).sort((a, b) => b.severity - a.severity);
  const max = 6;
  for (const inc of sel.slice(0, max)) {
    const t = YACIN.alertText(inc);
    await self.registration.showNotification(t.title, {
      body: t.body, tag: inc.id, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
      data: { id: inc.id }, renotify: false, requireInteraction: inc.severity >= 5
    });
  }
  if (sel.length > max) {
    await self.registration.showNotification('yacin: altri ' + (sel.length - max) + ' nuovi incidenti', {
      body: 'Apri l’app per vederli tutti.', tag: 'yacin-summary', icon: './icons/icon-192.png', data: {}
    });
  }
  if (self.navigator.setAppBadge) self.navigator.setAppBadge(sel.length).catch(() => {});
}

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'notify') {
    e.waitUntil(YACIN.getSettings().then(cfg => notify(e.data.items, cfg)));
  }
});

// Periodic Background Sync (Chrome/Edge su Android e desktop, solo app installata)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'yacin-refresh') e.waitUntil(backgroundRefresh().catch(() => {}));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const target = './index.html' + (id ? '?inc=' + encodeURIComponent(id) : '') + '#lista';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { c.postMessage({ type: 'open', id }); return c.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
