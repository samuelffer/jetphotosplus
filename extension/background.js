// JetPhotos+ — Background service worker
//
// Também monitora automaticamente o contador "Total Screened" da fila.
// A coleta acontece em background para que o usuário não precise abrir
// queue.php todos os dias.

const JP_QUEUE_URL = 'https://www.jetphotos.com/members/queue.php';
const JP_QUEUE_ALARM = 'jp-queue-daily-tracker';
const JP_QUEUE_POLL_MINUTES = 10;
const JP_QUEUE_DAILY_KEY = 'jpQueueDailyStats';
const JP_QUEUE_DAILY_MAX_DAYS = 60;

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

function loadDailyStats() {
  return new Promise(resolve => {
    chrome.storage.local.get([JP_QUEUE_DAILY_KEY], result => {
      resolve(result[JP_QUEUE_DAILY_KEY] || {});
    });
  });
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

  return new Promise(resolve => {
    chrome.storage.local.set({ [JP_QUEUE_DAILY_KEY]: trimmed }, () => resolve(trimmed));
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
  chrome.alarms.create(JP_QUEUE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: JP_QUEUE_POLL_MINUTES
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureQueueAlarm();
  collectQueueStats();
});

chrome.runtime.onStartup.addListener(() => {
  ensureQueueAlarm();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === JP_QUEUE_ALARM) collectQueueStats();
});

// queue.php pode pedir uma coleta imediata quando o painel é aberto.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'jp-collect-queue-now') {
    collectQueueStats().then(sendResponse);
    return true;
  }
});

