// JetPhotos+ — Background service worker
//
// Também monitora automaticamente o contador "Total Screened" da fila.
// A coleta acontece em background para que o usuário não precise abrir
// queue.php todos os dias.

const JP_WEBEXT = globalThis.browser || globalThis.chrome || null;
const JP_USE_BROWSER_PROMISES = Boolean(globalThis.browser && globalThis.browser !== globalThis.chrome);

function getStoredValue(keys) {
  const storage = JP_WEBEXT?.storage?.local;
  const list = Array.isArray(keys) ? keys : [keys];
  if (!storage?.get) return Promise.resolve({});
  if (JP_USE_BROWSER_PROMISES) {
    try { return Promise.resolve(storage.get(list)).then(result => result || {}, () => ({})); }
    catch (_) { return Promise.resolve({}); }
  }
  return new Promise(resolve => {
    try {
      storage.get(list, result => {
        try {
          if (JP_WEBEXT.runtime?.lastError) { resolve({}); return; }
        } catch (_) { resolve({}); return; }
        resolve(result || {});
      });
    } catch (_) { resolve({}); }
  });
}

function setStoredValue(items) {
  const storage = JP_WEBEXT?.storage?.local;
  if (!storage?.set) return Promise.resolve(false);
  if (JP_USE_BROWSER_PROMISES) {
    try { return Promise.resolve(storage.set(items)).then(() => true, () => false); }
    catch (_) { return Promise.resolve(false); }
  }
  return new Promise(resolve => {
    try {
      storage.set(items, () => {
        try { resolve(!JP_WEBEXT.runtime?.lastError); }
        catch (_) { resolve(false); }
      });
    } catch (_) { resolve(false); }
  });
}

const JP_QUEUE_URL = 'https://www.jetphotos.com/members/queue.php';
const JP_QUEUE_ALARM = 'jp-queue-daily-tracker';
const JP_QUEUE_POLL_MINUTES = 10;
const JP_QUEUE_DAILY_KEY = 'jpQueueDailyStats';
const JP_QUEUE_DAILY_MAX_DAYS = 60;
const JP_BADGE_COLOR = '#4299dc';

const JP_RELEASE_API_URL = 'https://api.github.com/repos/samuelffer/jetphotosplus/releases/latest';
const JP_RELEASE_CHECK_ALARM = 'jp-release-update-check';
const JP_RELEASE_CHECK_INTERVAL_MINUTES = 360; // uma consulta a cada seis horas
const JP_RELEASE_CHECK_INTERVAL_MS = JP_RELEASE_CHECK_INTERVAL_MINUTES * 60 * 1000;
const JP_RELEASE_INFO_KEY = 'jpLatestReleaseInfo';
const JP_RELEASE_CHECK_META_KEY = 'jpReleaseCheckMeta';

function parseSemver(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] ? match[4].split('.') : [] };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] > b[part] ? 1 : -1;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    if (a.prerelease[i] === b.prerelease[i]) continue;
    const an = /^\d+$/.test(a.prerelease[i]);
    const bn = /^\d+$/.test(b.prerelease[i]);
    if (an && bn) return Number(a.prerelease[i]) > Number(b.prerelease[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return a.prerelease[i] > b.prerelease[i] ? 1 : -1;
  }
  return 0;
}

async function checkForReleaseUpdate(force = false) {
  const manifest = JP_WEBEXT?.runtime?.getManifest?.();
  const installedVersion = manifest?.version;
  if (!installedVersion || !JP_WEBEXT?.storage?.local || typeof fetch !== 'function') return;

  const stored = await getStoredValue([JP_RELEASE_CHECK_META_KEY, JP_RELEASE_INFO_KEY]);
  const oldMeta = stored[JP_RELEASE_CHECK_META_KEY] || {};
  const now = Date.now();
  if (!force && now - Number(oldMeta.lastAttemptAtMs || 0) < JP_RELEASE_CHECK_INTERVAL_MS) return;

  // Registrar a tentativa antes da rede evita repetir consultas em um loop
  // caso o GitHub ou a conexão estejam indisponíveis.
  const meta = { ...oldMeta, lastAttemptAtMs: now };
  await setStoredValue({ [JP_RELEASE_CHECK_META_KEY]: meta });

  try {
    const headers = { Accept: 'application/vnd.github+json' };
    if (oldMeta.etag && oldMeta.lastSuccessfulCheckAtMs) headers['If-None-Match'] = oldMeta.etag;
    const response = await fetch(JP_RELEASE_API_URL, {
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit'
    });

    if (response.status === 304) {
      await setStoredValue({
        [JP_RELEASE_CHECK_META_KEY]: {
          ...meta,
          etag: oldMeta.etag || '',
          lastSuccessfulCheckAtMs: now
        }
      });
      return;
    }
    if (!response.ok) throw new Error(`GitHub API respondeu HTTP ${response.status}`);

    const release = await response.json();
    const tagName = String(release?.tag_name || '').trim();
    if (!parseSemver(tagName) || compareSemver(tagName, installedVersion) <= 0) {
      await setStoredValue({
        [JP_RELEASE_INFO_KEY]: null,
        [JP_RELEASE_CHECK_META_KEY]: {
          ...meta,
          etag: response.headers?.get?.('ETag') || '',
          lastSuccessfulCheckAtMs: now
        }
      });
      return;
    }

    const zipAsset = Array.isArray(release.assets)
      ? release.assets.find(asset => String(asset?.name || '').toLowerCase().endsWith('.zip'))
      : null;
    await setStoredValue({
      [JP_RELEASE_INFO_KEY]: {
        tagName,
        name: String(release.name || tagName),
        htmlUrl: String(release.html_url || 'https://github.com/samuelffer/jetphotosplus/releases/latest'),
        zipUrl: String(zipAsset?.browser_download_url || ''),
        publishedAt: String(release.published_at || '')
      },
      [JP_RELEASE_CHECK_META_KEY]: {
        ...meta,
        etag: response.headers?.get?.('ETag') || '',
        lastSuccessfulCheckAtMs: now
      }
    });
  } catch (error) {
    console.warn('[JetPhotos+] Não foi possível verificar atualizações agora:', error?.message || error);
  }
}

function ensureReleaseCheckAlarm() {
  try {
    const result = JP_WEBEXT?.alarms?.create?.(JP_RELEASE_CHECK_ALARM, {
      delayInMinutes: 2,
      periodInMinutes: JP_RELEASE_CHECK_INTERVAL_MINUTES
    });
    result?.catch?.(() => {});
  } catch (_) {
    // A verificação sob demanda na inicialização continua funcionando sem alarms.
  }
}

let queueCollectionInFlight = null;

function numFromText(value) {
  const n = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function dateLabelToKey(label) {
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const m = String(label).trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = months[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseQueuePage(html) {
  const text = stripHtml(html);
  const overallIdx = text.search(/OVERALL QUEUE STATUS/i);
  const overallText = overallIdx >= 0 ? text.slice(overallIdx) : text;

  const screenedMatch = overallText.match(/Total Screened:\s*([\d,]+)/i);
  const totalScreened = screenedMatch ? numFromText(screenedMatch[1]) : null;

  const queueMatch = overallText.match(/There are currently\s+([\d,]+)\s+total photos in the queue/i);
  const totalInQueue = queueMatch ? numFromText(queueMatch[1]) : null;

  const rowRegex = /(\d{1,2}\s+[A-Za-z]+\s+\d{4}):\s*([\d,]+)\s+total uploads\.\s*([\d,]+)\s+not yet screened\.\s*(\d+)\s+in screening\.\s*([\d,]+)\s+processed\./gi;
  const rows = [];
  let match;
  while ((match = rowRegex.exec(overallText)) !== null) {
    const key = dateLabelToKey(match[1]);
    if (!key) continue;
    rows.push({ key, totalUploads: numFromText(match[2]) });
  }

  const siteTodayKey = rows.reduce((latest, row) => {
    if (!latest || row.key > latest) return row.key;
    return latest;
  }, null);

  if (totalScreened == null || siteTodayKey == null) return null;
  return { totalScreened, totalInQueue, siteTodayKey };
}

function updateBadge(stats) {
  try {
    const keys = Object.keys(stats || {}).filter(key => key !== '__meta');
    const text = keys.length ? String(Math.min(keys.length, 99)) : '';
    const action = JP_WEBEXT?.action || JP_WEBEXT?.browserAction;
    action?.setBadgeText?.({ text });
    action?.setBadgeBackgroundColor?.({ color: JP_BADGE_COLOR });
    action?.setTitle?.({
      title: text
        ? `JetPhotos+ — ${text} dia${text === '1' ? '' : 's'} acompanhados`
        : 'JetPhotos+'
    });
  } catch (_) {}
}

function loadDailyStats() {
  return getStoredValue(JP_QUEUE_DAILY_KEY).then(result => result[JP_QUEUE_DAILY_KEY] || {});
}

function saveDailyStats(stats) {
  const keys = Object.keys(stats)
    .filter(key => key !== '__meta')
    .sort();
  const trimmed = {};
  keys.slice(-JP_QUEUE_DAILY_MAX_DAYS).forEach(key => {
    trimmed[key] = stats[key];
  });
  if (stats.__meta) trimmed.__meta = stats.__meta;

  return setStoredValue({ [JP_QUEUE_DAILY_KEY]: trimmed }).then(() => {
    updateBadge(trimmed);
    return trimmed;
  });
}

async function collectQueueStats() {
  if (queueCollectionInFlight) return queueCollectionInFlight;

  queueCollectionInFlight = (async () => {
    try {
      const response = await fetch(JP_QUEUE_URL, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`queue.php respondeu HTTP ${response.status}`);
      }

      const parsed = parseQueuePage(await response.text());
      if (!parsed) {
        throw new Error('Não foi possível extrair Total Screened/data da fila.');
      }

      const stats = await loadDailyStats();
      const now = Date.now();
      const currentKey = parsed.siteTodayKey;
      const previousKey = stats.__meta?.lastObservedDay || null;

      // Quando a data do JetPhotos avança, o maior valor que observamos do
      // dia anterior é fechado. Não inventamos valores para dias em que o
      // navegador ficou desligado.
      if (previousKey && currentKey > previousKey) {
        const previous = stats[previousKey];
        if (previous && previous.maxScreened != null) {
          previous.closed = true;
          previous.closedAtMs = now;
          previous.closeReason = 'site-day-changed';
        }
      }

      const current = stats[currentKey] || {
        maxScreened: 0,
        firstObservedAtMs: now,
        samples: 0,
        closed: false
      };

      // IMPORTANTE: Total Screened é a métrica usada pelo estimador original.
      // Não transformamos esse valor em delta nem criamos uma nova métrica
      // 'analyzed'. O dia acumula apenas o maior Total Screened observado.
      current.maxScreened = Math.max(current.maxScreened || 0, parsed.totalScreened);
      current.lastObserved = parsed.totalScreened;
      current.lastObservedAtMs = now;
      current.samples = (current.samples || 0) + 1;
      current.totalInQueue = parsed.totalInQueue;
      current.closed = false;
      stats[currentKey] = current;

      stats.__meta = {
        lastObservedDay: currentKey,
        lastObservedAtMs: now,
        lastScreened: parsed.totalScreened,
        lastTotalInQueue: parsed.totalInQueue,
        collectorVersion: 1
      };

      const saved = await saveDailyStats(stats);
      return {
        ok: true,
        day: currentKey,
        totalScreened: parsed.totalScreened,
        maxScreened: current.maxScreened,
        totalInQueue: parsed.totalInQueue,
        stats: saved
      };
    } catch (error) {
      console.warn('[JetPhotos+] Falha ao coletar queue.php:', error);
      return { ok: false, error: error?.message || String(error) };
    } finally {
      queueCollectionInFlight = null;
    }
  })();

  return queueCollectionInFlight;
}

function ensureQueueAlarm() {
  try {
    const result = JP_WEBEXT?.alarms?.create?.(JP_QUEUE_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: JP_QUEUE_POLL_MINUTES
    });
    result?.catch?.(() => {});
  } catch (_) {
    // Alguns hosts WebExtensions móveis não oferecem execução periódica.
    // A coleta imediata solicitada ao abrir queue.php continua disponível.
  }
}

JP_WEBEXT?.runtime?.onInstalled?.addListener(() => {
  ensureQueueAlarm();
  ensureReleaseCheckAlarm();
  loadDailyStats().then(updateBadge);
  collectQueueStats();
  checkForReleaseUpdate(true);
});

JP_WEBEXT?.runtime?.onStartup?.addListener(() => {
  ensureQueueAlarm();
  ensureReleaseCheckAlarm();
  loadDailyStats().then(updateBadge);
  checkForReleaseUpdate(false);
});

JP_WEBEXT?.alarms?.onAlarm?.addListener(alarm => {
  if (alarm.name === JP_QUEUE_ALARM) collectQueueStats();
  if (alarm.name === JP_RELEASE_CHECK_ALARM) checkForReleaseUpdate(false);
});

// queue.php pode pedir uma coleta imediata quando o painel é aberto.
JP_WEBEXT?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type === 'jp-collect-queue-now') {
    collectQueueStats().then(sendResponse);
    return true;
  }
});


loadDailyStats().then(updateBadge);
