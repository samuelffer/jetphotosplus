/*
 * JetPhotos+
 * -----------------------------------
 * Criado por: Samuel Ferreira
 * Objetivo: ajudar a curtir manualmente (com um clique) as fotos que ainda
 * faltam curtir no perfil de um fotógrafo no JetPhotos — útil para grupos
 * de spotting cuja regra é "curtir todas as fotos dos membros".
 *
 * Importante: este script NÃO curte nada sozinho em segundo plano. Ele só
 * facilita a ação quando VOCÊ clica no botão "Curtir faltantes desta página",
 * dentro da sua própria sessão logada no navegador.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // CONFIG: seletores possíveis do botão de Like e de estado "já curtido".
  // O JetPhotos costuma usar um link com ícone thumbs-up. Depois de
  // curtido, normalmente troca de ícone/classe. Se a detecção não bater
  // 100% no seu login, me avise (inspecionar elemento do botão já
  // curtido) que eu ajusto os seletores/hints abaixo.
  // ---------------------------------------------------------------------
  const LIKED_HINTS = ['liked', 'is-liked', 'thumbs-up-blue', 'thumbs-up-filled', 'unlike'];

  // ---------------------------------------------------------------------
  // Injeta o hook de rede (content-hook.js) no MUNDO DA PÁGINA. Precisa ser
  // uma <script src> porque cada mundo (isolado vs. página) tem seu próprio
  // window.fetch/XHR — sem isso não dá pra saber se um like realmente teve
  // sucesso no servidor. Feito via tag em vez de "world":"MAIN" no manifest
  // pra manter compatibilidade com versões mais antigas do Firefox.
  // ---------------------------------------------------------------------
  function injectNetworkHook() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content-hook.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.error('[JetPhotos+] Falha ao injetar o hook de rede (a sincronia de likes fica limitada ao que o próprio site mostrar no DOM):', error);
    }
  }
  injectNetworkHook();

  // Chaves usadas no chrome.storage.local para lembrar as preferências
  // do usuário entre sessões/páginas.
  const STORAGE_KEY_SITE_DARK_MODE = 'jpSiteDarkMode'; // boolean, padrão false (EXPERIMENTAL)
  const STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED = 'jpQueueEstimatorEnabled'; // boolean, padrão true (EXPERIMENTAL)
  const STORAGE_KEY_LANGUAGE = 'jpLanguage'; // 'pt-BR' | 'en'
  const STORAGE_KEY_WIDGET_COLLAPSED = 'jpLikeWidgetCollapsed'; // boolean, padrão false

  // ---------------------------------------------------------------------
  // Preload anti-FOUC: evita o "flash" do tema claro original do JetPhotos
  // ao trocar de página com o modo escuro do site ligado.
  //
  // Antes, o content.js só rodava em "document_idle" (depois que a página
  // já tinha sido pintada no tema claro) e só então lia o storage e
  // aplicava applySiteDarkMode() — daí o flash. Agora o manifest.json roda
  // o script em "document_start" (o mais cedo possível) e, aqui em cima,
  // fazemos uma checagem rápida e isolada: se o modo escuro estiver ligado,
  // escondemos a página (fundo escuro neutro + body invisível) até o
  // restante do script (init() -> applySiteDarkMode()) terminar a primeira
  // recolorização. Um timeout de segurança garante que a página nunca
  // fique escondida por muito tempo, mesmo se algo falhar.
  // ---------------------------------------------------------------------
  const PRELOAD_HIDE_CLASS = 'jp-dark-preload-hide';
  const PRELOAD_HIDE_STYLE_ID = 'jp-dark-preload-style';
  const PRELOAD_SAFETY_MS = 500;
  let preloadHideRemoved = false;

  function injectPreloadHideStyle() {
    if (document.getElementById(PRELOAD_HIDE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PRELOAD_HIDE_STYLE_ID;
    style.textContent = `
      html.${PRELOAD_HIDE_CLASS} { background: #202124 !important; }
      html.${PRELOAD_HIDE_CLASS} body { visibility: hidden !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // Chamado depois que applySiteDarkMode() já rodou a primeira recolorização
  // (ou pelo timeout de segurança). Idempotente: pode ser chamado mais de
  // uma vez sem problema.
  function removePreloadHide() {
    if (preloadHideRemoved) return;
    preloadHideRemoved = true;
    document.documentElement.classList.remove(PRELOAD_HIDE_CLASS);
    const style = document.getElementById(PRELOAD_HIDE_STYLE_ID);
    if (style) style.remove();
  }

  (function preloadDarkModeCheck() {
    try {
      if (!isExtensionContextAlive()) return;
      chrome.storage.local.get([STORAGE_KEY_SITE_DARK_MODE], (result) => {
        if (chrome.runtime.lastError) return;
        if (result[STORAGE_KEY_SITE_DARK_MODE] === true) {
          injectPreloadHideStyle();
          document.documentElement.classList.add(PRELOAD_HIDE_CLASS);
        }
      });
    } catch (err) {
      if (!isContextInvalidatedError(err)) throw err;
    }
    // Rede de segurança: nunca deixa a página escondida por mais que isso,
    // mesmo se o storage.get() nunca responder ou o init() falhar.
    setTimeout(removePreloadHide, PRELOAD_SAFETY_MS);
  })();

  const I18N = {
    'pt-BR': {
      settings: 'Configurações', close: 'Fechar', minimize: 'Minimizar', expand: 'Expandir',
      viewReleases: 'Ver novidades', reportIssue: 'Reportar um problema', aboutJetPhotosPlus: 'Sobre o JetPhotos+',
      analyzing: 'Analisando página...',
      likeMissing: 'Curtir faltantes',
      noneFound: 'Nenhuma foto encontrada ainda (aguardando carregar)...',
      missing: 'faltando', liked: 'já curtidas',
      experimental: 'Experimental',
      siteDarkMode: 'Modo escuro (beta)',
      siteDarkModeHelp: 'Escurece o JetPhotos e também a interface da extensão (painel, submenu e widget). Fotos e cores de marca não são alteradas.',
      queueEstimator: 'Estimador de dias na fila (beta)',
      queueEstimatorHelp: 'Estimativa de quanto falta pra sua foto ser avaliada, em queue.php. Requer recarregar a página após mudar.',
      language: 'Idioma',
      languageHelp: 'Escolha o idioma da extensão.',
      portugueseBrazil: 'Português (Brasil)', english: 'English',
      queueEstimate: 'Estimativa da fila JetPhotos+',
      likeWidgetLabel: 'JETPHOTOS+ · Likes',
      screenedToday: 'Analisadas hoje:',
      dailyAverage: 'Média diária:',
      estimatedQueueTime: 'Tempo estimado:',
      lastCollection: 'Última coleta:',
      collectingHistory: 'Coletando...',
      noHistoryNote: 'A média será calculada após o primeiro dia concluído.',
      avgClosed: (n) => `Média dos últimos ${n} dia${n === 1 ? '' : 's'} concluído${n === 1 ? '' : 's'}`,
      collectNow: 'Coletar agora', collecting: 'Coletando...',
      noPhotosQueue: 'Nenhuma foto sua na fila no momento.',
      photosAhead: (n, eta) => `${n.toLocaleString('pt-BR')} fotos à frente — ${eta}`,
      noRate: 'sem dados de ritmo ainda',
      queueReadError: 'Não consegui ler os dados da fila nesta página.',
      buildingHistory: 'Ainda estou construindo o histórico automático do ritmo da fila. Por enquanto, uso o maior Total Screened observado hoje; depois de alguns dias, passo a usar a média dos dias fechados.',
      rateToday: 'maior Total Screened observado hoje',
      rateClosed: (n) => `média dos últimos ${n} dia${n === 1 ? '' : 's'} fechados`,
      ratePeriod: 'Total Screened de hoje (ainda calibrando histórico)',
      rateSnapshot: (n) => `${n} dia${n === 1 ? '' : 's'} de fila acompanhados`,
      rateFallback: 'estimativa provisória enquanto calibro',
      currentRate: (n, basis) => `Ritmo atual: <b>~${Math.round(n).toLocaleString('pt-BR')} fotos/dia</b>${basis ? ` (${basis})` : ''}`,
      generalEta: (eta) => `Estimativa geral de dias em espera: <b>${eta}</b>`,
      queueTotal: (n) => `Fila total no site: ${n.toLocaleString('pt-BR')} fotos.`,
      timezoneAhead: (n) => ` Fuso do site ${Math.abs(n)} dia(s) à frente do seu computador.`,
      timezoneBehind: (n) => ` Fuso do site ${Math.abs(n)} dia(s) atrás do seu computador.`,
      aroundDate: 'por volta de',
      historyChart: 'Ritmo diário da fila',
      historyChartHint: 'Fotos analisadas por dia. Passe o mouse para ver os dados.',
      historyNoData: 'Ainda não há dias suficientes para montar o gráfico.',
      trackedDays: (n) => `${n} dia${n === 1 ? '' : 's'} acompanhado${n === 1 ? '' : 's'}`,
    },
    en: {
      settings: 'Settings', close: 'Close', minimize: 'Minimize', expand: 'Expand', viewReleases: "See what's new", reportIssue: 'Report an issue', aboutJetPhotosPlus: 'About JetPhotos+', analyzing: 'Analyzing page...',
      likeMissing: 'Like missing photos',
      noneFound: 'No photos found yet (waiting for the page to load)...',
      missing: 'missing', liked: 'already liked',
      experimental: 'Experimental', siteDarkMode: 'Site dark mode (beta)', siteDarkModeHelp: 'Darkens JetPhotos backgrounds and light text. Photos and brand colors are not changed.',
      queueEstimator: 'Queue days estimator (beta)', queueEstimatorHelp: 'Estimates how long your photo may take to be reviewed on queue.php. Reload the page after changing.',
      language: 'Language', languageHelp: 'Choose the extension language.', portugueseBrazil: 'Português (Brasil)', english: 'English',
      queueEstimate: 'Queue estimate', likeWidgetLabel: 'JETPHOTOS+ · Likes', screenedToday: 'Screened today:', dailyAverage: 'Daily average:', estimatedQueueTime: 'Estimated time:', lastCollection: 'Last collection:',
      collectingHistory: 'Collecting...', noHistoryNote: 'The average will be calculated after the first completed day.',
      avgClosed: (n) => `Average of the last ${n} completed day${n === 1 ? '' : 's'}`,
      collectNow: 'Collect now', collecting: 'Collecting...', noPhotosQueue: 'You have no photos in the queue right now.',
      photosAhead: (n, eta) => `${n.toLocaleString('en-US')} photos ahead — ${eta}`, noRate: 'no queue rate data yet',
      queueReadError: 'I could not read the queue data on this page.',
      buildingHistory: "I’m still building the automatic queue-rate history. For now, I use the highest Total Screened observed today; after a few days, I’ll use the average of completed days.",
      rateToday: 'highest Total Screened observed today', rateClosed: (n) => `average of the last ${n} completed day${n === 1 ? '' : 's'}`,
      ratePeriod: "today's Total Screened (history still calibrating)", rateSnapshot: (n) => `${n} tracked queue day${n === 1 ? '' : 's'}`, rateFallback: 'provisional estimate while calibrating',
      currentRate: (n, basis) => `Current rate: <b>~${Math.round(n).toLocaleString('en-US')} photos/day</b>${basis ? ` (${basis})` : ''}`,
      generalEta: (eta) => `General waiting estimate: <b>${eta}</b>`, queueTotal: (n) => `Total site queue: ${n.toLocaleString('en-US')} photos.`,
      timezoneAhead: (n) => ` Site time is ${Math.abs(n)} day(s) ahead of your computer.`, timezoneBehind: (n) => ` Site time is ${Math.abs(n)} day(s) behind your computer.`, aroundDate: 'around',
      historyChart: 'Daily queue pace',
      historyChartHint: 'Photos reviewed per day. Hover a point for details.',
      historyNoData: 'Not enough tracked days to build the chart yet.',
      trackedDays: (n) => `${n} tracked day${n === 1 ? '' : 's'}`,
    }
  };

  function t(key, ...args) {
    const lang = currentSettings?.language === 'en' ? 'en' : 'pt-BR';
    const value = I18N[lang][key] ?? I18N['pt-BR'][key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
  }

  const STORAGE_KEY_QUEUE_DAILY_STATS = 'jpQueueDailyStats';
  const QUEUE_RATE_SAMPLE_DAYS = 6;
  const QUEUE_CHART_MAX_DAYS = 60;


  // A página pode manter um content script antigo vivo depois que a extensão
  // é recarregada durante o desenvolvimento. Nesse estado, qualquer acesso à
  // API da extensão pode lançar "Extension context invalidated".
  function isExtensionContextAlive() {
    try { return Boolean(chrome && chrome.runtime && chrome.runtime.id); }
    catch (_) { return false; }
  }

  function isContextInvalidatedError(error) {
    return /Extension context invalidated/i.test(String(error?.message || error || ''));
  }

  function isAlreadyLiked(likeAnchor, card) {
    if (!likeAnchor) return false;

    // O JetPhotos atualmente representa o estado de curtida no próprio
    // <a class="social__link social__link--like">. Quando a foto já está
    // curtida, ele adiciona a classe "social__link--active". O ícone
    // thumbs-up-black.svg continua igual nos dois estados, então o src do
    // <img> não deve ser usado para diferenciar Like/Unlike.
    if (likeAnchor.classList?.contains('social__link--active')) return true;

    // Mantém compatibilidade com versões/variações antigas do JetPhotos.
    const ariaPressed = likeAnchor.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    const dataLiked = likeAnchor.getAttribute('data-liked');
    if (dataLiked === 'true' || dataLiked === '1') return true;

    const html = likeAnchor.outerHTML.toLowerCase();
    if (LIKED_HINTS.some(hint => html.includes(hint))) return true;

    // Bug visual conhecido do JetPhotos: o like é salvo no servidor mas o
    // próprio HTML às vezes não reflete isso (nem na hora, nem depois de um
    // F5). Nossa cache local (ver bloco "Sincronia de likes" abaixo) só tem
    // uma entrada quando o servidor CONFIRMOU sucesso, então é seguro usá-la
    // como fonte de verdade extra e corrigir o ícone na hora.
    const photoId = getPhotoId(likeAnchor, card);
    if (photoId && isPhotoLikedInCache(photoId)) {
      forceLikedVisual(likeAnchor);
      return true;
    }

    return false;
  }

  // =======================================================================
  // SINCRONIA DE LIKES — corrige o bug visual do JetPhotos e garante que
  // o estado "curtido" sobrevive a um F5, tanto pra cliques da extensão
  // quanto pra cliques manuais do usuário.
  //
  // Descoberta-chave (via DevTools): o like/unlike do JetPhotos é uma
  // única requisição XHR pro endpoint
  //   PostHandler.php?addFavorite=<ID>&doAjax=true    (curtir)
  //   PostHandler.php?removeFavorite=<ID>&doAjax=true (descurtir)
  // e <ID> é EXATAMENTE o mesmo número que já aparece no HTML em
  // data-photo="<ID>" (card) / data-id="<ID>" (wrapper .social). Ou seja,
  // não precisamos mais adivinhar qual clique corresponde a qual resposta
  // (nada de fila/FIFO): a própria URL da requisição já entrega o ID da
  // foto, e a gente casa direto com o elemento certo na página.
  //
  // Fluxo:
  //   1. content-hook.js (mundo da página) intercepta fetch/XHR, extrai
  //      {id, action} da URL e confirma sucesso lendo a resposta (o
  //      PostHandler retorna o texto "true"/"false"), avisando o
  //      content.js via CustomEvent('jpplus-like-net-result').
  //   2. Aqui a gente só reage ao evento: se foi "add" e o servidor
  //      confirmou, persiste o ID no cache local e força a classe que o
  //      próprio JetPhotos usa pra pintar o ícone/rótulo de curtido
  //      (".social__link--active") — a CSS do site já sabe estilizar isso
  //      em qualquer tema, então não reinventamos cor. Se for "remove"
  //      confirmado (o usuário descurtiu manualmente), fazemos o inverso.
  //      Se o servidor não confirmar (falha real), NADA muda — a foto
  //      continua "faltante" e será re-tentada normalmente.
  // =======================================================================

  const LIKE_CACHE_KEY = 'jpPlusLikedPhotoIds_v1';
  const LIKE_CACHE_MAX = 20000; // teto de segurança pra não crescer sem fim em contas com muitos likes
  let likeCache = null; // carregada 1x sob demanda e mantida em memória

  function loadLikeCache() {
    try {
      const raw = localStorage.getItem(LIKE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (_) {
      return {}; // localStorage corrompido/bloqueado (ex: modo privado) — segue sem cache, sem quebrar nada
    }
  }

  function getLikeCache() {
    if (!likeCache) likeCache = loadLikeCache();
    return likeCache;
  }

  function saveLikeCache() {
    try {
      const cache = getLikeCache();
      const keys = Object.keys(cache);
      if (keys.length > LIKE_CACHE_MAX) {
        // Poda as entradas mais antigas (menor timestamp), preservando as
        // curtidas mais recentes. São só IDs numéricos (chave) + timestamp
        // (valor), então mesmo 20 mil entradas ocupam poucos KB — não pesa
        // no navegador mesmo curtindo centenas/milhares de fotos.
        keys.sort((a, b) => cache[a] - cache[b]);
        keys.slice(0, keys.length - LIKE_CACHE_MAX).forEach(k => delete cache[k]);
      }
      localStorage.setItem(LIKE_CACHE_KEY, JSON.stringify(cache));
    } catch (_) { /* quota cheia ou storage bloqueado: falha silenciosa, não é crítico */ }
  }

  function isPhotoLikedInCache(photoId) {
    return Boolean(photoId) && Boolean(getLikeCache()[photoId]);
  }

  function markPhotoLikedInCache(photoId) {
    if (!photoId) return;
    const cache = getLikeCache();
    if (cache[photoId]) return; // já registrada, evita parse/write à toa
    cache[photoId] = Date.now();
    saveLikeCache();
  }

  function unmarkPhotoLikedInCache(photoId) {
    if (!photoId || !(photoId in getLikeCache())) return;
    delete likeCache[photoId];
    saveLikeCache();
  }

  // Extrai o ID da foto a partir do card/âncora. Prioriza os atributos
  // data-photo/data-id (o mesmo valor usado nas URLs addFavorite/
  // removeFavorite — ver bloco acima), com um fallback pro link /photo/<id>
  // caso algum layout não tenha esses atributos.
  function getPhotoId(anchor, card) {
    // Seletor restrito de propósito: NÃO usa "[data-id]" genérico. Um
    // seletor genérico faria closest() poder subir a árvore e casar com o
    // data-id de um componente qualquer alheio à foto (carrossel, anúncio,
    // widget de terceiros) em algum layout diferente do padrão de busca —
    // aí a foto ficaria associada a um ID errado, e se esse ID já existisse
    // no cache de likes (por pertencer de verdade a OUTRA foto), a extensão
    // mostraria essa foto como "curtida" sem realmente estar. Por isso só
    // aceita os dois contêineres que o próprio JetPhotos usa de fato pra
    // essa informação: o card (".result[data-photo]") e o wrapper dos
    // links Album/Like/Share (".social[data-id]").
    const withData = (card || anchor)?.closest?.('.result[data-photo], .social[data-id]');
    const fromData = withData?.dataset?.photo || withData?.dataset?.id;
    if (fromData) return String(fromData);

    const scope = card || anchor;
    const photoLink = scope?.querySelector?.('a[href*="/photo/"]');
    const fromHref = photoLink?.getAttribute('href')?.match(/\/photo\/(\d+)/);
    if (fromHref) return fromHref[1];

    return null;
  }

  function forceLikedVisual(anchor) {
    if (!anchor || anchor.classList.contains('social__link--active')) return;
    anchor.classList.add('social__link--active');
    anchor.setAttribute('aria-pressed', 'true');
  }

  function revokeLikedVisual(anchor) {
    if (!anchor) return;
    anchor.classList.remove('social__link--active');
    anchor.removeAttribute('aria-pressed');
  }

  // Aplica o estado confirmado (liked/unliked) direto nos elementos dessa
  // foto, sem varrer a página inteira: mira pelo data-photo/data-id, que é
  // o mesmo ID da resposta de rede. Isso importa porque esta função roda a
  // cada confirmação — durante uma leva em massa, o findPhotoCards()
  // completo aqui dentro significava N varreduras (era parte da lentidão
  // no celular). O querySelectorAll cobre o caso raro da mesma foto
  // aparecer 2x na mesma página. Fotos sem data-photo/data-id (só
  // detectáveis pelo fallback de href) não são pegas aqui, mas o
  // refresh() periódico corrige elas normalmente.
  function syncPhotoVisualById(photoId, liked) {
    if (!photoId) return;
    const id = CSS.escape(String(photoId));
    document.querySelectorAll(`.result[data-photo="${id}"], .social[data-id="${id}"]`).forEach(scope => {
      const img = scope.querySelector('img[alt="Like"], img[title="Like"]');
      const anchor = img?.closest('a');
      // O closest() pode subir pra fora do scope se o img não estiver num
      // link — nesse caso a âncora não é o Like desta foto, então pula.
      if (anchor && scope.contains(anchor)) {
        if (liked) forceLikedVisual(anchor); else revokeLikedVisual(anchor);
      }
      scope.querySelectorAll('.' + MOBILE_LIKE_BTN_CLASS).forEach(btn => applyMobileButtonState(btn, liked));
    });
  }

  function handleLikeNetResult(event) {
    const { id, action, ok } = event.detail || {};
    if (!id || !action) return; // sem ID/ação reconhecidos: não dá pra casar com nenhuma foto

    if (ok) {
      if (action === 'add') {
        markPhotoLikedInCache(id);
        syncPhotoVisualById(id, true);
      } else if (action === 'remove') {
        unmarkPhotoLikedInCache(id);
        syncPhotoVisualById(id, false);
      }
    } else {
      // O servidor recusou (ou a rede falhou): desfaz a UI otimista que o
      // toque aplicou na hora — sem isso o joinha ficaria "curtido" pra
      // sempre numa foto que na verdade não foi curtida.
      if (action === 'add') {
        unmarkPhotoLikedInCache(id);
        syncPhotoVisualById(id, false);
      } else if (action === 'remove') {
        markPhotoLikedInCache(id);
        syncPhotoVisualById(id, true);
      }
    }

    // Num clique avulso, atualiza contador/realce na hora, sem esperar o
    // debounce. Durante a leva em massa o refresh() se auto-pula (ver
    // refresh) e o settle acontece uma vez só no final — sem isso seriam N
    // varreduras completas do DOM, uma por foto, que é o que travava o
    // celular.
    refresh();
  }

  let likeSyncWired = false;
  function wireLikeSync() {
    if (likeSyncWired) return;
    likeSyncWired = true;
    window.addEventListener('jpplus-like-net-result', handleLikeNetResult);
  }

  // Detecta em qual página estamos pra mostrar um rótulo de contexto no
  // painel. A detecção de fotos (findPhotoCards) já é genérica o bastante
  // pra funcionar em qualquer uma delas sem mudar nada — mudei só o rótulo.
  function getPageContextLabel() {
    const path = location.pathname;
    if (path.startsWith('/members/queue.php')) return currentSettings?.language === 'en' ? 'Queue status' : 'Fila de avaliação';
    if (path.startsWith('/photographer')) return currentSettings?.language === 'en' ? 'Photographer profile' : 'Perfil do fotógrafo';
    if (path.startsWith('/new')) return currentSettings?.language === 'en' ? 'Recent photos' : 'Fotos recentes';
    if (path.startsWith('/showphotos.php')) return currentSettings?.language === 'en' ? 'Search results' : 'Resultados de busca';
    if (path.startsWith('/top')) return currentSettings?.language === 'en' ? 'Most popular today' : 'Mais populares hoje';
    if (/^\/photo\/\d+/.test(path)) return currentSettings?.language === 'en' ? 'Individual photo' : 'Foto individual';
    if (path === '/photo' || path.startsWith('/photo?')) return currentSettings?.language === 'en' ? 'New registrations' : 'Novos registros';
    if (/^\/group\/\d+\/photos/.test(path)) return currentSettings?.language === 'en' ? 'Group photos' : 'Fotos do grupo';
    return null;
  }

  function findPhotoCards() {
    // Cada foto no listing tem um bloco com a imagem + os links Album/Like/Share.
    // Usamos o ícone "Like" como âncora e subimos até o container do card.
    // O Set evita contar duas vezes a mesma âncora caso o JetPhotos tenha
    // mais de um elemento visual apontando para o mesmo Like.
    const likeImgs = document.querySelectorAll('img[alt="Like"], img[title="Like"]');
    const cards = [];
    const seenAnchors = new Set();
    const seenPhotoIds = new Set();
    likeImgs.forEach(img => {
      const anchor = img.closest('a');
      if (!anchor || seenAnchors.has(anchor)) return;
      seenAnchors.add(anchor);

      // O JetPhotos renderiza os dois layouts (desktop e mobile) no mesmo
      // HTML e alterna qual aparece via classe (".desktop-only"/".mobile-only"),
      // escondendo o outro com display:none — não removendo do DOM. Então,
      // dentro desses wrappers, um elemento "invisível" ainda é o link de
      // Like de verdade (só escondido pelo breakpoint atual), e clicar nele
      // via JS continua funcionando normalmente. Só filtramos por
      // visibilidade fora desse caso, pra não contar templates/lixo de DOM.
      const insideResponsiveToggle = !!anchor.closest('.desktop-only, .mobile-only');
      if (!insideResponsiveToggle) {
        const rect = anchor.getBoundingClientRect();
        const style = getComputedStyle(anchor);
        if (rect.width === 0 && rect.height === 0) return;
        if (style.display === 'none' || style.visibility === 'hidden') return;
      }

      const card = anchor.closest('div, li') || anchor.parentElement;
      cards.push({ anchor, card });
      const photoId = getPhotoId(anchor, card);
      if (photoId) seenPhotoIds.add(photoId);
    });

    // Botão de Like injetado pro layout mobile (ver injectMobileLikeButtons):
    // conta como âncora própria — é assim que "Curtir faltantes" e o
    // contador do widget passam a enxergar essas fotos também. Só pula se
    // já existir um link nativo detectado pra essa mesma foto acima (evita
    // duplicar caso a página tenha acabado de trocar de layout, ex. uma
    // janela sendo redimensionada em tempo real).
    document.querySelectorAll('.' + MOBILE_LIKE_BTN_CLASS).forEach(btn => {
      if (seenAnchors.has(btn)) return;
      const card = btn.closest('.result[data-photo]') || btn.parentElement;
      const photoId = getPhotoId(btn, card);
      if (photoId && seenPhotoIds.has(photoId)) return; // já coberto pelo link nativo
      seenAnchors.add(btn);
      cards.push({ anchor: btn, card });
    });

    return cards;
  }

  // =======================================================================
  // LIKE NO LAYOUT MOBILE — abaixo de um certo breakpoint de largura, o
  // JetPhotos esconde o link de Like inteiro (fica só a contagem em
  // estrela, sem ação nenhuma) via a classe ".desktop-only" citada acima.
  // O elemento continua no DOM, então em vez de reinventar a requisição a
  // gente injeta um botão visível em ".result__stats" que só REPASSA o
  // clique pro link nativo escondido — o content-hook.js confirma a
  // requisição exatamente como já fazia no desktop, sem sistema paralelo.
  // Só cai num fallback de requisição própria (performLikeRequest) se por
  // algum motivo o link nativo não existir de fato nesse card.
  // =======================================================================

  const MOBILE_LIKE_STAT_CLASS = 'jp-mobile-like-stat';
  const MOBILE_LIKE_BTN_CLASS = 'jp-mobile-like-btn';
  const MOBILE_LIKE_BTN_LIKED_CLASS = 'jp-mobile-like-btn--liked';
  const MOBILE_LIKE_ICON_URL = 'https://www.jetphotos.com/assets/img/thumbs-up-black.svg';

  // Confirma sucesso pelo TEXTO da resposta ("true"/"false" ou JSON), não só
  // pelo status HTTP — mesmo critério do content-hook.js (ver comentário lá
  // sobre por que o 200 sozinho não basta). Só é usado no fallback abaixo.
  function parseLikeSuccessText(bodyText, httpOk) {
    if (typeof bodyText === 'string' && bodyText.trim()) {
      const trimmed = bodyText.trim().toLowerCase();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      try {
        const json = JSON.parse(trimmed);
        if (typeof json === 'boolean') return json;
        if (json && typeof json.success === 'boolean') return json.success;
        if (json && typeof json.ok === 'boolean') return json.ok;
      } catch (_) { /* não é JSON, cai no fallback do status abaixo */ }
    }
    return httpOk;
  }

  // Fallback: só roda se o card não tiver NENHUM link nativo de Like (nem
  // escondido). Dispara a mesma requisição que o site faria.
  async function performLikeRequest(photoId, action) {
    const param = action === 'remove' ? 'removeFavorite' : 'addFavorite';
    const url = `${location.origin}/PostHandler.php?${param}=${encodeURIComponent(photoId)}&doAjax=true`;
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      const text = await res.text().catch(() => '');
      return parseLikeSuccessText(text, res.ok);
    } catch (_) {
      return false; // falha de rede: não conta como curtida, igual ao fluxo desktop
    }
  }

  function applyMobileButtonState(button, liked) {
    button.classList.toggle(MOBILE_LIKE_BTN_LIKED_CLASS, liked);
    button.setAttribute('aria-pressed', liked ? 'true' : 'false');
  }

  const MOBILE_LIKE_BTN_POP_CLASS = 'jp-mobile-like-btn--pop';

  // Dispara o pop do joinha (ver CSS jpLikePop). Remove e readiciona a
  // classe com um reflow forçado no meio pra animação reiniciar mesmo se o
  // usuário curtir/descurtir/curtir rápido em sequência.
  function popMobileButton(button) {
    button.classList.remove(MOBILE_LIKE_BTN_POP_CLASS);
    void button.offsetWidth;
    button.classList.add(MOBILE_LIKE_BTN_POP_CLASS);
  }

  async function handleMobileLikeClick(button, photoId, nativeAnchor) {
    if (button.disabled) return; // evita duplo-toque disparar duas requisições
    button.disabled = true;
    button.classList.add('jp-mobile-like-btn--pending');

    // UI otimista: o joinha acende NA HORA do toque, sem esperar a resposta
    // do servidor (no celular essa confirmação demora e o botão parecia
    // "morto"). Se o servidor recusar, o evento de rede (!ok) desfaz tudo
    // em handleLikeNetResult — ver comentário lá.
    const willLike = !button.classList.contains(MOBILE_LIKE_BTN_LIKED_CLASS);
    applyMobileButtonState(button, willLike);
    if (willLike) popMobileButton(button);

    if (nativeAnchor) {
      // Aciona o link nativo do JetPhotos (existe no DOM, só escondido pelo
      // layout mobile). O content-hook.js confirma via rede e
      // handleLikeNetResult já cuida do cache + realce + contador — aqui só
      // reabilitamos o botão depois de uma janela curta anti-duplo-toque.
      nativeAnchor.click();
      setTimeout(() => {
        button.disabled = false;
        button.classList.remove('jp-mobile-like-btn--pending');
      }, 300);
      return;
    }

    // Sem link nativo disponível nesse card (não deveria acontecer no
    // layout atual do site, mas evita deixar o botão sem função caso o
    // JetPhotos mude a estrutura): usa o mesmo endpoint diretamente.
    const action = willLike ? 'add' : 'remove';
    const ok = await performLikeRequest(photoId, action);
    button.disabled = false;
    button.classList.remove('jp-mobile-like-btn--pending');
    if (!ok) {
      applyMobileButtonState(button, !willLike); // desfaz o otimismo
      return;
    }
    if (action === 'add') markPhotoLikedInCache(photoId); else unmarkPhotoLikedInCache(photoId);
    if (!isLiking) refresh(); // durante a leva em massa o refresh final cobre tudo
  }

  // Varre os cards e injeta o botão como último ".result__stat" só onde o
  // layout atual não mostra nenhum controle de Like visível. Idempotente:
  // já sai se o botão já existir ali, então pode rodar a cada refresh().
  function injectMobileLikeButtons() {
    document.querySelectorAll('.result[data-photo]').forEach(card => {
      if (card.classList.contains('result--adv')) return; // pula anúncios

      const nativeImg = card.querySelector('img[alt="Like"], img[title="Like"]');
      const nativeAnchor = nativeImg?.closest('a') || null;
      const nativeVisible = !!nativeAnchor && (() => {
        const rect = nativeAnchor.getBoundingClientRect();
        return !(rect.width === 0 && rect.height === 0) && getComputedStyle(nativeAnchor).display !== 'none';
      })();

      const existingStat = card.querySelector('.' + MOBILE_LIKE_STAT_CLASS);
      if (nativeVisible) {
        // A janela pode ter voltado pro layout desktop em tempo real
        // (redimensionamento) — se sobrou um botão nosso injetado antes,
        // remove, já que o like nativo visível cobre a foto sozinho agora.
        if (existingStat) existingStat.remove();
        return;
      }
      if (existingStat) return; // já injetado e ainda necessário nesse layout

      const statsRow = card.querySelector('.result__stats');
      if (!statsRow) return; // estrutura diferente do esperado: não sabemos onde encaixar, não injeta

      const photoId = card.dataset.photo;
      if (!photoId) return;

      const stat = document.createElement('div');
      stat.className = 'result__stat ' + MOBILE_LIKE_STAT_CLASS;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = MOBILE_LIKE_BTN_CLASS;
      button.setAttribute('aria-label', t('likeWidgetLabel'));

      const icon = document.createElement('img');
      icon.src = MOBILE_LIKE_ICON_URL;
      icon.alt = 'Like';
      icon.className = 'mobile-only icon';
      button.appendChild(icon);
      stat.appendChild(button);
      statsRow.appendChild(stat);

      applyMobileButtonState(button, nativeAnchor ? isAlreadyLiked(nativeAnchor, card) : isPhotoLikedInCache(photoId));

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        handleMobileLikeClick(button, photoId, nativeAnchor);
      });
      button.addEventListener('animationend', event => {
        if (event.animationName === 'jpLikePop') button.classList.remove(MOBILE_LIKE_BTN_POP_CLASS);
      });
    });
  }


  // ---------------------------------------------------------------------
  // UI: ícones simples em SVG inline (sem depender de assets externos)
  // ---------------------------------------------------------------------
  // stroke="currentColor" nesses 3 ícones neutros: assim eles herdam a cor
  // do elemento pai via CSS (var(--jp-icon-color)), o que permite recolori-los
  // automaticamente no dark mode sem precisar duplicar SVGs.
  const ICON_REFRESH = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>`;


  const ICON_CLOCK = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>`;


  // ---------------------------------------------------------------------
  // Animações: tudo centralizado numa única <style>, rápido e simples.
  // Respeita prefers-reduced-motion pra usuários sensíveis a movimento.
  // ---------------------------------------------------------------------
  const STYLE_ID = 'jp-plus-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* JetPhotos site dark-mode overrides. These target only site elements
         whose original light-theme colors become unreadable on dark backgrounds.
         They are scoped to the extension's dark-mode class so normal JetPhotos
         colors remain completely untouched when dark mode is off. */
      /* Active Like state: JetPhotos sets this to a dark color in its
         light-theme CSS. In dark mode the label must stay white, matching
         the already-inverted Like icon. Keep this override scoped to the
         active Like link so normal/site light-mode colors are untouched. */
      html.jp-site-dark-active a.social__link.social__link--like.social__link--active,
      html.jp-site-dark-active a.social__link.social__link--like.social__link--active .social__text {
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }

      /* Account submenu: JetPhotos keeps these native account links at
         #282828 in the normal state and only turns them white on hover.
         With the extension site dark mode enabled, the submenu background is
         dark, so force all account submenu links to the same light text color
         in their normal state as well. The rule is scoped to dark mode and
         covers every item (Profile, Photos, Change password, Log out). */
      html.jp-site-dark-active .nav-desktop__list--username .nav-desktop__list--submenu .nav-desktop__link {
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }

      /* Photographer carousel arrows: JetPhotos has a more specific
         .slick-prev rule with a light #ececec gradient. Override both
         arrows only while extension dark mode is active, keeping the
         normal site appearance untouched outside dark mode. */
      html.jp-site-dark-active .slick-next {
        background: linear-gradient(86deg, hsl(0deg 0% 14.32% / 10%), #1c1b1b) !important;
      }

      html.jp-site-dark-active .slick-prev {
        background: linear-gradient(274deg, hsl(0deg 0% 14.32% / 10%), #1c1b1b) !important;
      }

      /* Hover state: JetPhotos' original CSS changes .social__link to a
         dark color on hover. In dark mode that becomes unreadable, so keep
         every social action link light while hovered. This is intentionally
         separate from the active-state rule above. */
      html.jp-site-dark-active a.social__link:hover,
      html.jp-site-dark-active a.social__link:hover .social__text {
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }

      /* Explicitly cover the overlap: an already-active Like link while
         hovered must remain white as well, regardless of source specificity. */
      html.jp-site-dark-active a.social__link.social__link--like.social__link--active:hover,
      html.jp-site-dark-active a.social__link.social__link--like.social__link--active:hover .social__text {
        color: #ffffff !important;
        -webkit-text-fill-color: #ffffff !important;
      }

      /* Queue estimator: this is extension-owned DOM and is refreshed in
         place when the live queue data changes. Keep its dark-mode colors
         here instead of letting the generic page recolor observer touch its
         table cells after every refresh (which caused a visible white flash). */
      html.jp-site-dark-active #jp-site-queue-tracker,
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table,
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table tbody {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* O Period Totals original usa zebra striping: a segunda fileira
         recebe fundo elevado e a primeira permanece integrada ao fundo da página.
         O estimador replica exatamente esse comportamento no dark mode. */
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table tbody tr:nth-child(even),
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table tbody tr:nth-child(even) td {
        background: #2d2e31 !important;
        background-color: #2d2e31 !important;
        color: #e8eaed !important;
        border-color: #3c4043 !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table tbody tr:nth-child(odd),
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table tbody tr:nth-child(odd) td {
        background: transparent !important;
        background-color: transparent !important;
        color: #e8eaed !important;
        border-color: transparent !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table td,
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-metric {
        background: transparent !important;
        background-color: transparent !important;
        color: #e8eaed !important;
        border-color: #3c4043 !important;
      }

      /* Period Totals nativo do JetPhotos: preserva o zebra striping do site.
         A segunda fileira fica levemente elevada; a primeira permanece com
         o fundo do próprio dark mode, como no layout original. */
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > .table__row:nth-child(even),
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > .table__row:nth-child(even) td {
        background: #2d2e31 !important;
        background-color: #2d2e31 !important;
        color: #e8eaed !important;
        border-color: #3c4043 !important;
      }

      html.jp-site-dark-active .jp-plus-dark-native-table tbody > .table__row:nth-child(odd),
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > .table__row:nth-child(odd) td {
        background: transparent !important;
        background-color: transparent !important;
        color: #e8eaed !important;
        border-color: transparent !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-table caption,
      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-metric strong {
        color: #e8eaed !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-metric span {
        color: rgb(224 224 224) !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-queue-note {
        color: #9aa0a6 !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker .jp-plus-experimental {
        color: #9aa0a6 !important;
      }

      html.jp-site-dark-active #jp-site-queue-tracker button {
        color: #9aa0a6 !important;
        background: transparent !important;
      }

      /* JetPhotos+ UI: intentionally follows the visual language of JetPhotos
         instead of looking like a separate Material-style application. */
      #jp-plus-launcher-host {
        position: relative;
        display: inline-flex;
        align-items: stretch;
        vertical-align: middle;
        z-index: 1000000;
        flex: 0 0 auto;
        list-style: none;
        margin: 0 0 0 18px !important;
        padding: 0;
      }
      #jp-plus-launcher {
        appearance: none;
        -webkit-appearance: none;
        box-sizing: border-box;
        min-width: 0;
        width: 42px;
        margin: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        letter-spacing: inherit;
        text-align: center;
        white-space: nowrap;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding-left: 8px;
        padding-right: 8px;
      }
      #jp-plus-launcher .jp-launcher-logo {
        display: block;
        width: 27px;
        height: 29px;
        object-fit: contain;
        flex: 0 0 auto;
        filter: brightness(0) invert(1);
        transition: filter .18s ease, transform .18s ease;
      }
      /* O PNG original é preto/transparente. No header ele fica branco e,
         ao passar o mouse ou receber foco, muda suavemente para o azul da
         identidade da extensão. */
      #jp-plus-launcher-host:hover > #jp-plus-launcher .jp-launcher-logo,
      #jp-plus-launcher-host:focus-within > #jp-plus-launcher .jp-launcher-logo {
        filter: brightness(0) saturate(100%) invert(51%) sepia(98%) saturate(2437%) hue-rotate(190deg) brightness(101%) contrast(102%);
        transform: scale(1.04);
      }
      /* Submenu próprio da extensão: mesma linguagem dos dropdowns nativos. */
      #jp-plus-submenu {
        position: absolute !important;
        top: 100% !important;
        left: calc(50% + 8px) !important;
        right: auto !important;
        transform: translateX(-50%);
        width: 170px !important;
        box-sizing: border-box;
        display: none;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff;
        color: #222222;
        border: 0;
        border-radius: 0 !important;
        box-shadow: 0 2px 7px rgba(0,0,0,.22);
        overflow: hidden;
        z-index: 1000001;
        font-family: inherit !important;
      }
      #jp-plus-launcher-host:hover > #jp-plus-submenu,
      #jp-plus-launcher-host:focus-within > #jp-plus-submenu {
        display: block !important;
      }
      #jp-plus-submenu a {
        display: block;
        box-sizing: border-box;
        width: 100%;
        padding: 10px 13px;
        color: #222222;
        border: 0 !important;
        outline: none !important;
        box-shadow: none;
        background: #ffffff;
        text-decoration: none;
        font: inherit;
        font-size: 14px;
        line-height: 1.3;
        white-space: nowrap;
      }
      #jp-plus-submenu a:hover,
      #jp-plus-submenu a:focus-visible {
        background: #4299dc;
        color: #ffffff;
        outline: none !important;
        border: 0 !important;
        box-shadow: none;
      }
      #jp-plus-submenu.jp-dark {
        background: #292929;
        color: #eeeeee;
      }
      #jp-plus-submenu.jp-dark a {
        background: #292929;
        color: #eeeeee;
      }
      #jp-plus-submenu.jp-dark a:hover,
      #jp-plus-submenu.jp-dark a:focus-visible {
        background: #3d91d1;
        color: #ffffff;
        border: 0 !important;
        outline: none !important;
      }

      /* Ferramenta contextual de curtidas: aparece somente em páginas que
         realmente possuem links/ícones de Like. Não é launcher. */
      #jp-like-context-widget {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: min(524px, calc(100vw - 28px));
        min-height: 84px;
        box-sizing: border-box;
        display:flex;
        align-items:center;
        gap:18px;
        padding:12px 14px 12px 16px;
        background:#1c1c1c;
        color:#eeeeee;
        border:1px solid #464646;
        border-radius:10px;
        box-shadow:0 5px 20px rgba(0,0,0,.30);
        opacity:0;
        transform:translateY(6px);
        transition:opacity .18s ease, transform .18s ease, box-shadow .18s ease;
        animation:jpLikeWidgetIn .18s ease forwards;
        z-index:999999;
        font-family:inherit !important;
        overflow:hidden;
      }
      #jp-like-context-widget .jp-like-widget-main { flex:1 1 auto; min-width:0; }
      #jp-like-context-widget .jp-like-widget-head {
        margin:0 0 5px;
        color:#f3f5f7;
        font-size:15px;
        font-weight:700;
        line-height:1.15;
        letter-spacing:.1px;
      }
      #jp-like-context-widget .jp-like-widget-body { padding:0; background:transparent; min-width:0; }
      #jp-like-context-widget .jp-like-widget-status {
        margin:0;
        color:#b6b6b6;
        font-size:12px;
        line-height:1.35;
        transition:opacity .12s ease;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      #jp-like-context-widget .jp-like-widget-progress {
        display:none;
        height:3px;
        margin:7px 0 0;
        background:#343434;
        border-radius:999px;
        overflow:hidden;
      }
      #jp-like-context-widget .jp-like-widget-progress-bar { width:0; height:100%; background:#8a8a8a; border-radius:999px; transition:width .12s ease; }
      #jp-like-context-widget .jp-like-widget-confirm { display:none; margin:6px 0 0; color:#a9a9a9; font-size:12px; font-weight:600; }
      #jp-like-context-widget .jp-like-widget-button {
        flex:0 0 auto;
        min-width:162px;
        min-height:42px;
        padding:9px 12px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:9px;
        border:1px solid #555555;
        border-radius:8px;
        background:linear-gradient(#303030,#292929);
        color:#eeeeee;
        font:inherit;
        font-size:14px;
        font-weight:600;
        text-align:center;
        cursor:pointer;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
      }
      #jp-like-context-widget .jp-like-widget-button:hover,
      #jp-like-context-widget .jp-like-widget-button:focus-visible { background:#363636; border-color:#686868; outline:none; }
      #jp-like-context-widget .jp-like-widget-heart { width:21px; height:21px; flex:0 0 auto; }
      #jp-like-context-widget .jp-like-widget-chevron { width:16px; height:16px; opacity:.72; margin-left:1px; }
      #jp-like-context-widget.jp-dark { background:#1c1c1c; color:#eeeeee; border-color:#464646; }
      #jp-like-context-widget.jp-dark .jp-like-widget-status { color:#b6b6b6; }
      #jp-like-context-widget.jp-dark .jp-like-widget-progress { background:#343434; }
      #jp-like-context-widget.jp-dark .jp-like-widget-confirm { color:#a9a9a9; }
      #jp-like-context-widget.jp-dark .jp-like-widget-button { background:linear-gradient(#303030,#292929); color:#eeeeee; border-color:#555555; }
      /* Botão de minimizar no canto do widget de curtidas. */
      #jp-like-context-widget .jp-like-widget-min {
        position:absolute; top:4px; right:6px;
        width:28px; height:28px; padding:0;
        display:inline-flex; align-items:center; justify-content:center;
        border:0; border-radius:6px; background:transparent; color:#8a8a8a;
        font-size:18px; line-height:1; cursor:pointer;
      }
      #jp-like-context-widget .jp-like-widget-min:hover { color:#ffffff; background:rgba(255,255,255,.08); }
      /* Bolha recolhida do widget: mesma identidade (fundo/borda/sombra),
         só que compacta — coração + faltantes. display:none por padrão; o
         JS alterna pra flex quando recolhido (ver setWidgetCollapsed). */
      #jp-like-widget-bubble {
        position:fixed; right:18px; bottom:18px; z-index:999999;
        display:none; align-items:center; gap:8px;
        min-height:48px; padding:10px 16px 10px 14px; box-sizing:border-box;
        background:#1c1c1c; color:#eeeeee;
        border:1px solid #464646; border-radius:999px;
        box-shadow:0 5px 20px rgba(0,0,0,.30);
        font:inherit; font-size:14px; font-weight:700; line-height:1;
        cursor:pointer;
        animation:jpLikeWidgetIn .18s ease;
      }
      #jp-like-widget-bubble:hover { background:#2a2a2a; border-color:#686868; }
      #jp-like-widget-bubble:focus-visible { outline:2px solid #669DF6; outline-offset:2px; }
      #jp-like-widget-bubble svg { width:20px; height:20px; flex:0 0 auto; }
      #jp-like-widget-bubble.jp-bubble-done #jp-like-widget-bubble-count { color:#8fce8f; }
      /* Durante a leva, a bolha pulsa verde (é o feedback de progresso no
         celular, onde a barrinha do widget está escondida). */
      @keyframes jpBubbleLiking {
        0%, 100% { box-shadow:0 5px 20px rgba(0,0,0,.30), 0 0 0 0 rgba(76,175,80,.55); }
        50% { box-shadow:0 5px 20px rgba(0,0,0,.30), 0 0 0 9px rgba(76,175,80,0); }
      }
      #jp-like-widget-bubble.jp-bubble-liking { border-color:#4caf50; animation:jpBubbleLiking 1.1s ease-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        #jp-like-widget-bubble.jp-bubble-liking { animation:none; border-color:#4caf50; }
      }
      /* Anel de progresso em volta do coração: o track fica sempre visível
         (contorno sutil) e o fill verde fecha conforme a leva avança (ver
         setBubbleProgress). Começa no topo por causa do rotate(-90deg). */
      #jp-like-widget-bubble .jp-bubble-ring-wrap { position:relative; width:28px; height:28px; flex:0 0 auto; }
      #jp-like-widget-bubble .jp-bubble-ring { position:absolute; inset:0; width:28px; height:28px; transform:rotate(-90deg); }
      #jp-like-widget-bubble .jp-bubble-ring-track { fill:none; stroke:rgba(255,255,255,.16); stroke-width:2.5; }
      #jp-like-widget-bubble .jp-bubble-ring-fill { fill:none; stroke:#4caf50; stroke-width:2.5; stroke-linecap:round; stroke-dasharray:75.4; stroke-dashoffset:75.4; transition:stroke-dashoffset .15s linear; }
      #jp-like-widget-bubble .jp-bubble-heart { position:absolute; inset:0; margin:auto; width:17px; height:17px; }
      /* Pop de conclusão na bolha (reaproveita o keyframe do joinha). */
      #jp-like-widget-bubble.jp-bubble-pop { animation:jpLikePop .25s ease; }
      @media (prefers-reduced-motion: reduce) {
        #jp-like-widget-bubble.jp-bubble-pop { animation:none; }
        #jp-like-widget-bubble .jp-bubble-ring-fill { transition:none; }
      }
      @keyframes jpLikeWidgetIn { from {opacity:0; transform:translateY(6px)} to {opacity:1; transform:translateY(0)} }

      #jp-like-settings-menu {
        position: absolute !important;
        top: 100% !important;
        right: 0 !important;
        width: 360px !important;
        max-width: min(360px, calc(100vw - 18px));
        box-sizing: border-box;
        display: none;
        margin: 0 !important;
        padding: 0 14px 14px !important;
        background: #ffffff;
        color: #222222;
        border: 1px solid #c8c8c8;
        border-top: 0;
        border-radius: 0 !important;
        box-shadow: 0 2px 8px rgba(0,0,0,.24);
        z-index: 1000002;
        opacity: 0;
        transform: translateY(-5px);
        transition: opacity .16s ease, transform .16s ease;
        font-family: inherit !important;
      }
      #jp-plus-launcher-host.jp-settings-open > #jp-plus-settings-panel { display: block !important; }
      #jp-plus-launcher-host.jp-settings-open > #jp-plus-submenu { display: none !important; }
      #jp-plus-settings-panel {
        --jp-bg: #ffffff;
        --jp-text: #222222;
        --jp-subtext: #666666;
        --jp-border: #c8c8c8;
        --jp-toggle-off: #bdbdbd;
        position: absolute !important;
        top: 100% !important;
        right: 0 !important;
        width: 360px !important;
        max-width: min(360px, calc(100vw - 18px));
        box-sizing: border-box;
        display: none;
        background: #ffffff;
        color: #222222;
        border: 1px solid #c8c8c8;
        border-top: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,.24);
        z-index: 1000002;
        opacity: 0;
        transform: translateY(-5px);
        transition: opacity .16s ease, transform .16s ease;
        font-family: inherit !important;
      }
      /* O painel vive dentro do mesmo <li> do menu de conta do JetPhotos,
         e o menu nativo do site força white-space:nowrap nos próprios itens
         (comum em nav horizontal) — como white-space é herdado, os nossos
         textos de ajuda puxavam esse nowrap do site, viravam uma linha só
         enorme, e o overflow-x:hidden do painel cortava tudo no meio, sem
         quebra nem reticências. Resetando aqui, com !important, isolamos
         o conteúdo do painel do CSS do site, então o texto sempre quebra
         linha normalmente dentro da largura de 360px. */
      #jp-plus-settings-panel, #jp-plus-settings-panel * {
        white-space: normal !important;
      }
      #jp-plus-settings-panel.jp-dark {
        --jp-bg: #292929;
        --jp-text: #eeeeee;
        --jp-subtext: #b6b6b6;
        --jp-border: #505050;
        --jp-toggle-off: #555555;
        background:#292929; color:#eeeeee; border-color:#505050;
      }
      #jp-plus-settings-panel #jp-like-settings-menu {
        display:block !important;
        opacity:1 !important;
        transform:none !important;
        position:static !important;
        width:auto !important;
        max-width:none !important;
        margin:0 !important;
        padding:0 0 2px !important;
        background:transparent !important;
        border:0 !important;
        box-shadow:none !important;
      }
      #jp-plus-settings-panel .jp-settings-title {
        padding: 11px 14px;
        background: #282828;
        color: #ffffff;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.2;
      }
      #jp-plus-settings-panel .jp-settings-body {
        max-height: min(70vh, 520px);
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0 14px 14px;
        box-sizing: border-box;
      }
      #jp-plus-settings-panel .jp-settings-body #jp-like-settings-menu {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box;
        overflow-x: hidden;
      }
      #jp-plus-settings-panel .jp-settings-body #jp-like-settings-menu > div {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      #jp-plus-settings-panel .jp-settings-body #jp-like-settings-menu > div > div {
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      #jp-plus-settings-panel .jp-settings-body #jp-like-settings-menu span {
        overflow-wrap: anywhere;
        word-break: normal;
      }
      #jp-plus-settings-panel .jp-settings-body #jp-language-select {
        flex: 0 1 140px;
        width: 140px;
        max-width: 140px;
        min-width: 0;
        box-sizing: border-box;
      }
      #jp-plus-settings-panel .jp-settings-close {
        float:right;
        border:0; background:transparent; color:inherit; cursor:pointer;
        font:inherit; font-size:16px; line-height:1; padding:0 2px;
      }
      #jp-plus-settings-panel .jp-settings-close:hover { opacity:.75; }
      #jp-plus-settings-panel.jp-dark .jp-settings-title { background:#202020; }
      #jp-plus-settings-panel select { border-radius:0 !important; }
      #jp-plus-launcher-host.jp-settings-open #jp-plus-settings-panel {
        opacity: 1;
        transform: translateY(0);
      }

      @media (max-width: 520px) {
        #jp-plus-launcher { width: 38px !important; padding-left: 6px !important; padding-right: 6px !important; }
        #jp-plus-launcher .jp-launcher-logo { width: 25px; height: 27px; }
        #jp-plus-submenu { width: 170px !important; }
        #jp-plus-settings-panel { width: min(360px, calc(100vw - 18px)) !important; }
        #jp-like-context-widget { right:10px; bottom:10px; width:calc(100vw - 20px); min-height:0; padding:11px; gap:10px; }
        #jp-like-widget-bubble { right:10px; bottom:10px; }
        #jp-like-context-widget .jp-like-widget-button { min-width:48px; padding:9px; }
        #jp-like-context-widget .jp-like-widget-button span { display:none; }
        #jp-like-context-widget .jp-like-widget-chevron { display:none; }
      }

      @media (prefers-reduced-motion: reduce) {
        #jp-like-context-widget { animation-duration:.001ms !important; transition-duration:.001ms !important; }
        #jp-like-widget-bubble { animation-duration:.001ms !important; transition-duration:.001ms !important; }
        #jp-plus-settings-panel { transition-duration:.001ms !important; }
        #jp-plus-launcher .jp-launcher-logo {
          transition-duration: .001ms !important;
        }
      }

      /* Botão de Like injetado como último ".result__stat" no layout
         mobile do JetPhotos (ver injectMobileLikeButtons). Usa o mesmo
         ícone .svg do site; a diferença entre curtida/não-curtida é só
         opacidade (o arquivo é preto fixo nos dois estados, então isso é
         suficiente e funciona igual em qualquer tema, sem depender do
         filtro de dark mode automático — por isso essa classe fica de
         fora da recoloração genérica, ver recolorElement()).
         Alinhamento: o <img> é display:block pra eliminar a folga de
         baseline do inline (que deixava o ícone uns px acima dos vizinhos)
         e o stat usa inline-flex + vertical-align:middle pra acompanhar a
         altura dos outros ".result__stat" da fileira. A caixa do botão
         cresceu junto com o ícone (30px) mas a margem negativa compensa na
         mesma medida, então a altura da fileira continua igual à original.
         A margem vertical é assimétrica de propósito (-9px em cima, -5px
         embaixo): sobe o botão 2px em relação aos ícones vizinhos sem
         alterar a altura total ocupada (30 - 9 - 5 = 16px, igual antes). */
      .${MOBILE_LIKE_STAT_CLASS} { cursor:pointer; display:inline-flex; align-items:center; vertical-align:middle; }
      .${MOBILE_LIKE_BTN_CLASS} {
        display:inline-flex; align-items:center; justify-content:center;
        width:30px; height:30px; margin:-9px -4px -5px; padding:0;
        border:0; background:transparent; border-radius:50%;
        cursor:pointer; transition:background .15s ease, opacity .15s ease, transform .1s ease;
      }
      .${MOBILE_LIKE_BTN_CLASS} img { width:20px; height:20px; display:block; opacity:.4; pointer-events:none; }
      .${MOBILE_LIKE_BTN_CLASS}.${MOBILE_LIKE_BTN_LIKED_CLASS} img { opacity:1; }
      .${MOBILE_LIKE_BTN_CLASS}:active { transform:scale(.9); }
      .${MOBILE_LIKE_BTN_CLASS}:hover { background:rgba(0,0,0,.06); }
      /* Sem dim no pending: o clique já aplica o estado na hora (UI otimista)
         e o pop abaixo é o feedback — escurecer o botão brigaria com isso. */
      .${MOBILE_LIKE_BTN_CLASS}.jp-mobile-like-btn--pending { pointer-events:none; }
      /* Pop do joinha ao curtir: resposta instantânea e com um pouco de vida.
         Mora numa classe transitória (--pop), não no estado --liked, pra não
         repetir a cada refresh() — ver popMobileButton(). */
      @keyframes jpLikePop {
        0% { transform:scale(1); }
        40% { transform:scale(1.35); }
        70% { transform:scale(.95); }
        100% { transform:scale(1); }
      }
      .${MOBILE_LIKE_BTN_CLASS}.jp-mobile-like-btn--pop img { animation:jpLikePop .2s ease; }
      @media (prefers-reduced-motion: reduce) {
        .${MOBILE_LIKE_BTN_CLASS}.jp-mobile-like-btn--pop img { animation:none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // Preferências (chrome.storage.local)
  // ---------------------------------------------------------------------
  // Define o idioma inicial a partir do idioma preferido do navegador.
  // Português (incluindo pt-PT/pt-XX) usa a tradução pt-BR; inglês usa
  // English. Qualquer outro idioma cai para English, que é o fallback
  // universal da extensão. Se o usuário já escolheu manualmente um idioma,
  // a preferência salva em chrome.storage.local continua tendo prioridade.
  function getBrowserLanguage() {
    try {
      const languages = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language || ''];
      for (const raw of languages) {
        const lang = String(raw).toLowerCase();
        if (lang === 'pt' || lang.startsWith('pt-')) return 'pt-BR';
        if (lang === 'en' || lang.startsWith('en-')) return 'en';
      }
    } catch (_) {}
    return 'en';
  }

  function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(
        [STORAGE_KEY_SITE_DARK_MODE, STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED, STORAGE_KEY_LANGUAGE, STORAGE_KEY_WIDGET_COLLAPSED],
        result => {
          resolve({
            siteDarkMode: result[STORAGE_KEY_SITE_DARK_MODE] === true, // padrão: false
            queueEstimatorEnabled: result[STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED] !== false, // padrão: true (EXPERIMENTAL)
            language: result[STORAGE_KEY_LANGUAGE] || getBrowserLanguage(),
            widgetCollapsed: result[STORAGE_KEY_WIDGET_COLLAPSED] === true // padrão: false
          });
        }
      );
    });
  }


  function setSiteDarkMode(value) {
    chrome.storage.local.set({ [STORAGE_KEY_SITE_DARK_MODE]: value });
  }

  function setQueueEstimatorEnabled(value) {
    chrome.storage.local.set({ [STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED]: value });
  }

  function setLanguage(value) {
    chrome.storage.local.set({ [STORAGE_KEY_LANGUAGE]: value });
  }

  // =======================================================================
  // >>> INÍCIO DO BLOCO EXPERIMENTAL <<<
  // -----------------------------------------------------------------------
  // Modo escuro do SITE (não só do painel). MÉTODO NOVO (v1.8): recoloração
  // direta, sem filtro global.
  //
  // A versão anterior usava "smart invert" (filter: invert()+hue-rotate()
  // na página inteira, com reinversão pontual em exceções). Foi
  // abandonada porque tem 3 problemas estruturais que não dá pra corrigir
  // só com mais exceções:
  //   1) fotos que carregam DEPOIS do primeiro scan (lazy-load, paginação)
  //      ficam sem a correção, então saem com cor errada;
  //   2) hue-rotate não reconstrói o matiz exato de cores saturadas (um
  //      azul de marca podia sair alaranjado);
  //   3) cancelar a inversão num container pra proteger um fundo escuro
  //      (ex: overlay translúcido sobre uma foto de capa) cancela TUDO
  //      dentro dele — inclusive texto que devia ter sido invertido
  //      normalmente. Foi isso que deixou números pretos sobre fundo
  //      escuro (ilegíveis).
  //
  // MÉTODO NOVO: em vez de inverter e depois consertar, cada elemento é
  // lido individualmente (getComputedStyle) e recolorido de forma
  // direcionada:
  //   - Fundo/texto claros (quase branco/preto, baixa saturação) →
  //     sobrescritos com uma cor escura/clara fixa via inline style
  //     !important, escolhida por faixa de luminosidade (mesma paleta
  //     usada no painel da extensão, pra manter consistência visual).
  //   - Cores saturadas/de marca (azul do site, badges coloridos etc.) →
  //     NUNCA tocadas. Ficam com a cor original, que já costuma ficar
  //     legível sobre fundo escuro.
  //   - Imagens, vídeos, canvas, svg, iframe → NUNCA tocados. É
  //     impossível "escurecer" uma fotografia real sem estragar a cor;
  //     a solução correta é simplesmente não mexer nelas.
  // Como cada elemento é resolvido individualmente (não em cascata via
  // filter), não existe mais o problema de um container "vazar" a
  // recoloração pros filhos.
  // =======================================================================
  const SITE_DARK_HTML_CLASS = 'jp-site-dark-active';

  // Paleta reaproveitada do painel da extensão (--jp-bg / --jp-text /
  // --jp-subtext / --jp-border no modo escuro), pra manter a mesma
  // identidade visual entre o painel e o site recolorido.
  const DARK_PALETTE = {
    bgBase: '#202124',     // fundos que eram quase brancos
    bgElevated: '#2d2e31', // fundos que eram cinza-claro (cards, inputs)
    border: '#3c4043',     // bordas/divisores que eram cinza-claro
    textPrimary: '#e8eaed',   // texto que era quase preto
    textSecondary: 'rgb(224 224 224)'  // texto secundário no modo escuro: #e0e0e0
  };

  // Extrai saturação (0-1) e luminosidade (0-1) em HSL a partir de uma
  // string rgb()/rgba() vinda de getComputedStyle.
  function getHSL(colorStr) {
    const m = colorStr && colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const r = parseInt(m[1], 10) / 255, g = parseInt(m[2], 10) / 255, b = parseInt(m[3], 10) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    }
    return { s, l };
  }

  // Considera transparente tanto a keyword quanto rgba(...,0).
  function isTransparentColor(colorStr) {
    if (!colorStr || colorStr === 'transparent') return true;
    const m = colorStr.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/);
    return !!m && parseFloat(m[1]) === 0;
  }

  // Acima desse valor de saturação a cor é considerada "vívida/de marca"
  // (ex: o azul do site, um badge dourado) — nunca é recolorida, fica
  // exatamente como no site original.
  const VIVID_SATURATION_THRESHOLD = 0.35;
  function isVivid(hsl) {
    return hsl.s >= VIVID_SATURATION_THRESHOLD && hsl.l > 0.12 && hsl.l < 0.9;
  }

  // Escolhe a cor de fundo escura equivalente pra uma luminosidade clara
  // original. Retorna null se não precisa mexer (já é escuro o bastante,
  // ou está numa faixa ambígua — melhor não tocar do que arriscar).
  function mapBgColor(l) {
    if (l >= 0.85) return DARK_PALETTE.bgBase;
    if (l >= 0.6) return DARK_PALETTE.bgElevated;
    return null;
  }

  // Idem para bordas (mesma lógica, cor um pouco mais clara que o fundo
  // pra continuar visível como divisor).
  function mapBorderColor(l) {
    if (l >= 0.6) return DARK_PALETTE.border;
    return null;
  }

  // Escolhe a cor de texto clara equivalente pra uma luminosidade escura
  // original. Preserva a hierarquia visual: texto quase-preto (principal)
  // vira branco; texto cinza-médio (secundário/legenda) vira um cinza
  // claro, não branco puro — assim continua parecendo "secundário".
  function mapTextColor(l) {
    if (l <= 0.15) return DARK_PALETTE.textPrimary;
    // Limite subido de 0.45 -> 0.7: cinzas médios (ex: texto de menus como
    // "Profile/Photos/Change password/Log out", em torno de l≈0.48) ficavam
    // de fora dessa faixa e não eram tocados, sobrando com baixo contraste
    // sobre o novo fundo escuro (o "meio cinza" ilegível reportado). Esses
    // cinzas foram pensados pra contrastar com fundo claro, então qualquer
    // coisa até bem perto de branco (l<=0.7) ainda precisa ser clareada.
    if (l <= 0.7) return DARK_PALETTE.textSecondary;
    return null;
  }

  // Elementos que já recebemos recoloração, marcados por propriedade —
  // permite reverter (tirar o modo escuro do site) removendo só o que a
  // própria extensão adicionou, sem mexer em mais nada.
  const darkTouched = new Set();

  // Ícones "-black" (Album/Like/Share e outros da mesma família, ex. na
  // seção Photo Administration): são <img> apontando pra um .svg/.png/.gif
  // com o glifo pintado de preto fixo no próprio arquivo. Como são <img>
  // (não SVG inline), a regra "nunca mexe em imagem" da recoloração normal
  // os deixa pretos-sobre-fundo-escuro, ou seja, invisíveis — foi o que
  // apareceu no print. O nome do arquivo já indica que é uma versão
  // monocromática fixa, então é seguro (e só nesse caso) inverter a cor
  // via filter, sem correr o risco de estragar uma foto de verdade.
  const BLACK_ICON_SRC_RE = /-black\.(svg|png|gif)(\?.*)?$/i;
  function isBlackIconImg(el) {
    return el.tagName === 'IMG' && BLACK_ICON_SRC_RE.test(el.currentSrc || el.src || '');
  }

  function recolorElement(el) {
    // Nunca mexe nas UIs próprias da extensão. Elas têm regras de tema
    // próprias e não devem passar pelo recolor genérico do site.
    // Em especial, o estimador da fila é reconstruído durante atualizações
    // de dados; se o observer de dark mode recolorisse seus <td>s depois da
    // reconstrução, haveria um flash branco antes do próximo scan.
    if (el.closest('#jp-like-context-widget, #jp-plus-submenu, #jp-plus-launcher-host, #jp-site-queue-tracker, .' + MOBILE_LIKE_BTN_CLASS)) return;

    // Ícones pretos fixos (Album/Like/Share etc.): inverte pra virar
    // branco sobre o novo fundo escuro. Não passa pelo resto da função
    // (background/texto/borda não fazem sentido pra esse tipo de <img>).
    if (isBlackIconImg(el)) {
      el.style.setProperty('filter', 'invert(1) brightness(1.1)', 'important');
      el.dataset.jpDarkFilter = '1';
      darkTouched.add(el);
      el.dataset.jpDarkScanned = '1';
      return;
    }

    const computed = getComputedStyle(el);

    // Fundo (pula elementos com imagem de fundo — texturas/fotos não
    // devem ser tocadas, e a cor de fundo por trás delas é irrelevante).
    const bgImage = computed.backgroundImage;
    if (!bgImage || bgImage === 'none' || !bgImage.includes('url(')) {
      const bgColor = computed.backgroundColor;
      if (!isTransparentColor(bgColor)) {
        const hsl = getHSL(bgColor);
        if (hsl && !isVivid(hsl)) {
          const newBg = mapBgColor(hsl.l);
          if (newBg) {
            el.style.setProperty('background-color', newBg, 'important');
            el.dataset.jpDarkBg = '1';
            darkTouched.add(el);
          }
        }
      }
    }

    // Texto
    const hslText = getHSL(computed.color);
    if (hslText && !isVivid(hslText)) {
      const newColor = mapTextColor(hslText.l);
      if (newColor) {
        el.style.setProperty('color', newColor, 'important');
        el.dataset.jpDarkText = '1';
        darkTouched.add(el);
      }
    }

    // Borda (divisores/cards costumam usar border-color clara)
    const borderColor = computed.borderTopColor;
    if (!isTransparentColor(borderColor)) {
      const hslBorder = getHSL(borderColor);
      if (hslBorder && !isVivid(hslBorder)) {
        const newBorder = mapBorderColor(hslBorder.l);
        if (newBorder) {
          el.style.setProperty('border-color', newBorder, 'important');
          el.dataset.jpDarkBorder = '1';
          darkTouched.add(el);
        }
      }
    }

    el.dataset.jpDarkScanned = '1';
  }

  // Varre o DOM recolorindo cada elemento ainda não visto. Roda de novo
  // (via observer/debounce) sempre que o DOM muda, então elementos que
  // aparecem depois (lazy-load, paginação AJAX, filtros) são pegos
  // naturalmente — sem depender de "adivinhar" o momento certo.
  function scanAndRecolor(root) {
    if (!currentSettings.siteDarkMode) return;
    const scope = root && root.querySelectorAll ? root : document;
    const elements = scope === document ? document.body.querySelectorAll('*') : scope.querySelectorAll('*');
    elements.forEach(el => {
      if (el.dataset.jpDarkScanned === '1') return;
      recolorElement(el);
    });
  }

  // Desfaz toda a recoloração aplicada, sem precisar recarregar a página.
  function revertRecoloring() {
    darkTouched.forEach(el => {
      if (el.dataset.jpDarkBg === '1') { el.style.removeProperty('background-color'); delete el.dataset.jpDarkBg; }
      if (el.dataset.jpDarkText === '1') { el.style.removeProperty('color'); delete el.dataset.jpDarkText; }
      if (el.dataset.jpDarkBorder === '1') { el.style.removeProperty('border-color'); delete el.dataset.jpDarkBorder; }
      if (el.dataset.jpDarkFilter === '1') { el.style.removeProperty('filter'); delete el.dataset.jpDarkFilter; }
      delete el.dataset.jpDarkScanned;
    });
    darkTouched.clear();
  }

  function applySiteDarkMode(isOn) {
    document.documentElement.classList.toggle(SITE_DARK_HTML_CLASS, isOn);
    if (isOn) {
      scanAndRecolor(document);
    } else {
      revertRecoloring();
    }
  }

  // Debounce pra reescanear quando o DOM muda (lazy-load, paginação AJAX,
  // filtros de busca aplicados sem reload, etc).
  const RECOLOR_DEBOUNCE_MS = 400;
  let recolorTimer = null;
  function scheduleRecolor() {
    if (!currentSettings.siteDarkMode) return;
    clearTimeout(recolorTimer);
    recolorTimer = setTimeout(() => scanAndRecolor(document), RECOLOR_DEBOUNCE_MS);
  }

  let siteDarkObserverStarted = false;
  function startBgObserverIfNeeded() {
    if (siteDarkObserverStarted || !currentSettings.siteDarkMode) return;
    siteDarkObserverStarted = true;
    scanAndRecolor(document);
    const observer = new MutationObserver(() => scheduleRecolor());
    observer.observe(document.body, { childList: true, subtree: true });
  }
  // >>> FIM DO BLOCO EXPERIMENTAL <<<
  // =======================================================================
  // Painel principal
  // ---------------------------------------------------------------------
  let panelEl = null;
  let likeWidgetEl = null;
  let settingsMenuEl = null;
  let settingsPanelEl = null;
  let currentSettings = { siteDarkMode: false, queueEstimatorEnabled: true, language: 'pt-BR', widgetCollapsed: false };

  function buildToggleSwitch(initialOn, onChange) {
    const wrapper = document.createElement('button');
    wrapper.type = 'button';
    wrapper.setAttribute('role', 'switch');
    wrapper.setAttribute('aria-checked', String(initialOn));
    wrapper.style.cssText = `
      position:relative; width:40px; height:22px; border-radius:999px;
      border:none; cursor:pointer; padding:0; flex-shrink:0;
      background:${initialOn ? '#669DF6' : 'var(--jp-toggle-off)'};
      transition: background .15s ease;
    `;

    const thumb = document.createElement('span');
    thumb.style.cssText = `
      position:absolute; top:2px; left:${initialOn ? '20px' : '2px'};
      width:18px; height:18px; border-radius:50%; background:#fff;
      box-shadow:0 1px 2px rgba(0,0,0,0.3);
      transition: left .15s ease;
    `;
    wrapper.appendChild(thumb);

    let isOn = initialOn;
    wrapper.addEventListener('click', () => {
      isOn = !isOn;
      wrapper.setAttribute('aria-checked', String(isOn));
      wrapper.style.background = isOn ? '#669DF6' : 'var(--jp-toggle-off)';
      thumb.style.left = isOn ? '20px' : '2px';
      onChange(isOn);
    });

    return wrapper;
  }

  function buildSettingsMenu() {
    // O collapse (max-height/opacity) fica no wrapper externo (#jp-like-settings-menu,
    // já estilizado via injectStyles). O padding/borda ficam num wrapper interno —
    // assim, com max-height:0 no fechado, nada "vaza" visualmente durante a transição.
    const menu = document.createElement('div');
    menu.id = 'jp-like-settings-menu';

    const inner = document.createElement('div');
    inner.style.cssText = `
      margin-top:14px; padding-top:14px;
      border-top:1px solid var(--jp-border);
      display:flex; flex-direction:column; gap:16px;
    `;

    // --- Divisor + rótulo "Experimental" ---
    const experimentalHeader = document.createElement('div');
    experimentalHeader.style.cssText = `
      margin-top:4px; padding-top:14px;
      border-top:1px dashed var(--jp-border);
      font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:600;
      letter-spacing:.6px; text-transform:uppercase; color:var(--jp-subtext);
    `;
    experimentalHeader.textContent = t('experimental');
    inner.appendChild(experimentalHeader);

    // --- Linha: modo escuro do SITE (experimental) ---
    const siteDarkRow = document.createElement('div');
    siteDarkRow.style.cssText = `
      display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; width:100%; box-sizing:border-box;
    `;

    const siteDarkLabel = document.createElement('div');
    siteDarkLabel.style.cssText = `
      font-family:Arial,Helvetica,sans-serif; font-size:14px; color:var(--jp-text); line-height:1.4; min-width:0; flex:1 1 auto; overflow-wrap:anywhere; word-break:normal;
    `;
    siteDarkLabel.innerHTML = `${t('siteDarkMode')}<br><span style="font-size:12px; color:var(--jp-subtext);">${t('siteDarkModeHelp')}</span>`;

    const siteDarkToggle = buildToggleSwitch(currentSettings.siteDarkMode, (isOn) => {
      currentSettings.siteDarkMode = isOn;
      setSiteDarkMode(isOn);
      applySiteDarkMode(isOn);
      if (panelEl) panelEl.classList.toggle('jp-dark', isOn);
      if (settingsPanelEl) settingsPanelEl.classList.toggle('jp-dark', isOn);
      if (likeWidgetEl) likeWidgetEl.classList.toggle('jp-dark', isOn);
      if (isOn) startBgObserverIfNeeded();
    });

    siteDarkRow.appendChild(siteDarkLabel);
    siteDarkRow.appendChild(siteDarkToggle);
    inner.appendChild(siteDarkRow);

    // --- Linha: estimador de dias na fila (experimental) ---
    // Só é relevante em queue.php, mas o toggle fica visível em qualquer
    // página (mesmo padrão do modo escuro do site) — assim dá pra
    // desligar/religar sem precisar estar na página da fila. Requer
    // recarregar a página pra aplicar, porque o corpo do painel é montado
    // uma vez em buildPanel() a partir do valor lido em init().
    const queueEstRow = document.createElement('div');
    queueEstRow.style.cssText = `
      display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; width:100%; box-sizing:border-box;
    `;

    const queueEstLabel = document.createElement('div');
    queueEstLabel.style.cssText = `
      font-family:Arial,Helvetica,sans-serif; font-size:14px; color:var(--jp-text); line-height:1.4; min-width:0; flex:1 1 auto; overflow-wrap:anywhere; word-break:normal;
    `;
    queueEstLabel.innerHTML = `${t('queueEstimator')}<br><span style="font-size:12px; color:var(--jp-subtext);">${t('queueEstimatorHelp')}</span>`;

    const queueEstToggle = buildToggleSwitch(currentSettings.queueEstimatorEnabled, (isOn) => {
      currentSettings.queueEstimatorEnabled = isOn;
      setQueueEstimatorEnabled(isOn);
    });

    queueEstRow.appendChild(queueEstLabel);
    queueEstRow.appendChild(queueEstToggle);
    inner.appendChild(queueEstRow);

    // --- Linha: idioma ---
    const languageRow = document.createElement('div');
    languageRow.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:12px; min-width:0; width:100%; box-sizing:border-box;`;

    const languageLabel = document.createElement('div');
    languageLabel.style.cssText = `font-family:Arial,Helvetica,sans-serif; font-size:14px; color:var(--jp-text); line-height:1.4; min-width:0; flex:1 1 auto; overflow-wrap:anywhere; word-break:normal;`;
    languageLabel.innerHTML = `${t('language')}<br><span style="font-size:12px; color:var(--jp-subtext);">${t('languageHelp')}</span>`;

    const languageSelect = document.createElement('select');
    languageSelect.id = 'jp-language-select';
    languageSelect.style.cssText = `font-family:Arial,Helvetica,sans-serif; font-size:13px; color:var(--jp-text); background:var(--jp-bg); border:1px solid var(--jp-border); border-radius:6px; padding:6px 8px; cursor:pointer;`;
    languageSelect.innerHTML = `<option value="pt-BR">${t('portugueseBrazil')}</option><option value="en">${t('english')}</option>`;
    languageSelect.value = currentSettings.language;
    languageSelect.addEventListener('change', () => {
      currentSettings.language = languageSelect.value === 'en' ? 'en' : 'pt-BR';
      setLanguage(currentSettings.language);
      location.reload();
    });

    languageRow.appendChild(languageLabel);
    languageRow.appendChild(languageSelect);
    inner.appendChild(languageRow);

    menu.appendChild(inner);

    return menu;
  }

  function findHeaderIntegrationTarget() {
    // O JetPhotos mantém a área da conta em uma navegação separada.
    // Inserimos o JetPhotos+ na MESMA lista do usuário, imediatamente após
    // o item do e-mail/nome. Assim ele herda a geometria do header e o
    // submenu pode se comportar como os dropdowns nativos do site.
    const accountNav = document.querySelector(
      '#nav-logged-in, nav[id*="logged-in"], [id*="nav-logged-in"]'
    );
    if (!accountNav) return null;

    const usernameList = accountNav.querySelector(
      'ul.nav-desktop__list--username, ul[class*="list--username"], ul'
    );
    if (usernameList) {
      const accountItem = usernameList.querySelector(
        'li.nav-desktop__item--menu, li[class*="item--menu"], li'
      );
      if (accountItem) {
        const reference = accountItem.querySelector('a, span') || accountItem;
        return {
          container: usernameList,
          after: accountItem,
          reference,
          mode: 'account-list'
        };
      }
    }

    const parent = accountNav.parentElement;
    if (parent) {
      return {
        container: parent,
        after: accountNav,
        reference: accountNav.querySelector('a, span, li') || accountNav,
        mode: 'after-account-nav'
      };
    }

    return null;
  }

  function styleLauncherFromReference(launcher, host, reference, container) {
    const ref = reference && reference.nodeType === 1 ? reference : container;
    const rs = getComputedStyle(ref);
    const cs = getComputedStyle(container);

    launcher.style.fontFamily = rs.fontFamily || cs.fontFamily;
    launcher.style.fontSize = rs.fontSize || cs.fontSize;
    launcher.style.fontWeight = rs.fontWeight || cs.fontWeight;
    launcher.style.letterSpacing = rs.letterSpacing || cs.letterSpacing;
    launcher.style.lineHeight = rs.lineHeight || 'normal';
    launcher.style.color = rs.color || cs.color;
    launcher.style.height = rs.height && rs.height !== 'auto'
      ? rs.height
      : (cs.height !== 'auto' ? cs.height : '60px');
    launcher.style.paddingTop = rs.paddingTop;
    launcher.style.paddingBottom = rs.paddingBottom;
    launcher.style.paddingLeft = '10px';
    launcher.style.paddingRight = '10px';
    launcher.style.backgroundColor = 'transparent';
    launcher.style.border = '0';
    launcher.style.margin = '0';
    host.style.height = launcher.style.height;
    host.style.lineHeight = launcher.style.lineHeight;
  }

  function installSettingsOutsideClick() {
    if (document.documentElement.dataset.jpSettingsOutsideClick === '1') return;
    document.documentElement.dataset.jpSettingsOutsideClick = '1';
    document.addEventListener('click', event => {
      const host = document.getElementById('jp-plus-launcher-host');
      if (!host || !host.classList.contains('jp-settings-open')) return;
      if (host.contains(event.target)) return;
      host.classList.remove('jp-settings-open');
    }, true);
  }

  function buildPanel(isPhotoContext, isQueueMode) {
    injectStyles();
    installSettingsOutsideClick();

    const headerTarget = findHeaderIntegrationTarget();
    if (!headerTarget) {
      console.warn('[JetPhotos+] Header de conta não encontrado; launcher adiado.');
      return false;
    }

    document.querySelectorAll('#jp-plus-launcher-host').forEach(el => el.remove());
    document.querySelectorAll('#jp-like-context-widget').forEach(el => el.remove());
    document.querySelectorAll('#jp-like-widget-bubble').forEach(el => el.remove());
    document.querySelectorAll('#jp-plus-settings-panel').forEach(el => el.remove());

    const host = document.createElement(headerTarget.mode === 'account-list' ? 'li' : 'span');
    host.id = 'jp-plus-launcher-host';
    if (headerTarget.mode === 'account-list') host.className = 'nav-desktop__item';

    const launcher = document.createElement('span');
    launcher.id = 'jp-plus-launcher';
    launcher.setAttribute('role', 'menuitem');
    launcher.setAttribute('tabindex', '0');
    launcher.setAttribute('aria-label', 'JetPhotos+');
    launcher.setAttribute('title', 'JetPhotos+');
    const launcherLogo = document.createElement('img');
    launcherLogo.className = 'jp-launcher-logo';
    launcherLogo.src = chrome.runtime.getURL('icons/logo.png');
    launcherLogo.alt = '';
    launcherLogo.setAttribute('aria-hidden', 'true');
    launcher.appendChild(launcherLogo);
    host.appendChild(launcher);

    // O launcher não tem ação de clique: o comportamento é exclusivamente
    // hover/foco, igual aos menus nativos do JetPhotos.
    const submenu = document.createElement('div');
    submenu.id = 'jp-plus-submenu';
    submenu.setAttribute('role', 'menu');
    submenu.innerHTML = `
      <a href="https://github.com/samuelffer/jetphotosplus/releases" id="jp-plus-releases-link" role="menuitem" target="_blank" rel="noopener noreferrer">${t('viewReleases')}</a>
      <a href="https://github.com/samuelffer/jetphotosplus/issues" id="jp-plus-issues-link" role="menuitem" target="_blank" rel="noopener noreferrer">${t('reportIssue')}</a>
      <a href="https://samuelffer.github.io/jetphotosplus/" id="jp-plus-about-link" role="menuitem" target="_blank" rel="noopener noreferrer">${t('aboutJetPhotosPlus')}</a>
      <a href="#" id="jp-plus-settings-link" role="menuitem">${t('settings')}</a>
    `;
    if (currentSettings.siteDarkMode) submenu.classList.add('jp-dark');
    host.appendChild(submenu);

    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'jp-plus-settings-panel';
    settingsPanel.setAttribute('role', 'dialog');
    settingsPanel.setAttribute('aria-label', t('settings'));
    if (currentSettings.siteDarkMode) settingsPanel.classList.add('jp-dark');
    const settingsTitle = document.createElement('div');
    settingsTitle.className = 'jp-settings-title';
    settingsTitle.innerHTML = `<button type="button" class="jp-settings-close" aria-label="${t('close')}">×</button>${t('settings')}`;
    const settingsBody = document.createElement('div');
    settingsBody.className = 'jp-settings-body';
    settingsPanel.appendChild(settingsTitle);
    settingsPanel.appendChild(settingsBody);
    host.appendChild(settingsPanel);
    settingsPanelEl = settingsPanel;

    const settingsLink = submenu.querySelector('#jp-plus-settings-link');
    settingsLink.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!settingsMenuEl) {
        settingsBody.appendChild(buildSettingsMenu());
        settingsMenuEl = settingsBody.firstElementChild;
      }
      host.classList.add('jp-settings-open');
    });

    settingsTitle.querySelector('.jp-settings-close').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      host.classList.remove('jp-settings-open');
    });

    if (headerTarget.after && headerTarget.after.parentElement === headerTarget.container) {
      headerTarget.container.insertBefore(host, headerTarget.after.nextElementSibling);
    } else {
      headerTarget.container.appendChild(host);
    }
    styleLauncherFromReference(launcher, host, headerTarget.reference, headerTarget.container);

    panelEl = submenu;

    // A ferramenta de curtidas não fica mais no submenu do header. Ela é
    // contextual e aparece no canto inferior direito somente quando a página
    // realmente contém fotos com ação de Like.
    if (isPhotoContext && !isQueueMode) {
      const widget = document.createElement('section');
      widget.id = 'jp-like-context-widget';
      widget.setAttribute('aria-label', t('likeWidgetLabel'));
      if (currentSettings.siteDarkMode) widget.classList.add('jp-dark');
      widget.innerHTML = `
        <div class="jp-like-widget-main">
          <div class="jp-like-widget-head">${t('likeWidgetLabel')}</div>
          <div class="jp-like-widget-body">
            <div class="jp-like-widget-status" id="jp-like-widget-status">${t('analyzing')}</div>
            <div class="jp-like-widget-progress" id="jp-like-widget-progress" aria-hidden="true">
              <div class="jp-like-widget-progress-bar" id="jp-like-widget-progress-bar"></div>
            </div>
            <div class="jp-like-widget-confirm" id="jp-like-widget-confirm" aria-live="polite"></div>
          </div>
        </div>
        <button class="jp-like-widget-button" id="jp-like-all-btn" type="button">
          <svg class="jp-like-widget-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.9c0 5.2-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.9A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          <span>${t('likeMissing').replace(' faltantes',' todas').replace(' missing photos',' all')}</span>
          <svg class="jp-like-widget-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      `;
      const minBtn = document.createElement('button');
      minBtn.type = 'button';
      minBtn.id = 'jp-like-widget-min';
      minBtn.className = 'jp-like-widget-min';
      minBtn.textContent = '\u2212';
      minBtn.title = t('minimize');
      minBtn.setAttribute('aria-label', t('minimize'));
      minBtn.addEventListener('click', () => setWidgetCollapsed(true));
      widget.appendChild(minBtn);
      document.body.appendChild(widget);
      likeWidgetEl = widget;

      // Bolha recolhida: começa escondida e aparece no lugar do widget quando
      // recolhido. Criada junto pra já existir antes do primeiro refresh()
      // tentar atualizar o contador.
      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.id = 'jp-like-widget-bubble';
      bubble.title = t('expand');
      bubble.setAttribute('aria-label', t('analyzing'));
      bubble.setAttribute('aria-expanded', 'false');
      bubble.innerHTML = `
        <span class="jp-bubble-ring-wrap" aria-hidden="true">
          <svg class="jp-bubble-ring" viewBox="0 0 28 28"><circle class="jp-bubble-ring-track" cx="14" cy="14" r="12"></circle><circle class="jp-bubble-ring-fill" id="jp-bubble-ring-fill" cx="14" cy="14" r="12"></circle></svg>
          <svg class="jp-bubble-heart" viewBox="0 0 24 24"><path d="M20.8 8.9c0 5.2-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.9A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </span>
        <span id="jp-like-widget-bubble-count">\u2026</span>`;
      bubble.addEventListener('click', () => {
        // No celular a bolha é o único UI: o toque curte tudo direto (via o
        // botão escondido). Expandir/recolher pelo toque não existe no
        // celular a pedido — no desktop o toque continua expandindo.
        if (isMobileLayout()) {
          if (!isLiking && (lastBubbleMissing ?? 0) > 0) {
            document.getElementById('jp-like-all-btn')?.click();
          }
          return;
        }
        setWidgetCollapsed(false);
      });
      bubble.addEventListener('animationend', event => {
        if (event.animationName === 'jpLikePop') bubble.classList.remove('jp-bubble-pop');
      });
      document.body.appendChild(bubble);

      // Estado inicial: no celular a bolha já nasce como widget principal;
      // no desktop vale o estado salvo. Sem regravar no storage.
      setWidgetCollapsed(currentSettings.widgetCollapsed === true || isMobileLayout(), false);

      // Reaplica ao girar/redimensionar (ex: celular deitado que passa dos
      // 520px volta a mostrar o widget grande). Uma vez só por página.
      if (!mobileViewWired && typeof window.matchMedia === 'function') {
        mobileViewWired = true;
        window.matchMedia('(max-width: 520px)').addEventListener('change', event => {
          if (!document.getElementById('jp-like-context-widget')) return;
          setWidgetCollapsed(currentSettings.widgetCollapsed === true || event.matches, false);
        });
      }
    } else {
      likeWidgetEl = null;
    }

    settingsMenuEl = null;
    return true;
  }

  // Alterna widget aberto <-> bolha recolhida. O estado é persistido pra
  // continuar igual ao trocar de página; o persist=false é só pra aplicar
  // o valor salvo na montagem sem regravar à toa.
  // Layout mobile = mesma largura onde o CSS troca o widget pra barra
  // inferior (max-width: 520px). Mantido em JS também pra bolha virar o
  // widget principal no celular (ver buildPanel).
  function isMobileLayout() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 520px)').matches;
  }

  // Última contagem vista pela bolha (null = ainda analisando). É o que o
  // toque na bolha consulta pra decidir entre "curtir tudo" e "expandir".
  let lastBubbleMissing = null;
  let mobileViewWired = false;

  function setWidgetCollapsed(collapsed, persist = true) {
    currentSettings.widgetCollapsed = collapsed;
    if (persist) chrome.storage.local.set({ [STORAGE_KEY_WIDGET_COLLAPSED]: collapsed });
    const widget = document.getElementById('jp-like-context-widget');
    const bubble = document.getElementById('jp-like-widget-bubble');
    if (widget) widget.style.display = collapsed ? 'none' : '';
    if (bubble) {
      bubble.style.display = collapsed ? 'flex' : 'none';
      bubble.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  // Atualiza o contador da bolha. null = ainda analisando (mostra …).
  // Anel de progresso da bolha: 0 = vazio, 1 = fechado verde.
  const BUBBLE_RING_C = 75.4; // 2π×12, mesmo r do círculo no SVG (ver CSS)
  function setBubbleProgress(frac) {
    const fill = document.getElementById('jp-bubble-ring-fill');
    if (!fill) return;
    const clamped = Math.max(0, Math.min(1, frac || 0));
    fill.style.strokeDashoffset = String(BUBBLE_RING_C * (1 - clamped));
  }

  // Pop de conclusão na bolha (mesmo esquema do pop do joinha: classe
  // transitória + reflow pra reiniciar, limpa no animationend).
  function popBubbleDone() {
    const bubble = document.getElementById('jp-like-widget-bubble');
    if (!bubble) return;
    bubble.classList.remove('jp-bubble-pop');
    void bubble.offsetWidth;
    bubble.classList.add('jp-bubble-pop');
  }

  function updateBubble(missingOrNull) {
    const bubble = document.getElementById('jp-like-widget-bubble');
    const count = document.getElementById('jp-like-widget-bubble-count');
    if (!bubble || !count) return;
    if (missingOrNull == null) {
      lastBubbleMissing = null;
      setBubbleProgress(0);
      count.textContent = '\u2026';
      bubble.classList.remove('jp-bubble-done');
      bubble.setAttribute('aria-label', t('analyzing'));
      return;
    }
    lastBubbleMissing = missingOrNull;
    const done = missingOrNull <= 0;
    setBubbleProgress(done ? 1 : 0);
    count.textContent = done ? '0' : String(missingOrNull);
    bubble.classList.toggle('jp-bubble-done', done);
    bubble.setAttribute('aria-label', done
      ? (currentSettings.language === 'en' ? 'All liked!' : 'Tudo curtido!')
      : `${missingOrNull} ${t('missing')}`);
    bubble.title = !isMobileLayout() ? t('expand') : (done ? '' : t('likeMissing'));
  }

  function updateStatus(cards, missing) {
    // Durante a leva de curtidas, o observer pode detectar cada mutação do
    // site. Não deixe esses refreshes sobrescreverem o contador X/Y.
    if (isLiking) return;

    updateBubble(cards.length ? missing : null);

    const textEl = document.getElementById('jp-like-widget-status');
    if (!textEl) return;

    const likedCount = Math.max(0, cards.length - missing);
    const html = !cards.length
      ? t('noneFound')
      : (currentSettings.language === 'en'
          ? `${missing} ${t('missing')} / ${likedCount} ${t('liked')}`
          : `${missing} ${t('missing')} / ${likedCount} ${t('liked')}`);

    // Evita re-animar quando o texto não mudou (o observer roda com
    // frequência e o conteúdo costuma ser o mesmo entre uma chamada e outra).
    if (textEl.dataset.jpHtml === html) return;
    textEl.dataset.jpHtml = html;

    textEl.style.opacity = '0';
    setTimeout(() => {
      textEl.innerHTML = html;
      textEl.style.opacity = '1';
    }, 120);
  }

  function highlightCard(card, liked) {
    if (!card) return;

    // Só mexe no estilo se realmente precisa mudar, pra evitar mutações
    // desnecessárias no DOM (ajuda a manter o scan leve).
    const wanted = liked ? 'none' : '3px solid #ff5f5f';
    if (card.style.outline !== wanted) {
      card.style.transition = 'outline-color .2s ease';
      card.style.outline = wanted;
      card.style.outlineOffset = '2px';
    }


  }

  let isRefreshing = false;
  let likeConfirmationTimer = null;
  let likeSafetyTimer = null;

  function refresh() {
    if (isRefreshing) return; // evita reentrância
    // Durante a leva em massa, pula: cada confirmação de rede + cada mutação
    // do site pediria uma varredura completa (getBoundingClientRect/
    // getComputedStyle por card = reflow forçado), e no celular isso somava
    // dezenas de reflows seguidos e travava a página. Cada joinha já se
    // atualiza sozinho via syncPhotoVisualById (mirado, barato), e o fim da
    // leva chama refresh() de novo pra assentar contador e realces.
    if (isLiking) return null;
    isRefreshing = true;

    // Desliga o observer enquanto mexemos no DOM/estilo, e religa depois.
    // O finally abaixo garante que essas duas operações nunca fiquem
    // esquecidas caso findPhotoCards/isAlreadyLiked lance uma exceção.
    if (observerRef) observerRef.disconnect();

    try {
      injectMobileLikeButtons();
      const cards = findPhotoCards();
      let missing = 0;
      cards.forEach(({ anchor, card }) => {
        const liked = isAlreadyLiked(anchor, card);
        highlightCard(card, liked);
        // O botão injetado no layout mobile também é um "anchor" normal
        // aqui (ver findPhotoCards) — só precisa, além da classe de
        // destaque do card, ter seu próprio ícone sincronizado a cada
        // scan. Isso corrige o ícone sozinho mesmo que uma confirmação de
        // rede anterior não tenha atualizado ele por qualquer motivo.
        if (anchor?.classList?.contains(MOBILE_LIKE_BTN_CLASS)) {
          applyMobileButtonState(anchor, liked);
        }
        if (!liked) missing++;
      });

      updateStatus(cards, missing);
      return { cards, missing };
    } catch (error) {
      console.error('[JetPhotos+] Erro durante refresh():', error);
      return null;
    } finally {
      if (observerRef && observeTarget) {
        observerRef.observe(observeTarget, { childList: true, subtree: true });
      }
      isRefreshing = false;
    }
  }

  // Debounce: só executa o refresh depois que o DOM ficar "quieto" por
  // DEBOUNCE_MS. Evita rodar o scan dezenas/centenas de vezes por segundo
  // enquanto a página ainda está carregando imagens/spinners.
  const DEBOUNCE_MS = 400;
  let debounceTimer = null;
  function scheduleRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  }

  // Pequena pausa entre cada clique de "curtir": evita disparar dezenas de
  // cliques no mesmo instante (mais parecido com uso normal, e reduz
  // qualquer chance do site tratar como automação/flood). É curto de
  // propósito — a ideia é só "não ser instantâneo", não deixar lento.
  const LIKE_CLICK_DELAY_MS = 12;
  const LIKE_CLICK_JITTER_MS = 10; // variação aleatória somada ao delay, pra não ficar um intervalo perfeitamente uniforme
  let isLiking = false;

  // onDone é chamado quando todos os cliques da leva atual terminam
  // (sucesso ou lista vazia). Retorna de imediato a quantidade de fotos
  // que serão clicadas, mesmo os cliques em si sendo espaçados no tempo.
  function likeAllMissing(onDone) {
    if (isLiking) return 0; // já tem uma leva rodando, ignora clique duplo
    const cards = findPhotoCards();
    const targets = cards
      .filter(({ anchor, card }) => !isAlreadyLiked(anchor, card))
      .map(({ anchor }) => anchor);

    if (!targets.length) {
      if (onDone) onDone(0);
      return 0;
    }

    isLiking = true;
    let i = 0;
    function clickNext() {
      if (i >= targets.length) {
        isLiking = false;
        setTimeout(refresh, 500); // dá um tempo pro site atualizar o estado visual do último clique
        if (onDone) onDone(targets.length);
        return;
      }
      targets[i].click();
      i++;
      const progressBarEl = document.getElementById('jp-like-widget-progress-bar');
      const progressTextEl = document.getElementById('jp-like-widget-status');
      if (progressBarEl) progressBarEl.style.width = `${Math.min(100, (i / targets.length) * 100)}%`;
      if (progressTextEl) {
        delete progressTextEl.dataset.jpHtml;
        progressTextEl.textContent = currentSettings.language === 'en'
          ? `Liking ${i}/${targets.length} photo(s)...`
          : `Curtindo ${i}/${targets.length} foto(s)...`;
      }
      updateBubble(targets.length - i);
      setBubbleProgress(i / targets.length);
      const delay = LIKE_CLICK_DELAY_MS + Math.random() * LIKE_CLICK_JITTER_MS;
      setTimeout(clickNext, delay);
    }
    clickNext();

    return targets.length;
  }

  // =======================================================================
  // >>> INÍCIO DO BLOCO EXPERIMENTAL: ESTIMADOR DE FILA (queue.php) <<<
  // -----------------------------------------------------------------------
  // Marcado como experimental (toggle em Configurações > Experimental,
  // STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED) porque depende de "adivinhar" a
  // estrutura de texto de uma página que não controlamos — se o JetPhotos
  // mudar o layout de "Overall Queue Status", a extração pode quebrar de
  // novo (como aconteceu com o bug do período/select corrigido nesta
  // revisão). O toggle deixa fácil desligar o recurso pro usuário sem
  // precisar reinstalar nada; e, pra quem for mexer no código depois,
  // remover o recurso por completo é só apagar tudo entre este marcador e
  // o "FIM DO BLOCO EXPERIMENTAL" mais abaixo, tirar as 2 chamadas
  // marcadas com [EXPERIMENTAL] em init() e a linha do toggle em
  // buildSettingsMenu() — nenhuma outra parte do arquivo depende disso.
  // -----------------------------------------------------------------------
  // Ideia: a própria página já informa quantas fotos foram PROCESSADAS por
  // dia (coluna "processed" de cada data em "Overall Queue Status"). Isso
  // já É o throughput diário — não precisamos diffar snapshots entre
  // visitas pra descobrir o ritmo, só ler e tirar a média dos últimos dias
  // completos (o dia de hoje é sempre parcial, então é excluído da média
  // pra não puxar o número pra baixo artificialmente).
  //
  //   dias_estimados = fotos_à_frente_na_fila / média_diária_processada
  //
  // O histórico é persistido em chrome.storage.local porque o site só
  // expõe os últimos 7 dias — guardando cada dia visto, a amostra cresce
  // com o tempo mesmo que você não abra a extensão todo dia.
  // =======================================================================

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function isQueuePage() {
    return location.pathname.startsWith('/members/queue.php');
  }

  // Converte "15 August 2026" -> "2026-08-15" (chave ordenável e estável
  // pra usar como índice do histórico). Retorna null se o texto não bater
  // com o formato esperado.
  function dateLabelToKey(label) {
    const m = label.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const monthIdx = MONTHS_EN.findIndex(mo => mo.toLowerCase() === m[2].toLowerCase());
    if (monthIdx === -1) return null;
    const year = m[3];
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Data de "hoje" pelo RELÓGIO DO USUÁRIO (fuso local do computador), não
  // o do servidor do JetPhotos. Usada só pra exibição/comparação — o
  // cálculo da taxa usa a data do próprio site (getSiteTodayKey), pra não
  // misturar os dois fusos na mesma conta.
  function localTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function addDaysToDate(baseDate, days) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + Math.round(days));
    return d;
  }

  function formatDateShort(d) {
    if (currentSettings.language === 'en') {
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Diferença em dias corridos entre duas chaves "YYYY-MM-DD".
  function daysBetweenKeys(keyA, keyB) {
    const a = new Date(keyA + 'T00:00:00');
    const b = new Date(keyB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  const numFromMatch = (s) => parseInt(s.replace(/,/g, ''), 10);

  // Lê o bloco "Period Totals" como fallback imediato. O valor de
  // "Total Screened" é usado diretamente como ritmo provisório quando ainda
  // não há histórico diário suficiente no coletor em background.
  function parsePeriodTotals(fullText) {
    const screenedMatch = fullText.match(/Total Screened:\s*([\d,]+)/i);
    if (!screenedMatch) return null;
    const totalScreened = numFromMatch(screenedMatch[1]);
    if (!Number.isFinite(totalScreened) || totalScreened <= 0) return null;
    return { totalScreened, rate: totalScreened };
  }

  // Lê o bloco "Overall Queue Status" a partir do texto visível da página
  // (em vez de depender de classes/ids específicos, que não temos como
  // confirmar sem o HTML real). Retorna { totalInQueue, rows, periodTotals }
  // ou null se não achar nada reconhecível (ex: layout mudou, ou não é essa
  // página).
  function parseOverallQueueSection() {
    const fullText = document.body.innerText.replace(/\s+/g, ' ');

    const totalMatch = fullText.match(/There are currently\s+([\d,]+)\s+total photos in the queue/i);
    const totalInQueue = totalMatch ? numFromMatch(totalMatch[1]) : null;

    const rowRegex = /(\d{1,2}\s+[A-Za-z]+\s+\d{4}):\s*([\d,]+)\s+total uploads\.\s*([\d,]+)\s+not yet screened\.\s*(\d+)\s+in screening\.\s*([\d,]+)\s+processed\./gi;

    const rows = [];
    let m;
    while ((m = rowRegex.exec(fullText)) !== null) {
      const key = dateLabelToKey(m[1].trim());
      if (!key) continue; // não deveria acontecer, mas não quebra o resto se acontecer
      rows.push({
        key,
        label: m[1].trim(),
        totalUploads: numFromMatch(m[2]),
        notYetScreened: numFromMatch(m[3]),
        inScreening: parseInt(m[4], 10),
        processed: numFromMatch(m[5])
      });
    }

    if (!rows.length && totalInQueue === null) return null;

    const periodTotals = parsePeriodTotals(fullText);
    return { totalInQueue, rows, periodTotals };
  }

  // A "data de hoje" pro cálculo é a mais recente que aparece na própria
  // tabela do site (não a do relógio do usuário) — garante que o dia
  // excluído da média (por estar parcial) seja realmente o dia parcial do
  // site, mesmo que o fuso horário dele esteja defasado em relação ao do
  // usuário.
  function getSiteTodayKey(rows) {
    if (!rows.length) return null;
    return rows.reduce((max, r) => (r.key > max ? r.key : max), rows[0].key);
  }

  // O ritmo principal vem de jpQueueDailyStats, coletado pelo service worker.
  // Se ainda não houver dias fechados suficientes, o fallback imediato é o
  // "Total Screened" da própria página. Os antigos históricos baseados em
  // "processed" e snapshots da fila foram removidos porque não são mais
  // necessários e podiam introduzir estimativas inconsistentes.

  // Localiza, no DOM, a tabela cujo cabeçalho contém "QUEUE INFO" (a
  // tabela "YOUR QUEUE STATUS" do print) e tenta extrair, de cada linha, o
  // número de fotos à frente na fila.
  //
  // A legenda do rodapé ("¹ Number of photos ahead of this one in the
  // queue") indica que a célula provavelmente só tem um número (com uma
  // marca ¹), não a frase inteira — então a extração é por POSIÇÃO da
  // coluna (índice do cabeçalho "QUEUE INFO"), pegando o primeiro número
  // daquela célula específica, em vez de procurar uma frase que
  // provavelmente não existe linha a linha.
  //
  // Ainda é best-effort (não tenho o HTML real de uma linha preenchida com
  // fotos pra confirmar 100%) — se detectar algo errado na prática, me
  // manda o HTML de uma linha preenchida (botão direito > Inspecionar) que
  // eu ajusto o seletor.
  const AHEAD_TEXT_RE = /(\d[\d,]*)\s*photos?\s*ahead/i; // fallback: caso alguma linha escreva a frase por extenso
  const LEADING_NUMBER_RE = /(\d[\d,]*)/;

  function findQueueInfoRows() {
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('th, thead td'));
      const headerTexts = headerCells.map(c => c.textContent.trim().toUpperCase());
      const queueInfoIdx = headerTexts.findIndex(h => h.includes('QUEUE INFO'));
      if (queueInfoIdx === -1) continue; // essa tabela não é a que queremos

      const bodyRows = Array.from(table.querySelectorAll('tbody tr, tr'))
        .filter(tr => !tr.querySelector('th')); // pula a linha de cabeçalho

      const matches = [];
      bodyRows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const cell = cells[queueInfoIdx];
        if (!cell) return;
        const m = (cell.textContent || '').match(LEADING_NUMBER_RE);
        if (m) matches.push({ rowEl: tr, ahead: numFromMatch(m[1]) });
      });

      if (matches.length) return matches;

      // Fallback: tenta a frase por extenso em qualquer lugar da linha,
      // pro caso da coluna QUEUE INFO estar vazia mas a info aparecer
      // escrita em texto corrido em outra célula.
      bodyRows.forEach(tr => {
        const m = (tr.textContent || '').match(AHEAD_TEXT_RE);
        if (m) matches.push({ rowEl: tr, ahead: numFromMatch(m[1]) });
      });

      return matches; // achou a tabela certa (tinha "QUEUE INFO"), retorna o que conseguiu
    }
    return [];
  }

  // Formato curto para o monitor da fila. Mantém a estimativa legível
  // dentro da coluna estreita de Period Totals; as estimativas individuais
  // das fotos continuam usando formatEtaText(), que inclui a data aproximada.
  function formatEtaDurationText(days) {
    if (days == null || !Number.isFinite(days)) return null;
    const totalHours = Math.max(0, Math.round(days * 24));
    const wholeDays = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (wholeDays > 0 && hours > 0) {
      return currentSettings.language === 'en'
        ? `≈ ${wholeDays} day${wholeDays === 1 ? '' : 's'} ${hours}h`
        : `≈ ${wholeDays} dia${wholeDays === 1 ? '' : 's'} e ${hours}h`;
    }
    if (wholeDays > 0) {
      return currentSettings.language === 'en'
        ? `≈ ${wholeDays} day${wholeDays === 1 ? '' : 's'}`
        : `≈ ${wholeDays} dia${wholeDays === 1 ? '' : 's'}`;
    }
    return `≈ ${hours}h`;
  }

  function formatEtaText(days) {
    if (days == null || !Number.isFinite(days)) return null;
    const totalHours = Math.max(0, Math.round(days * 24));
    const wholeDays = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const target = addDaysToDate(new Date(), totalHours / 24); // relógio local do usuário
    let duration;
    if (wholeDays > 0 && hours > 0) {
      duration = currentSettings.language === 'en'
        ? `${wholeDays} day${wholeDays === 1 ? '' : 's'} ${hours}h`
        : `${wholeDays} dia${wholeDays === 1 ? '' : 's'} e ${hours}h`;
    } else if (wholeDays > 0) {
      duration = currentSettings.language === 'en'
        ? `${wholeDays} day${wholeDays === 1 ? '' : 's'}`
        : `${wholeDays} dia${wholeDays === 1 ? '' : 's'}`;
    } else {
      duration = currentSettings.language === 'en' ? `${hours}h` : `${hours}h`;
    }
    return `≈ ${duration} (${t('aroundDate')} ${formatDateShort(target)})`;
  }

  // Injeta (ou atualiza, se já existir) um pequeno texto de estimativa
  // logo após a célula "QUEUE INFO" de cada linha detectada. Marca a linha
  // com um data-attribute pra não duplicar o badge em reprocessamentos
  // (ex: reobservação do DOM depois de trocar o período no dropdown).
  function injectInlineEstimate(rowEl, days) {
    const text = formatEtaText(days);
    let badge = rowEl.querySelector('.jp-queue-eta-badge');
    if (!text) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'jp-queue-eta-badge';
      badge.style.cssText = `
        margin-top:4px; font-size:12px; font-weight:600; color:#1a73e8;
        display:flex; align-items:center; gap:4px;
      `;
      // Anexa na última célula da linha (geralmente QUEUE INFO ou ACTIONS,
      // qualquer uma das duas é um lugar visualmente razoável).
      const cells = rowEl.querySelectorAll('td');
      const target = cells[cells.length - 1] || rowEl;
      target.appendChild(badge);
    }
    badge.textContent = text;
  }

  // -----------------------------------------------------------------------
  // v1.8.6 — Histórico automático do Total Screened
  //
  // O background.js observa o contador periodicamente e guarda o maior
  // Total Screened visto em cada dia do JetPhotos. Aqui o painel só lê esse histórico.
  // Dias fechados são usados para a média; enquanto ainda não há histórico
  // fechado suficiente, o valor máximo observado do dia atual serve como
  // estimativa provisória.
  // -----------------------------------------------------------------------
  function loadQueueDailyStats() {
    const key = STORAGE_KEY_QUEUE_DAILY_STATS;
    return new Promise(resolve => {
      if (!isExtensionContextAlive()) { resolve({}); return; }
      try {
        chrome.storage.local.get([key], result => {
          try {
            if (chrome.runtime.lastError) { resolve({}); return; }
          } catch (_) { resolve({}); return; }
          resolve(result?.[key] || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function getDailyAnalyzedValue(stats, key) {
    const item = stats?.[key];
    if (!item) return null;
    // Total Screened é a métrica canônica do estimador.
    // O histórico diário representa o maior valor observado naquele dia.
    return Number.isFinite(item.maxScreened) ? item.maxScreened : null;
  }

  function getHistoryDays(stats) {
    return Object.keys(stats || {})
      .filter(key => key !== '__meta' && /^\d{4}-\d{2}-\d{2}$/.test(key))
      .sort();
  }

  function getClosedDailyRates(stats, excludeKey) {
    const keys = getHistoryDays(stats);
    const values = [];
    for (let i = keys.length - 1; i >= 0 && values.length < QUEUE_RATE_SAMPLE_DAYS; i--) {
      const key = keys[i];
      if (key === excludeKey) continue;
      const item = stats[key];
      if (!item?.closed) continue;
      const value = getDailyAnalyzedValue(stats, key);
      if (Number.isFinite(value) && value > 0) values.push(value);
    }
    return values;
  }

  function computeDailyTrackerRate(stats, siteTodayKey) {
    const values = getClosedDailyRates(stats, siteTodayKey);
    if (!values.length) return null;
    return {
      rate: values.reduce((sum, value) => sum + value, 0) / values.length,
      sampleSize: values.length
    };
  }

  function getChartSeries(stats, siteTodayKey) {
    const keys = getHistoryDays(stats);
    return keys.slice(-QUEUE_CHART_MAX_DAYS).map(key => {
      const item = stats[key] || {};
      const value = getDailyAnalyzedValue(stats, key);
      return {
        key,
        analyzed: Number.isFinite(value) ? value : 0,
        closed: Boolean(item.closed),
        today: key === siteTodayKey,
        samples: Number(item.samples || 0)
      };
    });
  }

  let lastQueueRate = null; // guardado pra reaproveitar no cálculo por linha (fotos à frente / ritmo)


  function renderQueueHistoryChart(stats, siteTodayKey) {
    const host = document.getElementById('jp-queue-history');
    if (!host) return;
    const series = getChartSeries(stats, siteTodayKey);
    const meaningful = series.filter(item => item.analyzed > 0);
    if (!meaningful.length) {
      host.innerHTML = `<div style="font-size:10px;opacity:.6;padding:8px 0;">${t('historyNoData')}</div>`;
      return;
    }

    const W = 420, H = 176;
    const pad = { left: 42, right: 8, top: 10, bottom: 28 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxValue = Math.max(1, ...series.map(item => item.analyzed));
    const tickCount = 4;
    const barGap = series.length > 35 ? 2 : 5;
    const barW = Math.max(2, (plotW / Math.max(1, series.length)) - barGap);
    const fmt = value => value.toLocaleString(currentSettings.language === 'en' ? 'en-US' : 'pt-BR');
    const shortDate = key => {
      const [y,m,d] = key.split('-');
      return `${d}/${m}`;
    };

    const yTicks = Array.from({length: tickCount + 1}, (_, i) => Math.round((maxValue / tickCount) * i));
    const grid = yTicks.map(value => {
      const y = pad.top + plotH - (value / maxValue) * plotH;
      return `<line class="jp-queue-grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W-pad.right}" y2="${y.toFixed(1)}"></line><text class="jp-queue-axis" x="${pad.left-5}" y="${(y+3).toFixed(1)}" text-anchor="end">${fmt(value)}</text>`;
    }).join('');

    const bars = series.map((item, i) => {
      const x = pad.left + i * (plotW / series.length) + barGap / 2;
      const height = (item.analyzed / maxValue) * plotH;
      const y = pad.top + plotH - height;
      const cls = item.today ? 'jp-queue-bar jp-today' : 'jp-queue-bar';
      const title = item.closed ? '' : ' • ' + (currentSettings.language === 'en' ? 'today / partial' : 'hoje / parcial');
      return `<rect class="${cls}" data-index="${i}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(2,barW).toFixed(2)}" height="${Math.max(0.8,height).toFixed(2)}" rx="2"><title>${shortDate(item.key)} — ${fmt(item.analyzed)} ${currentSettings.language === 'en' ? 'photos' : 'fotos'}${title}</title></rect>`;
    }).join('');

    const labelIndexes = series.length <= 10
      ? series.map((_, i) => i)
      : [0, Math.floor((series.length-1)/2), series.length-1];
    const labels = labelIndexes.map(i => {
      const x = pad.left + i * (plotW / series.length) + (plotW / series.length)/2;
      return `<text class="jp-queue-axis" x="${x.toFixed(1)}" y="${H-7}" text-anchor="middle">${shortDate(series[i].key)}</text>`;
    }).join('');

    host.innerHTML = `
      <div class="jp-queue-history-title"><span>${t('historyChart')}</span><span class="jp-queue-history-hint">${t('historyChartHint')}</span></div>
      <div class="jp-queue-history-chart">
        <svg class="jp-queue-history-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="${t('historyChart')}">${grid}${bars}${labels}</svg>
        <div class="jp-queue-tooltip" id="jp-queue-history-tooltip"></div>
      </div>`;

    const svg = host.querySelector('.jp-queue-history-svg');
    const tooltip = host.querySelector('.jp-queue-tooltip');
    const chart = host.querySelector('.jp-queue-history-chart');
    if (!svg || !tooltip || !chart) return;
    svg.querySelectorAll('.jp-queue-bar').forEach(bar => {
      const show = event => {
        const index = Number(bar.dataset.index);
        const item = series[index];
        tooltip.innerHTML = `<strong>${fmt(item.analyzed)} ${currentSettings.language === 'en' ? 'photos' : 'fotos'}</strong>${shortDate(item.key)}${item.today ? ` · ${currentSettings.language === 'en' ? 'today' : 'hoje'}` : ''}`;
        tooltip.style.display = 'block';
        const rect = chart.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        const left = Math.max(4, Math.min(rect.width - 145, b.left - rect.left + b.width / 2 - 66));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(0, b.top - rect.top - 42)}px`;
      };
      bar.addEventListener('mouseenter', show);
      bar.addEventListener('mousemove', show);
      bar.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    });
  }

  // Mostra o estado do coletor automático diretamente na página do JetPhotos.
  // Isso é apenas uma interface de diagnóstico/experimental: a fonte dos
  // dados continua sendo o background.js + chrome.storage.local.
  function renderQueueTrackerSiteCard(dailyStats, siteTodayKey, parsed, collectorResult) {
    if (!isQueuePage()) return;

    const h2 = Array.from(document.querySelectorAll('h2')).find(el =>
      /Overall Queue Status/i.test(el.textContent || '')
    );
    if (!h2) return;

    const section = h2.closest('.main__section, section') || h2.parentElement;
    if (!section) return;

    // Em vez de criar um "card" com aparência de outra aplicação, o
    // monitor usa a própria coluna de Period Totals do JetPhotos.
    // Isso deixa o recurso visualmente integrado à página original.
    const grid = h2.nextElementSibling;
    const columns = grid ? Array.from(grid.children) : [];
    const totalsColumn = columns.find(col => {
      const caption = col.querySelector('table caption');
      return caption && /Period Totals/i.test(caption.textContent || '');
    }) || null;

    let card = document.getElementById('jp-site-queue-tracker');
    if (!card) {
      card = document.createElement('div');
      card.id = 'jp-site-queue-tracker';

      if (totalsColumn) {
        const totalsTable = Array.from(totalsColumn.querySelectorAll('table')).find(table => {
          const caption = table.querySelector('caption');
          return caption && /^Period Totals$/i.test((caption.textContent || '').trim());
        });
        if (totalsTable) totalsTable.classList.add('jp-plus-dark-native-table');

        if (totalsTable) {
          totalsTable.insertAdjacentElement('afterend', card);
        } else {
          totalsColumn.appendChild(card);
        }
      } else {
        // Fallback para mudanças futuras no HTML do JetPhotos.
        // Continua abaixo do bloco Overall Queue Status, sem quebrar a página.
        const firstGridChild = grid && grid.parentElement === section ? grid : null;
        if (firstGridChild) firstGridChild.insertAdjacentElement('afterend', card);
        else section.appendChild(card);
      }
    }

    const today = dailyStats[siteTodayKey] || {};
    const closedValues = getClosedDailyRates(dailyStats, siteTodayKey);
    const average = closedValues.length
      ? closedValues.reduce((sum, value) => sum + value, 0) / closedValues.length
      : null;

    // "Screened today" e "maximum observed" são o mesmo valor que nos
    // interessa no dia atual: o maior Total Screened que o coletor conseguiu
    // observar. Não mostramos os dois para evitar informação duplicada.
    const todayScreened = collectorResult?.ok
      ? collectorResult.maxScreened
      : (today.maxScreened ?? parsed?.periodTotals?.totalScreened ?? null);

    const lastObservedAt = collectorResult?.ok
      ? collectorResult.stats?.__meta?.lastObservedAtMs
      : dailyStats.__meta?.lastObservedAtMs;

    const timeText = lastObservedAt
      ? new Date(lastObservedAt).toLocaleTimeString(currentSettings.language === 'en' ? 'en-US' : 'pt-BR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';

    const todayText = todayScreened != null
      ? todayScreened.toLocaleString(currentSettings.language === 'en' ? 'en-US' : 'pt-BR')
      : '—';

    const averageText = average != null
      ? `~${Math.round(average).toLocaleString(currentSettings.language === 'en' ? 'en-US' : 'pt-BR')}/${currentSettings.language === 'en' ? 'day' : 'dia'}`
      : t('collectingHistory');

    let etaText = '—';
    const rateForEta = average || todayScreened;
    if (rateForEta && parsed?.totalInQueue != null) {
      etaText = formatEtaDurationText(parsed.totalInQueue / rateForEta) || '—';
    }

    const basisText = average != null ? t('avgClosed', closedValues.length) : t('noHistoryNote');

    // O monitor fica dentro da mesma coluna/tabela do Period Totals e herda
    // diretamente a tipografia do JetPhotos. Não forçamos Roboto, Arial ou
    // outro tamanho: a ideia é que os textos tenham exatamente a mesma
    // presença visual das células nativas do site.
    card.style.cssText = `
      box-sizing:border-box;
      width:100%;
      margin-top:18px;
      color:inherit;
      font-family:inherit;
      font-size:inherit;
    `;

    card.innerHTML = `
      <table class="table table--statistics jp-plus-queue-table" style="width:100%;margin:0;table-layout:fixed;">
        <caption style="text-align:left;">${t('queueEstimate')} <span class="jp-plus-experimental">${t('experimental')}</span></caption>
        <tbody>
          <tr class="table__row jp-plus-queue-row">
            <td class="table__cell jp-plus-metric">
              <div class="jp-plus-metric-inner"><span>${t('screenedToday')}</span><strong>${todayText}</strong></div>
            </td>
            <td class="table__cell jp-plus-metric">
              <div class="jp-plus-metric-inner"><span>${t('dailyAverage')}</span><strong>${averageText}</strong></div>
            </td>
          </tr>
          <tr class="table__row">
            <td class="table__cell jp-plus-metric">
              <div class="jp-plus-metric-inner"><span>${t('estimatedQueueTime')}</span><strong>${etaText}</strong></div>
            </td>
            <td class="table__cell jp-plus-metric">
              <div class="jp-plus-metric-inner"><span>${t('lastCollection')}</span><strong>${timeText}</strong></div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="jp-queue-history" id="jp-queue-history"></div>

      <div class="jp-plus-queue-note">
        <span>${basisText}</span>
        <button id="jp-site-queue-tracker-refresh" type="button">${t('collectNow')}</button>
      </div>
    `;

    renderQueueHistoryChart(dailyStats, siteTodayKey);

    const styleId = 'jp-plus-queue-native-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #jp-site-queue-tracker {
          font-family: inherit;
        }

        #jp-site-queue-tracker .jp-plus-queue-table {
          font-family: inherit;
          border-collapse: collapse;
        }

        #jp-site-queue-tracker .jp-plus-queue-table caption {
          font-family: inherit;
          font-weight: 600;
          font-size: inherit;
          line-height: normal;
          padding: 0 0 6px 0;
          text-align: left;
        }

        #jp-site-queue-tracker .jp-plus-experimental {
          font-size: 9px;
          font-weight: normal;
          opacity: .65;
          vertical-align: middle;
          margin-left: 3px;
        }

        #jp-site-queue-tracker .jp-plus-queue-table td,
        #jp-site-queue-tracker .jp-plus-metric,
        #jp-site-queue-tracker .jp-plus-metric span,
        #jp-site-queue-tracker .jp-plus-metric strong {
          font-family: inherit;
          font-size: inherit;
          line-height: normal;
        }

        #jp-site-queue-tracker .jp-plus-metric {
          width:50%;
          vertical-align:middle;
          box-sizing:border-box;
          padding:7px 9px;
        }

        #jp-site-queue-tracker .jp-plus-metric-inner {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:6px;
          min-width:0;
          white-space:nowrap;
        }

        #jp-site-queue-tracker .jp-plus-metric span {
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }

        #jp-site-queue-tracker .jp-plus-metric strong {
          flex:0 0 auto;
          white-space:nowrap;
          text-align:right;
          font-weight:700;
        }

        #jp-site-queue-tracker .jp-plus-queue-note {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          margin-top:7px;
          font-size:10px;
          line-height:1.35;
          color:inherit;
          opacity:.72;
        }

        #jp-site-queue-tracker .jp-plus-queue-note > span {
          min-width:0;
        }

        #jp-site-queue-tracker button {
          appearance: none;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 10px;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          white-space: nowrap;
        }

        #jp-site-queue-tracker button:hover {
          opacity: .7;
        }

        #jp-site-queue-tracker .jp-queue-history {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid currentColor;
          opacity: .92;
        }
        #jp-site-queue-tracker .jp-queue-history-title {
          display:flex; align-items:baseline; justify-content:space-between; gap:10px;
          margin-bottom:8px; font-size:12px; font-weight:600;
        }
        #jp-site-queue-tracker .jp-queue-history-hint {
          font-size:10px; font-weight:400; opacity:.62;
        }
        #jp-site-queue-tracker .jp-queue-history-chart {
          position:relative; width:100%; overflow:visible;
        }
        #jp-site-queue-tracker .jp-queue-history-svg {
          display:block; width:100%; height:176px; overflow:visible;
        }
        #jp-site-queue-tracker .jp-queue-grid {
          stroke: currentColor; stroke-width:1; opacity:.14; vector-effect:non-scaling-stroke;
        }
        #jp-site-queue-tracker .jp-queue-axis {
          fill:currentColor; opacity:.62; font-size:10px;
        }
        #jp-site-queue-tracker .jp-queue-bar {
          fill:#4299dc; opacity:.84; rx:2;
        }
        #jp-site-queue-tracker .jp-queue-bar.jp-today { opacity:1; }
        #jp-site-queue-tracker .jp-queue-tooltip {
          position:absolute; z-index:5; pointer-events:none; display:none;
          min-width:132px; padding:7px 9px; box-sizing:border-box;
          border:1px solid rgba(255,255,255,.18); border-radius:5px;
          background:#202124; color:#fff; box-shadow:0 3px 12px rgba(0,0,0,.28);
          font-size:10px; line-height:1.35; white-space:nowrap;
        }
        #jp-site-queue-tracker .jp-queue-tooltip strong { display:block; font-size:12px; margin-bottom:2px; }

        @media (max-width: 700px) {
          #jp-site-queue-tracker .jp-plus-queue-note {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const refresh = card.querySelector('#jp-site-queue-tracker-refresh');
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        refresh.textContent = t('collecting');

        try {
          const result = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'jp-collect-queue-now' }, response => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(response || null);
            });
          });

          const fresh = await loadQueueDailyStats();
          renderQueueTrackerSiteCard(fresh, siteTodayKey, parsed, result);
        } finally {
          // O botão pode ter sido recriado durante a renderização.
          refresh.disabled = false;
          refresh.textContent = t('collectNow');
        }
      });
    }
  }

  // Estimativa GERAL (pra quem ainda não tem foto na fila, ou quer saber
  // "se eu enviar agora, quanto tempo demora"): fila total do site dividido
  // pelo ritmo real de avaliação. Usa SEMPRE o mesmo "rate" da linha acima
  // (Ritmo atual). Na v1.8.6, a prioridade é a média dos dias fechados
  // observados automaticamente; antes de existir histórico suficiente,
  // usamos o maior Total Screened observado no dia atual.
  // "processed" (verde) de cada linha, que é só o progresso parcial de um
  // lote específico e não reflete o throughput real do site.
  function computeGeneralEtaDays(totalInQueue, rate) {
    if (totalInQueue == null || rate == null || rate <= 0) return null;
    return totalInQueue / rate;
  }

  function renderQueueRate(rate, totalInQueue, errorMsg, meta) {
    lastQueueRate = rate;
    const rateEl = document.getElementById('jp-queue-rate-text');
    const generalEl = document.getElementById('jp-queue-general-eta');
    const noteEl = document.getElementById('jp-queue-note');
    if (!rateEl) return;

    if (errorMsg) {
      rateEl.textContent = errorMsg;
      if (generalEl) generalEl.textContent = '';
      if (noteEl) noteEl.textContent = '';
      return;
    }

    if (rate == null) {
      rateEl.textContent = t('buildingHistory');
      if (generalEl) generalEl.textContent = '';
      if (noteEl) noteEl.textContent = '';
      return;
    }

    let basisLabel;
    if (meta && meta.basis === 'daily_tracker') {
      basisLabel = t('rateClosed', meta.sampleSize);
    } else if (meta && meta.basis === 'daily_tracker_today') {
      basisLabel = t('rateToday');
    } else if (meta && meta.basis === 'period_totals_today') {
      basisLabel = t('ratePeriod');
    } else if (meta && meta.basis === 'snapshot') {
      basisLabel = t('rateSnapshot', meta.sampleSize);
    } else if (meta && meta.isFallback) {
      basisLabel = t('rateFallback');
    } else {
      basisLabel = '';
    }

    rateEl.innerHTML = t('currentRate', rate, basisLabel);

    if (generalEl) {
      const generalDays = computeGeneralEtaDays(totalInQueue, rate);
      const eta = formatEtaText(generalDays);
      generalEl.innerHTML = eta ? t('generalEta', eta) : '';
    }

    if (noteEl) {
      let noteText = totalInQueue != null
        ? t('queueTotal', totalInQueue)
        : '';
      if (meta && meta.timezoneDiffDays) {
        noteText += meta.timezoneDiffDays > 0 ? t('timezoneAhead', meta.timezoneDiffDays) : t('timezoneBehind', meta.timezoneDiffDays);
      }
      noteEl.textContent = noteText;
    }
  }

  // Acima desse número de fotos detectadas na fila do usuário, a lista
  // ganha rolagem própria (altura máxima fixa) em vez de esticar o painel
  // verticalmente sem limite — o JetPhotos permite até 20 fotos em fila ao
  // mesmo tempo, então no pior caso a lista inteira ainda cabe rolando.
  const QUEUE_LIST_SCROLL_THRESHOLD = 5;
  const QUEUE_LIST_MAX_HEIGHT_PX = 180;

  function renderQueuePhotoEstimates(rows) {
    const listEl = document.getElementById('jp-queue-list');
    const labelEl = document.getElementById('jp-queue-list-label');
    if (!listEl) return;

    rows.forEach(({ rowEl, ahead }) => {
      injectInlineEstimate(rowEl, lastQueueRate != null ? ahead / lastQueueRate : null);
    });

    if (!rows.length) {
      if (labelEl) labelEl.style.display = 'none';
      listEl.style.cssText = 'margin-bottom:14px;';
      listEl.innerHTML = `
        <div style="font-size:12.5px; color:var(--jp-subtext); line-height:1.5;">
          ${t('noPhotosQueue')}
        </div>`;
      return;
    }

    if (labelEl) labelEl.style.display = 'block';

    // Com poucas fotos, a lista fica "solta" no painel (comportamento
    // anterior). Com muitas, vira uma caixinha com scroll — assim o
    // painel inteiro não estica pra fora da tela em fotógrafos com fila
    // cheia.
    if (rows.length > QUEUE_LIST_SCROLL_THRESHOLD) {
      listEl.style.cssText = `
        margin-bottom:14px; max-height:${QUEUE_LIST_MAX_HEIGHT_PX}px;
        overflow-y:auto; border:1px solid var(--jp-border); border-radius:12px; padding:2px 10px;
      `;
    } else {
      listEl.style.cssText = 'margin-bottom:14px;';
    }

    listEl.innerHTML = rows.map(({ ahead }) => {
      const days = lastQueueRate != null ? ahead / lastQueueRate : null;
      const eta = formatEtaText(days) || t('noRate');
      return `<div style="font-size:13px; color:var(--jp-text); padding:4px 0;">${t('photosAhead', ahead, eta)}</div>`;
    }).join('');
  }

  async function runQueueScan() {
    const parsed = parseOverallQueueSection();
    if (!parsed) {
      renderQueueRate(null, null, t('queueReadError'));
      return;
    }

    const siteTodayKey = getSiteTodayKey(parsed.rows) || localTodayKey();
    const timezoneDiffDays = daysBetweenKeys(siteTodayKey, localTodayKey());

    // Pede uma coleta imediata ao background. Assim, ao abrir queue.php,
    // o usuário não precisa esperar o próximo alarme de 10 minutos.
    let collectorResult = null;
    if (isExtensionContextAlive()) {
      try {
        collectorResult = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'jp-collect-queue-now' }, response => {
            try {
              if (chrome.runtime.lastError) { resolve(null); return; }
            } catch (_) { resolve(null); return; }
            resolve(response || null);
          });
        });
      } catch (_) {
        collectorResult = null;
      }
    }

    const dailyStats = await loadQueueDailyStats();
    const trackedToday = dailyStats[siteTodayKey];
    const closedRate = computeDailyTrackerRate(dailyStats, siteTodayKey);

    const meta = { timezoneDiffDays };
    let rate;

    if (closedRate) {
      rate = closedRate.rate;
      meta.basis = 'daily_tracker';
      meta.sampleSize = closedRate.sampleSize;
      meta.isFallback = false;
    } else if (trackedToday && Number(trackedToday.maxScreened || 0) > 0) {
      rate = trackedToday.maxScreened;
      meta.basis = 'daily_tracker_today';
      meta.sampleSize = 1;
      meta.isFallback = true;
    } else if (parsed.periodTotals) {
      // Fallback imediato: se o background ainda não conseguiu salvar o
      // contador, usamos o valor que já está no DOM desta própria página.
      rate = parsed.periodTotals.rate;
      meta.basis = 'period_totals_today';
      meta.sampleSize = 1;
      meta.isFallback = true;
    } else {
      rate = null;
      meta.basis = 'unavailable';
      meta.isFallback = true;
    }

    if (collectorResult?.ok) {
      meta.lastObserved = collectorResult.totalScreened;
      meta.trackedMaxToday = collectorResult.maxScreened;
    }

    renderQueueRate(rate, parsed.totalInQueue, null, meta);

    // Mostra o monitor também dentro da própria página do JetPhotos.
    // O dado continua vindo do background; este card é apenas visual.
    const latestDailyStats = await loadQueueDailyStats();
    renderQueueTrackerSiteCard(latestDailyStats, siteTodayKey, parsed, collectorResult);

    const userRows = findQueueInfoRows();
    renderQueuePhotoEstimates(userRows);
  }

  const QUEUE_DEBOUNCE_MS = 500;
  let queueDebounceTimer = null;
  let queueScanInFlight = false;
  let queueObserver = null;

  function isJetPhotosPlusNode(node) {
    if (!(node instanceof Element)) return false;
    return node.matches('#jp-site-queue-tracker, #jp-like-context-widget, #jp-plus-launcher-host, .jp-queue-eta-badge') ||
      !!node.closest('#jp-site-queue-tracker, #jp-like-context-widget, #jp-plus-launcher-host, .jp-queue-eta-badge');
  }

  function mutationComesOnlyFromExtension(mutation) {
    const changedNodes = [
      ...Array.from(mutation.addedNodes),
      ...Array.from(mutation.removedNodes)
    ];
    if (!changedNodes.length) return isJetPhotosPlusNode(mutation.target);
    return changedNodes.every(isJetPhotosPlusNode);
  }

  async function runQueueScanSafely() {
    if (!isExtensionContextAlive() || queueScanInFlight) return;
    queueScanInFlight = true;
    try {
      await runQueueScan();
    } catch (error) {
      // Não deixe callbacks de timer/MutationObserver gerarem "Uncaught (in promise)".
      if (!isContextInvalidatedError(error)) {
        console.error('[JetPhotos+] Falha ao atualizar os dados da fila:', error);
      }
    } finally {
      queueScanInFlight = false;
    }
  }

  function scheduleQueueRefresh() {
    clearTimeout(queueDebounceTimer);
    queueDebounceTimer = setTimeout(() => { void runQueueScanSafely(); }, QUEUE_DEBOUNCE_MS);
  }

  function initQueueEstimator() {
    void runQueueScanSafely();

    // O dropdown "Show status for" pode recarregar o bloco via AJAX sem
    // navegar de página — reobservamos o DOM (com debounce) pra reagir
    // a isso, no mesmo padrão usado pro scan de curtidas.
    const target = document.querySelector('main') || document.body;
    queueObserver = new MutationObserver(mutations => {
      const hasRelevantMutation = mutations.some(mutation => !mutationComesOnlyFromExtension(mutation));
      if (hasRelevantMutation) scheduleQueueRefresh();
    });
    queueObserver.observe(target, { childList: true, subtree: true });

    // (campo de cálculo manual removido a pedido — a extensão agora só
    // mostra o ritmo geral e, quando detecta linhas na tabela "YOUR QUEUE
    // STATUS", a estimativa de cada foto, tudo automaticamente ao abrir a
    // página. Ver runQueueScan() -> renderQueueRate() / renderQueuePhotoEstimates())

    const refreshBtn = document.getElementById('jp-queue-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        const icon = refreshBtn.querySelector('svg');
        if (icon) {
          icon.classList.remove('jp-refresh-spin');
          void icon.getBoundingClientRect();
          icon.classList.add('jp-refresh-spin');
        }
        void runQueueScanSafely();
      });
    }
  }
  // >>> FIM DO BLOCO EXPERIMENTAL: ESTIMADOR DE FILA <<<
  // =======================================================================

  let observerRef = null;
  let observeTarget = null;

  async function init() {
    currentSettings = await getSettings();

    applySiteDarkMode(currentSettings.siteDarkMode);
    // A primeira recolorização (síncrona, dentro de applySiteDarkMode) já
    // terminou aqui — seguro revelar a página agora, sem flash do tema
    // claro original. Se o modo escuro estiver desligado, isso é um no-op
    // (a classe de preload nunca foi adicionada).
    removePreloadHide();

    // A extensão agora carrega em TODAS as páginas do jetphotos.com (veja
    // o manifest.json). O header é global; ferramentas contextuais ficam
    // separadas da navegação para não transformar o menu em um painel.
    // isQueue tem prioridade (queue.php também "bate" em getPageContextLabel,
    // mas não tem botões de curtir — são corpos mutuamente exclusivos).
    // Fora das duas, o painel abre compacto e serve apenas como acesso ao
    // JetPhotos+; o estimador mantém suas configurações próprias em queue.php.
    const isQueue = isQueuePage();
    const isPhotoContext = !isQueue && (Boolean(getPageContextLabel()) || document.querySelectorAll('img[alt="Like"], img[title="Like"]').length > 0);

    const panelBuilt = buildPanel(isPhotoContext, isQueue);
    if (panelBuilt === false) {
      let attempts = 0;
      const retryHeader = setInterval(() => {
        attempts++;
        if (findHeaderIntegrationTarget() || attempts >= 30) {
          clearInterval(retryHeader);
          if (attempts < 30 && !panelEl) {
            const rebuilt = buildPanel(isPhotoContext, isQueue);
            if (rebuilt !== false) {
              // O submenu permanece fechado até hover/foco.
            }
          }
        }
      }, 200);
      return;
    }

    // O submenu é próprio da extensão e aparece em todas as páginas por
    // hover/foco no JETPHOTOS+. Contém atalhos de novidades, suporte, sobre e configurações.
    // O conteúdo de curtidas fica separado, no canto inferior direito, nas
    // páginas que realmente possuem fotos com ação de Like.

    // O widget contextual só passa a ser funcional quando encontra fotos
    // com ação de Like. Em páginas sem fotos, ele permanece oculto.
    if (isPhotoContext) {
      wireLikeSync();
      scheduleRefresh();

      const likeButton = document.getElementById('jp-like-all-btn');
      if (likeButton) likeButton.addEventListener('click', () => {
        const btn = document.getElementById('jp-like-all-btn');
        const textEl = document.getElementById('jp-like-widget-status');

        const total = likeAllMissing((doneCount = 0) => {
          // onDone: reabilita o botão quando a leva de cliques termina.
          updateBubble(0); // a leva terminou: bolha mostra 0 + anel fechado (o refresh final confirma)
          document.getElementById('jp-like-widget-bubble')?.classList.remove('jp-bubble-liking');
          if (doneCount > 0) popBubbleDone(); // pop de conclusão (só quando curtiu algo de fato)
          if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          }

          clearTimeout(likeSafetyTimer);
          const confirmEl = document.getElementById('jp-like-widget-confirm');
          const progressEl = document.getElementById('jp-like-widget-progress');
          if (confirmEl && total > 0) {
            confirmEl.textContent = currentSettings.language === 'en' ? '✓ All liked!' : '✓ Tudo curtido!';
            confirmEl.style.display = 'block';
            clearTimeout(likeConfirmationTimer);
            likeConfirmationTimer = setTimeout(() => {
              confirmEl.style.display = 'none';
              refresh();
            }, 2000);
          }
          if (progressEl) progressEl.style.display = 'none';
        });

        if (total > 0 && btn) {
          btn.disabled = true;
          btn.style.opacity = '.6';
          btn.style.cursor = 'default';
        }
        // Feedback na bolha (principalmente no celular, onde o widget está escondido).
        document.getElementById('jp-like-widget-bubble')?.classList.toggle('jp-bubble-liking', total > 0);

        if (textEl) {
          // O texto abaixo é escrito diretamente durante a leva. Invalide o
          // cache usado por updateStatus(), para que o refresh final sempre
          // possa substituir o estado "Curtindo X/Y..." pelo estado real.
          delete textEl.dataset.jpHtml;
          textEl.textContent = total > 0
            ? (currentSettings.language === 'en' ? `Liking 0/${total} photo(s)...` : `Curtindo 0/${total} foto(s)...`)
            : (currentSettings.language === 'en' ? 'Nothing missing here!' : 'Nada faltando por aqui!');
        }

        const progressEl = document.getElementById('jp-like-widget-progress');
        const progressBarEl = document.getElementById('jp-like-widget-progress-bar');
        if (total > 0 && progressEl && progressBarEl) {
          progressEl.style.display = 'block';
          progressBarEl.style.width = '0%';
        }

        // Rede de segurança: se o estado continuar preso em "Curtindo..." por
        // aproximadamente 6s, força um refresh mesmo que o observer/debounce falhe.
        if (total > 0) {
          clearTimeout(likeSafetyTimer);
          likeSafetyTimer = setTimeout(() => {
            const currentText = textEl ? textEl.textContent : '';
            if (currentText.includes('Curtindo') || currentText.includes('Liking')) {
              refresh();
            }
          }, 6000);
        }
      });

      // Tenta restringir a observação à área de resultados de fotos em vez
      // do <body> inteiro, pra reduzir o volume de mutações capturadas
      // (o body inteiro inclui spinners, menus, tudo). Se não achar uma
      // área específica, cai no body mesmo — com debounce isso já é seguro.
      observeTarget =
        document.querySelector('#search-results') ||
        document.querySelector('.search-results') ||
        document.querySelector('main') ||
        document.body;

      observerRef = new MutationObserver(() => scheduleRefresh());
      observerRef.observe(observeTarget, { childList: true, subtree: true });
    }

    // [EXPERIMENTAL] Estimador de fila: só roda em queue.php, com o recurso
    // ligado (padrão: ligado — toggle em Configurações > Experimental), e é
    // independente do bloco de curtidas acima (nunca rodam juntos na mesma
    // página). Se o recurso estiver desligado, buildPanel() já não criou
    // nenhum dos elementos que initQueueEstimator() espera encontrar, então
    // nem tentamos chamá-la.
    if (isQueue && currentSettings.queueEstimatorEnabled) {
      initQueueEstimator();
    }

    // [EXPERIMENTAL] Inicia (se o modo escuro do site estiver ligado) o
    // observer que corrige cores erradas (background-image e fundos
    // sólidos escuros) — independe da ferramenta contextual, roda em qualquer
    // página, já que o modo escuro do site também é global.
    startBgObserverIfNeeded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
