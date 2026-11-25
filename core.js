/*
 * yacin — Yet Another Cyber Incident News
 * core.js: sorgenti, normalizzazione, classificazione, archivio locale.
 * Caricato sia dalla pagina (<script>) sia dal service worker (importScripts).
 *
 * Copyright (C) 2026 Pietro
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version. See LICENSE.
 */
(function (G) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Impostazioni predefinite                                            */
  /* ------------------------------------------------------------------ */
  const DEFAULTS = {
    refreshMin: 10,                 // intervallo di aggiornamento in app
    lookbackDays: 30,               // finestra dei dati conservati
    alertMinSeverity: 1,            // 1 = ogni incidente
    alertsEnabled: false,
    // proxy CORS per le API che non espongono intestazioni CORS ({url} = URL codificato)
    proxy: 'https://api.allorigins.win/raw?url={url}',
    // convertitore RSS -> JSON con CORS
    rssBridge: 'https://api.rss2json.com/v1/api.json?rss_url={url}',
    sources: {
      ransomware: true,
      hibp: true,
      gdelt: true,
      rss: true
    },
    feeds: [
      { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', on: true },
      { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', on: true },
      { name: 'The Record', url: 'https://therecord.media/feed', on: true },
      { name: 'DataBreaches.net', url: 'https://databreaches.net/feed/', on: true },
      { name: 'Security Affairs', url: 'https://securityaffairs.com/feed', on: true },
      { name: 'Red Hot Cyber', url: 'https://www.redhotcyber.com/feed/', on: true }
    ]
  };

  const SEVERITY = [
    null,
    { label: 'Informativo', short: 'INFO', color: '#7d8a97' },
    { label: 'Basso', short: 'BASSO', color: '#3fa7d6' },
    { label: 'Medio', short: 'MEDIO', color: '#f2c14e' },
    { label: 'Alto', short: 'ALTO', color: '#f78154' },
    { label: 'Critico', short: 'CRITICO', color: '#e5383b' }
  ];

  const TYPES = {
    ransomware: 'Ransomware / estorsione',
    breach: 'Violazione di dati',
    ddos: 'DDoS / interruzione',
    espionage: 'Spionaggio / APT',
    supply: 'Supply chain',
    destructive: 'Wiper / sabotaggio',
    exploit: 'Sfruttamento vulnerabilità',
    malware: 'Malware / phishing',
    other: 'Altro incidente'
  };

  /* ------------------------------------------------------------------ */
  /* Paesi                                                               */
  /* ------------------------------------------------------------------ */
  let COUNTRIES = null;   // { ISO2: {code,name,it,lat,lon,region} }
  let NAME_INDEX = null;  // [ [regex, ISO2] ]
  const ALIASES = {
    US: ['USA', 'U.S.', 'U.S', 'United States of America', 'America', 'American', 'Americans', 'Stati Uniti', 'statunitense', 'statunitensi', 'Pentagon', 'CISA', 'FBI', 'CIA', 'NSA'],
    GB: ['UK', 'U.K.', 'Britain', 'British', 'England', 'Scotland', 'Wales', 'Regno Unito', 'britannico', 'britannica', 'NHS'],
    RU: ['Russian', 'Russians', 'Kremlin', 'russo', 'russa', 'russi', 'russe'],
    CN: ['Chinese', 'Beijing', 'cinese', 'cinesi'],
    KP: ['North Korea', 'North Korean', 'Corea del Nord', 'nordcoreano', 'nordcoreani', 'Lazarus'],
    KR: ['South Korea', 'South Korean', 'Corea del Sud', 'sudcoreano'],
    IR: ['Iranian', 'iraniano', 'iraniani'],
    IL: ['Israeli', 'israeliano', 'israeliani'],
    UA: ['Ukrainian', 'ucraino', 'ucraina', 'ucraini'],
    DE: ['German', 'tedesco', 'tedesca', 'tedeschi'],
    FR: ['French', 'francese', 'francesi'],
    IT: ['Italian', 'italiano', 'italiana', 'italiani', 'italiane', 'ACN', 'Roma', 'Milano', 'Torino', 'Napoli'],
    ES: ['Spanish', 'spagnolo', 'spagnola'],
    JP: ['Japanese', 'giapponese', 'giapponesi'],
    IN: ['Indian', 'indiano', 'indiana'],
    AU: ['Australian', 'australiano', 'australiana'],
    CA: ['Canadian', 'canadese'],
    NL: ['Dutch', 'Netherlands', 'olandese', 'Paesi Bassi'],
    CZ: ['Czech Republic', 'Czech', 'Repubblica Ceca'],
    TR: ['Turkey', 'Turkish', 'turco', 'turca'],
    TW: ['Taiwanese'],
    BR: ['Brazilian', 'brasiliano'],
    MX: ['Mexican', 'messicano'],
    PL: ['Polish', 'polacco', 'polacca'],
    CH: ['Swiss', 'svizzero', 'svizzera'],
    AT: ['Austrian'],
    BE: ['Belgian'],
    SE: ['Swedish', 'svedese'],
    NO: ['Norwegian'],
    DK: ['Danish'],
    FI: ['Finnish'],
    IE: ['Irish'],
    PT: ['Portuguese'],
    GR: ['Greek'],
    RO: ['Romanian'],
    VN: ['Vietnamese'],
    PK: ['Pakistani'],
    SG: ['Singaporean'],
    NZ: ['New Zealand'],
    ZA: ['South African'],
    SA: ['Saudi', 'Saudi Arabia'],
    AE: ['UAE', 'Emirates', 'Emirati']
  };

  function loadCountries(rows) {
    COUNTRIES = {};
    const pairs = [];
    for (const [code, name, it, lat, lon, region] of rows) {
      COUNTRIES[code] = { code, name, it, lat, lon, region };
      pairs.push([name, code]);
      if (it && it !== name) pairs.push([it, code]);
    }
    for (const code in ALIASES) for (const a of ALIASES[code]) pairs.push([a, code]);
    // nomi più lunghi prima (es. "South Korea" prima di "Korea")
    pairs.sort((a, b) => b[0].length - a[0].length);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    NAME_INDEX = pairs
      .filter(p => p[0].length >= 3 || /^[A-Z]{2,3}$/.test(p[0]))
      .map(([n, c]) => {
        const caseSens = /^[A-Z.]{2,5}$/.test(n); // sigle: sensibili alle maiuscole
        return [new RegExp('(^|[^\\p{L}])' + esc(n) + '(?=$|[^\\p{L}])', caseSens ? 'u' : 'iu'), c];
      });
  }

  function countryFromText(text) {
    if (!NAME_INDEX || !text) return null;
    for (const [re, code] of NAME_INDEX) if (re.test(text)) return code;
    return null;
  }

  function countryByName(name) {
    if (!COUNTRIES || !name) return null;
    const n = name.toLowerCase();
    for (const c in COUNTRIES) {
      const x = COUNTRIES[c];
      if (x.name.toLowerCase() === n || x.it.toLowerCase() === n) return c;
    }
    return countryFromText(name);
  }

  /* ------------------------------------------------------------------ */
  /* Utilità                                                             */
  /* ------------------------------------------------------------------ */
  const stripHtml = s => String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”').replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8230;|&hellip;/g, '…').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || '');

  function hash(str) { // FNV-1a 32 bit
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  function parseDate(v) {
    if (!v) return null;
    if (/^\d{8}T\d{6}Z$/.test(v)) { // GDELT
      v = v.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) { // rss2json (UTC)
      v = v.replace(' ', 'T') + 'Z';
    }
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  function withTimeout(ms) {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    return { signal: c.signal, done: () => clearTimeout(id) };
  }

  async function getJSON(url, ms) {
    const t = withTimeout(ms || 25000);
    try {
      const r = await fetch(url, { signal: t.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch (e) { throw new Error('risposta non JSON'); }
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('timeout');
      throw e;
    } finally { t.done(); }
  }

  const viaProxy = (tpl, url) => tpl ? tpl.replace('{url}', encodeURIComponent(url)) : url;

  /* ------------------------------------------------------------------ */
  /* Classificazione                                                     */
  /* ------------------------------------------------------------------ */
  const RX = {
    incident: /\b(attack|attacked|attacks|cyberattack|cyber-attack|cyber attack|breach|breached|hack|hacked|hackers?|ransomware|leak|leaked|leaks|ddos|compromis\w*|stolen|theft|extort\w*|espionage|intrusion|outage|disrupt\w*|exfiltrat\w*|wiper|exposed|data of|malware|backdoor\w*|exploited|zero-day|0-day|phishing campaign|spyware|apt\d*|threat actor|attacco|attacchi|violazione|violato|furto|esfiltra\w*|riscatto|intrusione|hacker|data breach|cyber incident|incidente informatico)\b/i,
    notIncident: /\b(how to|best |review|deal|discount|sale|webinar|podcast|guide|tutorial|top \d+|tips|sponsored|offerta|recensione|come fare|weekly recap|week in review|newsletter|career|hiring|funding round|raises \$|acquires|acquisition|launches|unveils|patch tuesday)\b/i,
    ransomware: /\b(ransomware|ransom|extort\w*|lockbit|akira|qilin|blackcat|alphv|clop|cl0p|play ransomware|black basta|medusa|rhysida|scattered spider|riscatto|estorsione)\b/i,
    breach: /\b(breach|breached|leak|leaked|leaks|exposed|stolen data|data of|records|customer data|personal data|exfiltrat\w*|violazione|dati personali|data theft|dump)\b/i,
    ddos: /\b(ddos|denial[- ]of[- ]service|outage|knocked offline|disrupt\w*|downtime|interruzione|disservizio|noname057)\b/i,
    espionage: /\b(espionage|spy|spies|spying|apt ?\d+|apt\b|nation[- ]state|state[- ]sponsored|state[- ]backed|volt typhoon|salt typhoon|typhoon|fancy bear|cozy bear|lazarus|sandworm|turla|kimsuky|mustang panda|manticore|spionaggio|cyberspionaggio)\b/i,
    supply: /\b(supply[- ]chain|npm package|pypi|malicious package|dependency|third[- ]party vendor|catena di fornitura)\b/i,
    destructive: /\b(wiper|sabotage|destructive|sabotaggio|distruttiv\w*)\b/i,
    exploit: /\b(zero-day|0-day|exploit\w*|vulnerabilit\w*|cve-\d{4}-\d+|actively exploited)\b/i,
    malware: /\b(malware|trojan|botnet|phishing|infostealer|stealer|backdoor\w*|spyware|rat\b|loader)\b/i,
    critical: /\b(hospital\w*|health\w*|healthcare|medical|patients?|clinic\w*|energy|power grid|electric\w*|utility|utilities|water|pipeline|oil|gas|nuclear|government|ministry|military|defen[cs]e|army|navy|police|election\w*|parliament|telecom\w*|airport\w*|airline\w*|railway|rail|port|transport\w*|bank\w*|financial|stock exchange|central bank|cia|nsa|pentagon|ospedal\w*|sanit\w*|asl\b|ministero|governo|comune di|regione|difesa|esercito|polizia|energia|acqua|trasporti|banca|banche|infrastruttur\w* critic\w*)\b/i,
    scale: /\b(millions?|billions?|nationwide|massive|major|largest|widespread|global outage|shut ?down|shuts down|halts?|halted|crippl\w*|paralyz\w*|all systems|milioni|miliardi|paralizz\w*|bloccat\w*|massiccio)\b/i,
    advanced: /\b(zero-day|0-day|nation[- ]state|state[- ]sponsored|state[- ]backed|apt ?\d+|typhoon|lazarus|sandworm|wiper)\b/i,
    critSector: /\b(health|healthcare|hospital|medical|pharma\w*|government|public sector|energy|utilities|water|transport\w*|logistics|telecom\w*|financ\w*|bank\w*|defen[cs]e|education)\b/i
  };

  function detectType(text) {
    if (RX.destructive.test(text)) return 'destructive';
    if (RX.supply.test(text)) return 'supply';
    if (RX.ransomware.test(text)) return 'ransomware';
    if (RX.espionage.test(text)) return 'espionage';
    if (RX.ddos.test(text)) return 'ddos';
    if (RX.breach.test(text)) return 'breach';
    if (RX.exploit.test(text)) return 'exploit';
    if (RX.malware.test(text)) return 'malware';
    return 'other';
  }

  const BASE = { ransomware: 3, breach: 2, ddos: 2, espionage: 3, supply: 3, destructive: 4, exploit: 2, malware: 2, other: 2 };

  // Restituisce {severity, reasons[]}. Regole trasparenti, mostrate all'utente.
  function classify(inc) {
    const text = [inc.title, inc.summary, inc.sector].join(' ');
    const reasons = [];
    let s = BASE[inc.type] || 1;
    reasons.push('Base per tipo “' + TYPES[inc.type] + '”: ' + s);
    if (RX.critical.test(text) || (inc.sector && RX.critSector.test(inc.sector))) { s++; reasons.push('+1 settore critico / pubblico'); }
    if (RX.scale.test(text)) { s++; reasons.push('+1 indicatori di larga scala o fermo dei servizi'); }
    if (RX.advanced.test(text)) { s++; reasons.push('+1 zero-day o attore statale'); }
    if (inc.pwnCount) {
      if (inc.pwnCount >= 100e6) { s += 2; reasons.push('+2 oltre 100 milioni di account'); }
      else if (inc.pwnCount >= 10e6) { s++; reasons.push('+1 oltre 10 milioni di account'); }
      else if (inc.pwnCount >= 1e6) { s++; reasons.push('+1 oltre 1 milione di account'); }
    }
    if (inc.sensitiveData) { s++; reasons.push('+1 dati sensibili (password, finanziari, sanitari)'); }
    const n = (inc.sources || []).length;
    if (n >= 3) { s++; reasons.push('+1 riportato da ' + n + ' fonti'); }
    if (inc.unverified) { s--; reasons.push('−1 vittima non identificata / rivendicazione non verificata'); }
    s = Math.max(1, Math.min(5, s));
    return { severity: s, reasons };
  }

  function finalize(inc) {
    const text = [inc.title, inc.summary].join(' ');
    if (!inc.type) inc.type = detectType(text);
    if (!inc.country) {
      const c = countryFromText(inc.title) || countryFromText(inc.summary);
      if (c) { inc.country = c; inc.countryHow = 'testo'; }
    }
    if (inc.country && COUNTRIES && !COUNTRIES[inc.country]) inc.country = null;
    const k = classify(inc);
    inc.severity = k.severity; inc.reasons = k.reasons;
    return inc;
  }

  /* ------------------------------------------------------------------ */
  /* Sorgenti                                                            */
  /* ------------------------------------------------------------------ */
  // 1) ransomware.live — rivendicazioni sui leak site (API v2, senza CORS => proxy)
  async function fetchRansomware(cfg) {
    const data = await getJSON(viaProxy(cfg.proxy, 'https://api.ransomware.live/v2/recentvictims'), 30000);
    if (!Array.isArray(data)) throw new Error('formato inatteso');
    return data.map(v => {
      const sector = v.activity && v.activity !== 'Not Found' ? v.activity : '';
      const redacted = /redacted|pending disclosure/i.test(v.description || '') || /\.\.\./.test(v.victim || '');
      const victim = stripHtml(v.victim) || 'Vittima non indicata';
      return finalize({
        id: 'rw-' + hash((v.victim || '') + '|' + (v.group || '') + '|' + (v.attackdate || v.discovered || '')),
        source: 'ransomware',
        title: victim + ' — rivendicato da ' + (v.group || 'gruppo ignoto'),
        summary: clip(stripHtml(v.description), 600),
        url: v.url || 'https://www.ransomware.live/',
        date: parseDate(v.discovered) || parseDate(v.attackdate) || Date.now(),
        attackDate: parseDate(v.attackdate),
        country: (v.country || '').toUpperCase() || null,
        countryHow: v.country ? 'fonte' : null,
        sector,
        actor: v.group || '',
        victim,
        type: 'ransomware',
        unverified: redacted,
        sources: [{ name: 'ransomware.live', url: v.url || 'https://www.ransomware.live/' }]
      });
    });
  }

  // 2) Have I Been Pwned — catalogo pubblico delle violazioni (CORS nativo, senza chiave)
  async function fetchHibp(cfg) {
    const data = await getJSON('https://haveibeenpwned.com/api/v3/breaches', 45000);
    const since = Date.now() - cfg.lookbackDays * 864e5;
    return data
      .filter(b => !b.IsSpamList && !b.IsFabricated && parseDate(b.AddedDate) >= since)
      .map(b => {
        const classes = (b.DataClasses || []).join(', ');
        return finalize({
          id: 'hibp-' + b.Name,
          source: 'hibp',
          title: (b.Title || b.Name) + ': ' + (b.PwnCount || 0).toLocaleString('it-IT') + ' account violati',
          summary: clip(stripHtml(b.Description), 700) + (classes ? ' Dati esposti: ' + classes + '.' : ''),
          url: 'https://haveibeenpwned.com/Breach/' + encodeURIComponent(b.Name),
          date: parseDate(b.AddedDate),
          attackDate: parseDate(b.BreachDate),
          country: null,
          sector: b.Domain || '',
          actor: '',
          victim: b.Title || b.Name,
          type: 'breach',
          pwnCount: b.PwnCount || 0,
          sensitiveData: /password|credit card|bank|financial|health|medical|passport|social security/i.test(classes) || !!b.IsSensitive,
          unverified: b.IsVerified === false,
          sources: [{ name: 'Have I Been Pwned', url: 'https://haveibeenpwned.com/Breach/' + encodeURIComponent(b.Name) }]
        });
      });
  }

  // 3) GDELT DOC 2.0 — notizie mondiali. Nessun CORS: si usa JSONP (solo nella pagina).
  const GDELT_QUERIES = [
    '(ransomware OR cyberattack OR "cyber attack" OR "data breach" OR hackers OR ddos) sourcelang:english',
    '(ransomware OR "attacco informatico" OR "attacco hacker" OR "violazione dei dati" OR "furto di dati") sourcelang:italian'
  ];
  function gdeltUrl(q, cb) {
    return 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(q) +
      '&mode=artlist&format=jsonp&callback=' + cb + '&maxrecords=75&timespan=3d&sort=datedesc';
  }
  function jsonp(url, cbName, ms) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(new Error('JSONP non disponibile qui'));
      const s = document.createElement('script');
      const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms || 30000);
      function cleanup() { clearTimeout(t); delete G[cbName]; s.remove(); }
      G[cbName] = d => { cleanup(); resolve(d); };
      s.onerror = () => { cleanup(); reject(new Error('errore di rete')); };
      s.src = url.replace('callback=' + cbName, 'callback=' + cbName);
      document.head.appendChild(s);
    });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fetchGdelt() {
    const out = [];
    for (let i = 0; i < GDELT_QUERIES.length; i++) {
      if (i) await sleep(6000); // GDELT: max 1 richiesta ogni 5 s
      const cb = '__yacinGdelt' + i + '_' + Date.now();
      const d = await jsonp(gdeltUrl(GDELT_QUERIES[i], cb), cb, 30000);
      for (const a of (d && d.articles) || []) {
        const title = stripHtml(a.title);
        if (!RX.incident.test(title) || RX.notIncident.test(title)) continue;
        const srcC = countryByName(a.sourcecountry);
        const inc = {
          id: 'gd-' + hash(a.url),
          source: 'gdelt',
          title,
          summary: '',
          url: a.url,
          date: parseDate(a.seendate) || Date.now(),
          country: null,
          sector: '',
          actor: '',
          lang: a.language,
          sources: [{ name: a.domain || 'GDELT', url: a.url }]
        };
        inc.country = countryFromText(title);
        if (inc.country) inc.countryHow = 'testo';
        else if (srcC) { inc.country = srcC; inc.countryHow = 'paese della testata'; }
        out.push(finalize(inc));
      }
    }
    return out;
  }

  // 4) Feed RSS di testate specializzate, tramite convertitore RSS->JSON con CORS
  async function fetchFeed(cfg, feed) {
    const d = await getJSON(viaProxy(cfg.rssBridge, feed.url), 25000);
    if (d.status && d.status !== 'ok') throw new Error(d.message || 'feed non valido');
    const out = [];
    for (const it of d.items || []) {
      const title = stripHtml(it.title);
      const summary = clip(stripHtml(it.description || it.content), 600);
      const cats = (it.categories || []).join(' ');
      if (!RX.incident.test(title + ' ' + cats) || RX.notIncident.test(title)) continue;
      out.push(finalize({
        id: 'rss-' + hash(it.link || it.guid || title),
        source: 'rss',
        title,
        summary,
        url: it.link,
        date: parseDate(it.pubDate) || Date.now(),
        country: null,
        sector: '',
        actor: '',
        sources: [{ name: feed.name, url: it.link }]
      }));
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Archivio (IndexedDB, chiave/valore)                                 */
  /* ------------------------------------------------------------------ */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('yacin', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(key) {
    const db = await idb();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  async function kvSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }

  async function getSettings() {
    const s = (await kvGet('settings')) || {};
    return Object.assign({}, DEFAULTS, s, {
      sources: Object.assign({}, DEFAULTS.sources, s.sources || {}),
      feeds: s.feeds || DEFAULTS.feeds.map(f => Object.assign({}, f))
    });
  }

  /* ------------------------------------------------------------------ */
  /* Unione, deduplica tra fonti giornalistiche, rilevamento novità      */
  /* ------------------------------------------------------------------ */
  const STOP = new Set('the a an of to in on for and or with by from at as is are was were be has have after its it this that new over says said amid il lo la i gli le di da in con su per tra fra e o un una del della dei delle al alla che dopo nuovo'.split(' '));
  const tokens = t => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
  function similar(a, b) {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const uni = a.size + b.size - inter;
    return uni ? inter / uni : 0;
  }

  // Ritorna {list, added[]} — added = incidenti mai visti prima (per gli alert)
  function merge(existing, incoming, cfg) {
    const byId = new Map(existing.map(i => [i.id, i]));
    const since = Date.now() - cfg.lookbackDays * 864e5;
    const added = [];
    const newsPool = existing.filter(i => (i.source === 'gdelt' || i.source === 'rss') && i.date > Date.now() - 3 * 864e5)
      .map(i => ({ i, t: tokens(i.title) }));
    for (const inc of incoming) {
      if (!inc || !inc.date || inc.date < since) continue;
      const prev = byId.get(inc.id);
      if (prev) { // aggiorna mantenendo le fonti accumulate
        inc.sources = mergeSources(prev.sources, inc.sources);
        inc.firstSeen = prev.firstSeen;
        byId.set(inc.id, finalize(Object.assign(prev, inc, { reasons: null })));
        continue;
      }
      if (inc.source === 'gdelt' || inc.source === 'rss') {
        const t = tokens(inc.title);
        let best = null, bs = 0;
        for (const p of newsPool) {
          if (Math.abs(p.i.date - inc.date) > 3 * 864e5) continue;
          const s = similar(t, p.t);
          if (s > bs) { bs = s; best = p; }
        }
        if (best && bs >= 0.45) { // stessa notizia da un'altra testata: rafforza, non duplica
          best.i.sources = mergeSources(best.i.sources, inc.sources);
          if (!best.i.summary && inc.summary) best.i.summary = inc.summary;
          if (!best.i.country && inc.country) { best.i.country = inc.country; best.i.countryHow = inc.countryHow; }
          finalize(best.i);
          continue;
        }
        newsPool.push({ i: inc, t });
      }
      inc.firstSeen = Date.now();
      byId.set(inc.id, inc);
      added.push(inc);
    }
    const list = [...byId.values()].filter(i => i.date >= since).sort((a, b) => b.date - a.date).slice(0, 4000);
    return { list, added };
  }
  function mergeSources(a, b) {
    const m = new Map();
    for (const s of [...(a || []), ...(b || [])]) if (s && s.url && !m.has(s.url)) m.set(s.url, s);
    return [...m.values()];
  }

  /* ------------------------------------------------------------------ */
  /* Aggiornamento completo                                              */
  /* ------------------------------------------------------------------ */
  // opts.jsonp=false nel service worker (GDELT viene saltato)
  async function refreshAll(opts) {
    opts = opts || {};
    const cfg = await getSettings();
    const tasks = [];
    if (cfg.sources.ransomware) tasks.push(['ransomware.live', () => fetchRansomware(cfg)]);
    if (cfg.sources.hibp) tasks.push(['Have I Been Pwned', () => fetchHibp(cfg)]);
    if (cfg.sources.rss) for (const f of cfg.feeds) if (f.on) tasks.push([f.name, () => fetchFeed(cfg, f)]);
    if (cfg.sources.gdelt && opts.jsonp !== false) tasks.push(['GDELT', () => fetchGdelt()]);

    const status = {};
    const results = await Promise.all(tasks.map(async ([name, fn]) => {
      const t0 = Date.now();
      try { const r = await fn(); status[name] = { ok: true, n: r.length, ms: Date.now() - t0, at: Date.now() }; return r; }
      catch (e) { status[name] = { ok: false, err: String(e.message || e), at: Date.now() }; return []; }
    }));
    const existing = (await kvGet('incidents')) || [];
    const firstRun = existing.length === 0 && !(await kvGet('initialized'));
    const { list, added } = merge(existing, results.flat(), cfg);
    await kvSet('incidents', list);
    await kvSet('status', status);
    await kvSet('lastRefresh', Date.now());
    if (firstRun) await kvSet('initialized', true);
    // al primo avvio lo storico non genera alert
    return { list, added: firstRun ? [] : added, status, cfg };
  }

  function alertText(inc) {
    const sev = SEVERITY[inc.severity];
    const where = inc.country && COUNTRIES && COUNTRIES[inc.country] ? COUNTRIES[inc.country].it : 'Paese non indicato';
    return {
      title: '[' + sev.short + '] ' + clip(inc.title, 90),
      body: TYPES[inc.type] + ' · ' + where + (inc.sector ? ' · ' + inc.sector : '')
    };
  }

  G.YACIN = {
    DEFAULTS, SEVERITY, TYPES, loadCountries, countries: () => COUNTRIES,
    refreshAll, kvGet, kvSet, getSettings, alertText, classify, finalize, clip, stripHtml
  };
})(typeof self !== 'undefined' ? self : this);
