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
  // restante do script (init() -> applySiteDarkMode()) aplicar o tema.
  // Um timeout de segurança garante que a página nunca
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

  // Chamado depois que applySiteDarkMode() já aplicou o tema (ou pelo
  // timeout de segurança). Idempotente: pode ser chamado mais de uma vez
  // sem problema.
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
      settings: 'Configurações', close: 'Fechar',
      viewReleases: 'Ver novidades', reportIssue: 'Reportar um problema', aboutJetPhotosPlus: 'Sobre o JetPhotos+',
      analyzing: 'Analisando página...',
      likeMissing: 'Curtir faltantes',
      missing: 'faltando',
      allLikedToast: 'Todas as fotos da página já estão curtidas',
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
      settings: 'Settings', close: 'Close', viewReleases: "See what's new", reportIssue: 'Report an issue', aboutJetPhotosPlus: 'About JetPhotos+', analyzing: 'Analyzing page...',
      likeMissing: 'Like missing photos',
      missing: 'missing',
      allLikedToast: 'All photos on this page are already liked',
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

      /* Queue estimator: DOM próprio da extensão, com as cores dark-mode
         aqui mesmo (o tema manual do site não toca em nada com id jp-*). */
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

      /* Tabelas nativas do site marcadas via JS (Period Totals, fila):
         preserva o zebra striping com tons escuros. A segunda fileira fica
         levemente elevada; a primeira integra ao fundo da página. */
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > tr:nth-child(even),
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > tr:nth-child(even) td {
        background: #2d2e31 !important;
        background-color: #2d2e31 !important;
        color: #e8eaed !important;
        border-color: #3c4043 !important;
      }

      html.jp-site-dark-active .jp-plus-dark-native-table tbody > tr:nth-child(odd),
      html.jp-site-dark-active .jp-plus-dark-native-table tbody > tr:nth-child(odd) td {
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

      /* Bolha de curtidas: o único UI de likes — aparece somente em páginas
         que realmente possuem links/ícones de Like. Não é launcher.
         Sempre visível; compacta — coração + faltantes. */
      #jp-like-widget-bubble {
        position:fixed; right:18px; bottom:18px; z-index:999999;
        display:flex; align-items:center; gap:9px;
        min-height:54px; padding:12px 18px 12px 16px; box-sizing:border-box;
        background:#1c1c1c; color:#eeeeee;
        border:1px solid #464646; border-radius:999px;
        box-shadow:0 5px 20px rgba(0,0,0,.30);
        font-family:'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size:15px; font-weight:700; line-height:1;
        cursor:pointer;
        animation:jpBubbleIn .18s ease;
      }
      #jp-like-widget-bubble:hover { background:#2a2a2a; border-color:#686868; }
      #jp-like-widget-bubble:focus-visible { outline:2px solid #669DF6; outline-offset:2px; }
      /* Concluído: a bolha encolhe pra um disco só com o selo — o contador
         some junto (sem "0" pendurado do lado). Padding igual dos 4 lados
         centraliza o selo; vale em qualquer breakpoint (seletor mais
         específico que os paddings dos @media). */
      #jp-like-widget-bubble.jp-bubble-done { padding:12px; gap:0; min-height:0; }
      #jp-like-widget-bubble.jp-bubble-done #jp-like-widget-bubble-count { display:none; }
      /* Durante a leva, a bolha só troca a borda pra verde (estado estático,
         sem pulsar — o progresso aparece no anel e na contagem regressiva). */
      #jp-like-widget-bubble.jp-bubble-liking { border-color:#4caf50; }
      /* Anel de progresso em volta do coração: o track fica sempre visível
         (contorno sutil) e o fill verde fecha conforme a leva avança (ver
         setBubbleProgress). Começa no topo por causa do rotate(-90deg). */
      /* O coração é centralizado por flex (à prova de conta de margem) e o
         anel preenche o wrap em absoluto — assim os dois ficam concêntricos
         de verdade, sem depender de margin:auto + inset. */
      #jp-like-widget-bubble .jp-bubble-ring-wrap { position:relative; width:30px; height:30px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; }
      #jp-like-widget-bubble .jp-bubble-ring { position:absolute; inset:0; width:100%; height:100%; transform:rotate(-90deg); }
      #jp-like-widget-bubble .jp-bubble-ring-track { fill:none; stroke:rgba(255,255,255,.16); stroke-width:2.5; }
      #jp-like-widget-bubble .jp-bubble-ring-fill { fill:none; stroke:#4caf50; stroke-width:2.5; stroke-linecap:round; stroke-dasharray:75.4; stroke-dashoffset:75.4; transition:stroke-dashoffset .15s linear, opacity .15s linear; }
      #jp-like-widget-bubble .jp-bubble-heart { position:relative; width:18px; height:18px; }
      /* Selo de concluído: quando tudo está curtido, o anel + coração dão
         lugar a um disco verde com confere branco (troca seca, sem pop). */
      #jp-like-widget-bubble .jp-bubble-check { display:none; position:absolute; inset:0; width:100%; height:100%; }
      #jp-like-widget-bubble.jp-bubble-done .jp-bubble-ring,
      #jp-like-widget-bubble.jp-bubble-done .jp-bubble-heart { display:none; }
      #jp-like-widget-bubble.jp-bubble-done .jp-bubble-check { display:block; }
      /* Rótulo só no desktop largo (ex: "10 faltando"): deixa a bolha mais
         larga e autoexplicativa onde há espaço; some no mobile. */
      #jp-like-widget-bubble .jp-bubble-label { display:none; font-weight:600; opacity:.75; }
      /* A bolha cresce com a tela: compacta no celular, com presença no PC.
         O anel é viewBox e escala sozinho junto com o wrap. */
      @media (min-width:700px) {
        #jp-like-widget-bubble { min-height:58px; padding:13px 20px 13px 17px; font-size:16px; }
        #jp-like-widget-bubble .jp-bubble-ring-wrap { width:32px; height:32px; }
        #jp-like-widget-bubble .jp-bubble-heart { width:19px; height:19px; }
      }
      @media (min-width:1100px) {
        #jp-like-widget-bubble { min-height:62px; padding:14px 22px 14px 18px; font-size:16px; gap:10px; }
        #jp-like-widget-bubble .jp-bubble-ring-wrap { width:34px; height:34px; }
        #jp-like-widget-bubble .jp-bubble-heart { width:20px; height:20px; }
        #jp-like-widget-bubble .jp-bubble-label { display:inline; }
      }
      @media (prefers-reduced-motion: reduce) {
        #jp-like-widget-bubble { animation:none; }
        #jp-like-widget-bubble .jp-bubble-ring-fill { transition:none; }
        #jp-like-toast { transition:none; }
      }
      @keyframes jpBubbleIn { from {opacity:0} to {opacity:1} }
      /* Toast de aviso da bolha com a cara do site: cartão claro como os
         cards de resultado, texto escuro e filete azul como os botões. A fonte
         é declarada explícita (pilha sans do sistema, igual à do site) em vez
         de herdada — herança falha se o site escopar a fonte em wrappers. */
      #jp-like-toast {
        position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:1000000;
        max-width:min(420px, calc(100vw - 32px)); box-sizing:border-box;
        background:#ffffff; color:#212121;
        border:1px solid #d8d8d8; border-left:4px solid #1f8dd6; border-radius:8px;
        padding:11px 16px;
        font-family:'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size:14px; font-weight:600; line-height:1.35; text-align:center;
        box-shadow:0 5px 20px rgba(0,0,0,.22); pointer-events:none;
        opacity:0; transition:opacity .18s ease;
      }
      #jp-like-toast.jp-toast-show { opacity:1; }

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
        #jp-like-widget-bubble { right:10px; bottom:10px; }
      }

      @media (prefers-reduced-motion: reduce) {
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
         filtro de dark mode automático — por isso o tema manual do site
         nunca toca nesses ícones (ver a lista "nunca tocados" no tema).
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
        [STORAGE_KEY_SITE_DARK_MODE, STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED, STORAGE_KEY_LANGUAGE],
        result => {
          resolve({
            siteDarkMode: result[STORAGE_KEY_SITE_DARK_MODE] === true, // padrão: false
            queueEstimatorEnabled: result[STORAGE_KEY_QUEUE_ESTIMATOR_ENABLED] !== false, // padrão: true (EXPERIMENTAL)
            language: result[STORAGE_KEY_LANGUAGE] || getBrowserLanguage()
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
  // -----------------------------------------------------------------------
  // Modo escuro do SITE (não só do painel). TEMA MANUAL: folha de estilo
  // escrita à mão para os seletores reais do JetPhotos (paleta + classes
  // BEM extraídas do site via snippet de console).
  //
  // Por que manual, depois de duas tentativas automáticas:
  //   - "smart invert" (filter global + reinversão): quebrava o matiz de
  //     cores saturadas e errava fotos de lazy-load.
  //   - recoloração por elemento (getComputedStyle + !important inline +
  //     observer): piscava em conteúdo dinâmico, errava gradientes, bordas,
  //     sombras e iframes, e custava CPU revisitando o DOM inteiro.
  // O tema manual não tem JS de varredura: é só uma classe no <html>
  // (jp-site-dark-active) + CSS com !important. Fotos, vídeos, canvas, SVG,
  // iframes, o header (já escuro) e cores de marca (azul picton, botões de
  // share) nunca são tocados — as regras miram só página, cards, textos,
  // links, formulários e controles.
  // -----------------------------------------------------------------------
  const SITE_DARK_HTML_CLASS = 'jp-site-dark-active';
  const SITE_DARK_STYLE_ID = 'jp-site-dark-theme';

  const SITE_DARK_THEME_CSS = `
    html.jp-site-dark-active { color-scheme:dark; }
    /* Página: fundo + texto base (o #202124 casa com o preload anti-flash). */
    html.jp-site-dark-active body,
    html.jp-site-dark-active .page,
    html.jp-site-dark-active div[class*="page--"],
    html.jp-site-dark-active .main,
    html.jp-site-dark-active .main__section { background-color:#202124 !important; color:#e8e8e8 !important; }
    /* Cards brancos (resultados, painéis). */
    html.jp-site-dark-active .box,
    html.jp-site-dark-active div[class*="box--"] { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    /* Títulos. */
    html.jp-site-dark-active h1,
    html.jp-site-dark-active h2,
    html.jp-site-dark-active h3,
    html.jp-site-dark-active h4,
    html.jp-site-dark-active h5,
    html.jp-site-dark-active h6,
    html.jp-site-dark-active .head { color:#f2f2f2 !important; }
    /* Links: azul clareado pra leitura no escuro (o azul puro #2c94e8 e o
       azul-link padrão #0000ee somem no fundo escuro). Botões, logo e moldura
       de foto ficam de fora — têm estilo próprio. */
    html.jp-site-dark-active a:not(.btn):not(.header__logo):not(.gallery-photo__frame) { color:#6fb1f0 !important; }
    /* Guarda: o tema nunca toca nos links do submenu da extensão. */
    html.jp-site-dark-active #jp-plus-submenu a { color:inherit !important; }
    /* Links sobre fundos que já eram escuros (header, popups, dropdowns):
       herdam o branco do contexto em vez de forçar o azul. */
    html.jp-site-dark-active .header a:not(.btn):not(.header__logo):not(.gallery-photo__frame),
    html.jp-site-dark-active .gallery-photo__popup a:not(.btn):not(.header__logo):not(.gallery-photo__frame),
    html.jp-site-dark-active #quicksearch-dropdown a:not(.btn):not(.header__logo):not(.gallery-photo__frame),
    html.jp-site-dark-active #overlay a:not(.btn):not(.header__logo):not(.gallery-photo__frame),
    html.jp-site-dark-active .loader__mobile a:not(.btn):not(.header__logo):not(.gallery-photo__frame) { color:inherit !important; }
    /* Submenu desktop (era #fefefe). */
    html.jp-site-dark-active ul.nav-desktop__list--submenu { background-color:#2b2d31 !important; border-color:#3a3d43 !important; }
    /* Textos da galeria + rótulos de formulário. */
    html.jp-site-dark-active .gallery-photo__info,
    html.jp-site-dark-active .gallery-photo__text { color:#e8e8e8 !important; }
    html.jp-site-dark-active label.form__label { color:#b0b0b0 !important; }
    /* Campos: wrappers brancos + os inputs. */
    html.jp-site-dark-active .input-wrapper,
    html.jp-site-dark-active #header__searchBoxInputWrapper { background-color:#2b2d31 !important; border-color:#4b4e55 !important; }
    html.jp-site-dark-active input[type="text"],
    html.jp-site-dark-active input[type="search"],
    html.jp-site-dark-active input[type="email"],
    html.jp-site-dark-active input[type="password"],
    html.jp-site-dark-active input[type="url"],
    html.jp-site-dark-active input[type="number"],
    html.jp-site-dark-active input[type="tel"],
    html.jp-site-dark-active .input-wrapper__field,
    html.jp-site-dark-active .header__searchBoxInput,
    html.jp-site-dark-active textarea { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#4b4e55 !important; }
    html.jp-site-dark-active input::placeholder,
    html.jp-site-dark-active textarea::placeholder { color:#8e8e8e !important; opacity:1 !important; }
    /* Selects (busca avançada etc.) + as opções. */
    html.jp-site-dark-active select,
    html.jp-site-dark-active .select__control { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#4b4e55 !important; }
    html.jp-site-dark-active option,
    html.jp-site-dark-active optgroup { background-color:#2b2d31 !important; color:#e8e8e8 !important; }
    /* Botões genéricos claros viram escuros; o azul picton e o transparente
       ficam intactos (já funcionam no escuro). */
    html.jp-site-dark-active .btn:not(.btn--picton-blue):not(.btn--transparent) { background-color:#3a3d43 !important; color:#e8e8e8 !important; border-color:#4b4e55 !important; }
    /* Shares mantêm a cor de marca; só garante o texto branco. */
    html.jp-site-dark-active .resp-sharing-button a { color:#ffffff !important; }
    /* Setas do carrossel: gradiente claro -> escuro (mesma direção). */
    html.jp-site-dark-active .slick-prev { background-image:linear-gradient(90deg, #202124 0px, rgba(32,33,36,0)) !important; }
    html.jp-site-dark-active .slick-next { background-image:linear-gradient(90deg, rgba(32,33,36,0), #202124) !important; }
    /* Alertas: info azul + erro de login. */
    html.jp-site-dark-active #alert-email-verification { background-color:#16324a !important; color:#a8d4f5 !important; border-color:#1e659f !important; }
    html.jp-site-dark-active .alert__content { color:#a8d4f5 !important; }
    html.jp-site-dark-active #login-form__failed-login { background-color:#3d2223 !important; color:#f2b8b5 !important; }
    /* Modal de login. */
    html.jp-site-dark-active .modal { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    /* Rodapé. */
    html.jp-site-dark-active footer { background-color:#17181c !important; color:#cfcfcf !important; }
    html.jp-site-dark-active .footer__seperator { background-color:#3a3d43 !important; }
    /* Aba ativa do seletor + painéis de busca avançada. */
    html.jp-site-dark-active .bigbox-selector__tab--active { background-color:#2b2d31 !important; color:#e8e8e8 !important; }
    html.jp-site-dark-active .form--searchAdvanced,
    html.jp-site-dark-active .form--searchAdvancedMulti { background-color:#26272b !important; color:#e8e8e8 !important; }
    /* Tabelas genéricas: só a borda (fundo transparente mostra a página). */
    html.jp-site-dark-active table,
    html.jp-site-dark-active th,
    html.jp-site-dark-active td { border-color:#3a3d43 !important; }
    html.jp-site-dark-active th { color:#f2f2f2 !important; }
    html.jp-site-dark-active hr { border-color:#3a3d43 !important; background-color:#3a3d43 !important; }
    /* Home: coluna lateral + cards do carrossel de perfis. */
    html.jp-site-dark-active .index-col { background-color:#26272b !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    html.jp-site-dark-active .slick-profile__layout { background-color:#2b2d31 !important; color:#e8e8e8 !important; }
    html.jp-site-dark-active .slick-profile__layout span { color:#e8e8e8 !important; }
    /* Perfil: nome sobre a foto de capa fica branco (o "a" no seletor
       empata a especificidade com a regra genérica de links e vence por vir
       depois — sem ele, o nome continuaria azul). */
    html.jp-site-dark-active a.hero__profile-name-link { color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; }
    /* Área de membros: painel das abas + botões das abas (mesmo motivo do
       "a" acima nas cores; fundo/borda não competem com regra genérica). */
    html.jp-site-dark-active .tabnav__content { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    html.jp-site-dark-active .tabnav__btn { background-color:#2b2d31 !important; border-color:#3a3d43 !important; }
    html.jp-site-dark-active a.tabnav__btn { color:#e8e8e8 !important; }
    html.jp-site-dark-active .tabnav__btn--active { background-color:#3a3d43 !important; }
    html.jp-site-dark-active a.tabnav__btn--active { color:#ffffff !important; }
    /* Upload: dropdowns Chosen + pílulas de checkbox/radio. A pílula ativa
       ganha borda azul pra não perder a distinção (o tema uniformiza bg). */
    html.jp-site-dark-active .chosen-drop { background-color:#2b2d31 !important; border-color:#4b4e55 !important; }
    html.jp-site-dark-active .chosen-results li { color:#e8e8e8 !important; }
    html.jp-site-dark-active .chosen-results li.highlighted { background-color:#1e659f !important; color:#ffffff !important; }
    html.jp-site-dark-active .checkbox,
    html.jp-site-dark-active .radio__pill { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#4b4e55 !important; }
    html.jp-site-dark-active .radio__pill--active { border-color:#2c94e8 !important; }
    html.jp-site-dark-active .checkbox span,
    html.jp-site-dark-active .checkbox label,
    html.jp-site-dark-active .radio__pill span,
    html.jp-site-dark-active .radio__pill label { color:#e8e8e8 !important; }
    /* Paginação (álbum, /new, resultados...): caixas brancas viram escuras;
       o número segue azul (regra genérica), legível no escuro. */
    html.jp-site-dark-active a.paging__pager { background-color:#2b2d31 !important; border-color:#3a3d43 !important; color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; }
    /* Barra de filtros dos resultados (contagem, Modify search, Sort by). */
    html.jp-site-dark-active .show-photos-header { background-color:#26272b !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    html.jp-site-dark-active .show-photos-header span { color:#e8e8e8 !important; }
    /* Cards de badges + nomes (as imagens dos badges ficam intactas). */
    html.jp-site-dark-active .badge-overview__frame { background-color:#2b2d31 !important; color:#e8e8e8 !important; border-color:#3a3d43 !important; }
    html.jp-site-dark-active .badge-overview__frame span { color:#e8e8e8 !important; }
    /* Títulos avulsos com cor escura explícita (ex: upload guidelines). */
    html.jp-site-dark-active .title { color:#f2f2f2 !important; }
    /* Album/Like/Share (resultados + foto): cinza neutro nos rótulos e
       ícones; branco no hover e no Like curtido (o texto desses dois
       estados já é branco nas regras acima — aqui vão o cinza padrão e os
       filtros dos ícones). brightness(0) zera a cor original do arquivo e
       invert(0.62) chega no tom do joinha não-curtido; opacidade 1 pra o
       tom não variar. Modo claro: intocado (escopo dark). */
    html.jp-site-dark-active a.social__link,
    html.jp-site-dark-active a.social__link .social__text { color:#9aa0a6 !important; -webkit-text-fill-color:#9aa0a6 !important; }
    html.jp-site-dark-active a.social__link img { filter:brightness(0) invert(0.62) !important; opacity:1 !important; }
    html.jp-site-dark-active a.social__link:hover img,
    html.jp-site-dark-active a.social__link.social__link--like.social__link--active img { filter:invert(1) !important; opacity:1 !important; }
    /* Ícones de câmera do perfil (trocar avatar/capa): brancos no escuro.
       Vale só nas páginas de fotógrafo (jp-on-profile). Cobre fonte de
       ícone, SVG e imagem (brightness zera a cor, invert vira branco). */
    html.jp-site-dark-active.jp-on-profile i[class*=camera i],
    html.jp-site-dark-active.jp-on-profile svg[class*=camera i],
    html.jp-site-dark-active.jp-on-profile span[class*=camera i] { color:#ffffff !important; fill:#ffffff !important; }
    html.jp-site-dark-active.jp-on-profile img[src*=camera i] { filter:brightness(0) invert(1) !important; }
    /* Menu lateral mobile (hambúrguer): fundo escuro + links claros. */
    html.jp-site-dark-active .header__extended-section--navigation { background-color:#26272b !important; }
    html.jp-site-dark-active .header__extended-section--navigation span { color:#e8e8e8 !important; }
    html.jp-site-dark-active a.nav__link { color:#2c94e8 !important; -webkit-text-fill-color:#2c94e8 !important; }
  `;

  function ensureSiteDarkThemeStyle() {
    if (document.getElementById(SITE_DARK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SITE_DARK_STYLE_ID;
    style.textContent = SITE_DARK_THEME_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // Tabelas nativas do site (fila, photostats, Period Totals...): marca
  // pra herdar o zebra escuro. Sem isso, fileiras brancas do zebra original
  // ficam com texto claro (ilegível). Roda no init e no toggle.
  function tagNativeTablesForDark() {
    document.querySelectorAll('table:not(.jp-plus-queue-table)').forEach(table => {
      table.classList.add('jp-plus-dark-native-table');
    });
  }

  function applySiteDarkMode(isOn) {
    if (isOn) {
      ensureSiteDarkThemeStyle();
      tagNativeTablesForDark();
    }
    document.documentElement.classList.toggle(SITE_DARK_HTML_CLASS, isOn);
    document.documentElement.classList.toggle('jp-on-profile', location.pathname.startsWith('/photographer'));
  }
  // =======================================================================
  // Painel principal
  // ---------------------------------------------------------------------
  let panelEl = null;
  let settingsMenuEl = null;
  let settingsPanelEl = null;
  let currentSettings = { siteDarkMode: false, queueEstimatorEnabled: true, language: 'pt-BR' };

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

    // A ferramenta de curtidas é a bolha no canto inferior direito — o único
    // UI de likes, em qualquer tela. Ela só existe nas páginas que realmente
    // contêm fotos com ação de Like.
    if (isPhotoContext && !isQueueMode) {
      // Criada aqui pra já existir antes do primeiro refresh() tentar
      // atualizar o contador.
      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.id = 'jp-like-widget-bubble';
      bubble.title = t('likeMissing');
      bubble.setAttribute('aria-label', t('analyzing'));
      bubble.innerHTML = `
        <span class="jp-bubble-ring-wrap" aria-hidden="true">
          <svg class="jp-bubble-ring" viewBox="0 0 28 28"><circle class="jp-bubble-ring-track" cx="14" cy="14" r="12"></circle><circle class="jp-bubble-ring-fill" id="jp-bubble-ring-fill" cx="14" cy="14" r="12"></circle></svg>
          <svg class="jp-bubble-heart" viewBox="0 0 24 24"><path d="M20.8 8.9c0 5.2-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.9A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          <svg class="jp-bubble-check" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="#22c55e"></circle><path d="M8.5 14.5l4 4L19.5 10" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span id="jp-like-widget-bubble-count">\u2026</span>
        <span id="jp-like-widget-bubble-label" class="jp-bubble-label"></span>`;
      bubble.addEventListener('click', () => {
        // O toque curte tudo direto. Com leva em andamento, ignora; com a
        // bolha verde (tudo curtido), avisa num toast em vez de calar.
        if (isLiking) return;
        if ((lastBubbleMissing ?? 0) <= 0) {
          if (lastBubbleMissing !== null) showLikeToast(t('allLikedToast'));
          return;
        }
        runLikeAllBatch();
      });
      document.body.appendChild(bubble);
    }

    settingsMenuEl = null;
    return true;
  }

  // Última contagem vista pela bolha (null = ainda analisando). É o que o
  // toque na bolha consulta pra decidir se há o que curtir.
  let lastBubbleMissing = null;

  // Atualiza o contador da bolha. null = ainda analisando (mostra …).
  // Anel de progresso da bolha: 0 = vazio, 1 = fechado verde.
  const BUBBLE_RING_C = 75.4; // 2π×12, mesmo r do círculo no SVG (ver CSS)
  function setBubbleProgress(frac) {
    const fill = document.getElementById('jp-bubble-ring-fill');
    if (!fill) return;
    const clamped = Math.max(0, Math.min(1, frac || 0));
    // Esconde o arco zerado: com ponta redonda, um arco de comprimento 0
    // ainda renderiza como um pontinho verde no topo do anel.
    fill.style.opacity = clamped <= 0 ? '0' : '1';
    fill.style.strokeDashoffset = String(BUBBLE_RING_C * (1 - clamped));
  }

  // Toast de aviso da bolha (ex: tudo já curtido). Um de cada vez: se já
  // houver um visível, só troca o texto e reinicia o temporizador.
  let likeToastTimer = null;
  function showLikeToast(message) {
    let toast = document.getElementById('jp-like-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'jp-like-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    // Recomeça a transição mesmo quando o toast já estava visível.
    toast.classList.remove('jp-toast-show');
    void toast.offsetWidth;
    toast.classList.add('jp-toast-show');
    clearTimeout(likeToastTimer);
    likeToastTimer = setTimeout(() => toast.classList.remove('jp-toast-show'), 2500);
  }

  function updateBubble(missingOrNull) {
    const bubble = document.getElementById('jp-like-widget-bubble');
    const count = document.getElementById('jp-like-widget-bubble-count');
    const label = document.getElementById('jp-like-widget-bubble-label');
    if (!bubble || !count) return;
    if (missingOrNull == null) {
      lastBubbleMissing = null;
      setBubbleProgress(0);
      count.textContent = '\u2026';
      bubble.classList.remove('jp-bubble-done');
      bubble.setAttribute('aria-label', t('analyzing'));
      if (label) { label.textContent = ''; label.style.display = 'none'; }
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
    bubble.title = done
      ? (currentSettings.language === 'en' ? 'All liked!' : 'Tudo curtido!')
      : t('likeMissing');
    // Rótulo do desktop largo ("10 faltando"); some quando concluído (o selo basta).
    if (label) {
      label.textContent = done ? '' : t('missing');
      label.style.display = done ? 'none' : '';
    }
  }

  // Placar das curtidas: a bolha é o único mostrador, então é só alimentá-la.
  function updateStatus(cards, missing) {
    // Durante a leva, o clickNext já atualiza a bolha a cada clique — não
    // deixe esses refreshes brigarem com a contagem regressiva.
    if (isLiking) return;
    updateBubble(cards.length ? missing : null);
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
      // Um .click() que lance (handler do próprio site) não pode quebrar a
      // corrente da leva — essa foto fica pra próxima e o resto continua.
      try {
        targets[i].click();
      } catch (clickError) {
        console.error('[JetPhotos+] Clique ignorado (handler do site lançou):', clickError);
      }
      i++;
      updateBubble(targets.length - i);
      setBubbleProgress(i / targets.length);
      const delay = LIKE_CLICK_DELAY_MS + Math.random() * LIKE_CLICK_JITTER_MS;
      setTimeout(clickNext, delay);
    }
    clickNext();

    return targets.length;
  }

  // Dispara a leva de "curtir faltantes" a partir da bolha. Todo o feedback
  // é na própria bolha (contagem regressiva + anel + borda verde + selo).
  function runLikeAllBatch() {
    if (isLiking) return;
    let total = 0;
    try {
      total = likeAllMissing(doneCount => {
        // onDone: a leva terminou (doneCount=0 se não havia nada faltando).
        updateBubble(0); // bolha vira só o selo verde (o refresh final confirma)
        document.getElementById('jp-like-widget-bubble')?.classList.remove('jp-bubble-liking');
      });
    } catch (error) {
      console.error('[JetPhotos+] Falha ao iniciar a leva de curtidas:', error);
      document.getElementById('jp-like-widget-bubble')?.classList.remove('jp-bubble-liking');
      return;
    }
    document.getElementById('jp-like-widget-bubble')?.classList.toggle('jp-bubble-liking', total > 0);
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
    return node.matches('#jp-site-queue-tracker, #jp-like-widget-bubble, #jp-plus-launcher-host, .jp-queue-eta-badge') ||
      !!node.closest('#jp-site-queue-tracker, #jp-like-widget-bubble, #jp-plus-launcher-host, .jp-queue-eta-badge');
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
    // O tema (classe no <html> + CSS) já está valendo aqui — seguro revelar
    // a página agora, sem flash do tema claro original. Se o modo escuro
    // estiver desligado, isso é um no-op (a classe de preload nunca foi
    // adicionada).
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

    // A bolha só passa a ser funcional quando encontra fotos com ação de
    // Like. Em páginas sem fotos ela nem é criada (ver buildPanel); o toque
    // nela chama runLikeAllBatch() direto.
    if (isPhotoContext) {
      wireLikeSync();
      scheduleRefresh();
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

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
