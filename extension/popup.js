(() => {
  'use strict';
  const KEY = 'jpQueueDailyStats';
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n || 0).toLocaleString('pt-BR');

  function keysOf(stats) {
    return Object.keys(stats || {}).filter(k => k !== '__meta' && /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  }

  function analyzedFor(stats, key) {
    const item = stats[key] || {};
    return Number.isFinite(item.maxScreened) ? Math.max(0, item.maxScreened) : null;
  }

  function dateLabel(key) {
    const [y,m,d] = key.split('-');
    return `${d}/${m}/${y}`;
  }

  function drawChart(stats) {
    const svg = $('chart');
    const empty = $('chartEmpty');
    const wrap = $('chartWrap');
    const tooltip = $('tooltip');
    const keys = keysOf(stats);
    const series = keys.slice(-60).map(key => ({ key, value: analyzedFor(stats,key), today: key === keys[keys.length-1] })).filter(x => x.value != null);
    if (!series.length) {
      svg.innerHTML = '';
      svg.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    svg.style.display = 'block';
    empty.style.display = 'none';
    const W=360,H=145,pad={l:30,r:5,t:8,b:22},pw=W-pad.l-pad.r,ph=H-pad.t-pad.b;
    const max=Math.max(1,...series.map(x=>x.value));
    const ticks=4;
    const grid=Array.from({length:ticks+1},(_,i)=>{
      const v=Math.round(max*i/ticks), y=pad.t+ph-(v/max)*ph;
      return `<line class="grid" x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}"/><text class="axis" x="${pad.l-5}" y="${y+3}" text-anchor="end">${fmt(v)}</text>`;
    }).join('');
    const slot=pw/series.length, gap=series.length>35?1.5:4, bw=Math.max(2,slot-gap);
    const bars=series.map((x,i)=>{
      const h=(x.value/max)*ph, xx=pad.l+i*slot+gap/2, yy=pad.t+ph-h;
      return `<rect class="bar${x.today?' today':''}" data-index="${i}" x="${xx}" y="${yy}" width="${bw}" height="${Math.max(.8,h)}" rx="2"/>`;
    }).join('');
    const labelIdx=series.length<=10?series.map((_,i)=>i):[0,Math.floor((series.length-1)/2),series.length-1];
    const labels=labelIdx.map(i=>{const x=pad.l+i*slot+slot/2; const [y,m,d]=series[i].key.split('-'); return `<text class="axis" x="${x}" y="${H-6}" text-anchor="middle">${d}/${m}</text>`;}).join('');
    svg.innerHTML=grid+bars+labels;
    svg.querySelectorAll('.bar').forEach(bar=>{
      const show=()=>{
        const x=series[Number(bar.dataset.index)];
        tooltip.innerHTML=`<strong>${fmt(x.value)} fotos</strong>${dateLabel(x.key)}${x.today?' · hoje':''}`;
        tooltip.style.display='block';
        const r=wrap.getBoundingClientRect(), b=bar.getBoundingClientRect();
        tooltip.style.left=`${Math.max(3,Math.min(r.width-138,b.left-r.left+b.width/2-64))}px`;
        tooltip.style.top=`${Math.max(0,b.top-r.top-42)}px`;
      };
      bar.addEventListener('mouseenter',show); bar.addEventListener('mousemove',show); bar.addEventListener('mouseleave',()=>tooltip.style.display='none');
    });
  }

  function render(stats) {
    const keys = keysOf(stats);
    const todayKey = keys[keys.length-1];
    const today = todayKey ? analyzedFor(stats,todayKey) : null;
    const closed = keys.slice().reverse().filter(k=>k!==todayKey && stats[k]?.closed).slice(0,6).map(k=>analyzedFor(stats,k)).filter(v=>Number.isFinite(v) && v>0);
    const avg = closed.length ? Math.round(closed.reduce((a,b)=>a+b,0)/closed.length) : null;
    $('todayValue').textContent = today != null ? fmt(today) : '—';
    $('averageValue').textContent = avg != null ? fmt(avg) : '—';
    $('queueValue').textContent = Number.isFinite(stats?.__meta?.lastTotalInQueue) ? fmt(stats.__meta.lastTotalInQueue) : '—';
    $('trackedBadge').textContent = `${keys.length}d`;
    $('chartRange').textContent = keys.length ? `${keys.length} dias` : 'sem dados';
    $('lastUpdate').textContent = stats?.__meta?.lastObservedAtMs ? `Última coleta: ${new Date(stats.__meta.lastObservedAtMs).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` : 'Última coleta: —';
    drawChart(stats);
  }

  function getStats() {
    return new Promise(resolve => chrome.storage.local.get([KEY], r => resolve(r[KEY] || {})));
  }

  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`jetphotos-plus-history-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  $('exportBtn').addEventListener('click', async () => {
    const stats = await getStats();
    downloadJson({ format:'JetPhotos+', type:'queue-history', version:2, exportedAt:new Date().toISOString(), history:stats });
    $('message').textContent='Histórico exportado.';
  });

  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async e => {
    const file=e.target.files?.[0]; if(!file) return;
    try {
      const payload=JSON.parse(await file.text());
      const imported=payload?.history;
      if(!imported || typeof imported!=='object') throw new Error('Arquivo inválido.');
      const current=await getStats();
      const merged={...current};
      const keys=Object.keys(imported).filter(k=>k!=='__meta' && /^\d{4}-\d{2}-\d{2}$/.test(k));
      for(const key of keys) merged[key]=imported[key];
      // O histórico diário é mesclado, mas o estado do coletor atual não
      // pode voltar no tempo por causa de um backup antigo.
      if(imported.__meta) {
        const currentAt=Number(current.__meta?.lastObservedAtMs || 0);
        const importedAt=Number(imported.__meta?.lastObservedAtMs || 0);
        merged.__meta = importedAt > currentAt
          ? { ...(current.__meta || {}), ...imported.__meta }
          : (current.__meta || imported.__meta);
      }
      const trimmedKeys=Object.keys(merged).filter(k=>k!=='__meta' && /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      for(const oldKey of trimmedKeys.slice(0, Math.max(0, trimmedKeys.length-60))) delete merged[oldKey];
      await new Promise(resolve=>chrome.storage.local.set({[KEY]:merged},resolve));
      try { chrome.action.setBadgeText({text:String(Math.min(Object.keys(merged).filter(k=>k!=='__meta').length,99))}); chrome.action.setBadgeBackgroundColor({color:'#4299dc'}); } catch (_) {}
      render(merged);
      $('message').textContent=`Histórico importado: ${keys.length} dias.`;
    } catch(err) { $('message').textContent=`Falha ao importar: ${err.message || err}`; }
    e.target.value='';
  });

  $('queueBtn').addEventListener('click', () => chrome.tabs.create({url:'https://www.jetphotos.com/members/queue.php'}));
  getStats().then(render);
})();
