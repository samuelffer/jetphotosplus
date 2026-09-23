/*
 * JetPhotos+ · Ponte de rede
 * -----------------------------------
 * Este arquivo roda no MUNDO DA PÁGINA (injetado via <script src> pelo
 * content.js), não no mundo isolado. É necessário porque um content script
 * comum não consegue "ver" o fetch/XHR que o próprio JetPhotos dispara
 * (cada contexto tem seu window.fetch/XHR independente) — só rodando junto
 * com o código real da página dá pra saber se uma requisição de like/unlike
 * realmente teve sucesso no servidor.
 *
 * Endpoint real (confirmado via DevTools):
 *   PostHandler.php?addFavorite=<ID>&doAjax=true    -> curtir
 *   PostHandler.php?removeFavorite=<ID>&doAjax=true -> descurtir
 * <ID> é o mesmo número usado no HTML em data-photo/data-id, então o
 * content.js consegue casar a resposta com o elemento certo sem adivinhar.
 * O PostHandler responde com o texto literal "true" ou "false" — por isso
 * a confirmação de sucesso lê o corpo da resposta, não só o status HTTP
 * (um 200 sozinho não garante que veio "true"; isso ataca a causa raiz do
 * bug: o ícone não muda porque o site às vezes falha em *processar
 * visualmente* uma resposta que na prática foi "true").
 *
 * O script só ESPIA: nunca cancela, atrasa ou modifica nenhuma requisição.
 * Ele avisa o content.js (mundo isolado) via CustomEvent na window, que é a
 * única ponte permitida entre os dois mundos.
 */
(function () {
  'use strict';

  const EVENT_NAME = 'jpplus-like-net-result';

  // Só reconhece exatamente os parâmetros reais do endpoint. Isso evita de
  // vez qualquer falso positivo com outras requisições que porventura
  // contenham a palavra "like" na URL sem ser uma ação de curtir/descurtir.
  function parseLikeAction(url) {
    const str = String(url || '');
    let match = str.match(/[?&]addFavorite=(\d+)/i);
    if (match) return { id: match[1], action: 'add' };
    match = str.match(/[?&]removeFavorite=(\d+)/i);
    if (match) return { id: match[1], action: 'remove' };
    return null;
  }

  // O PostHandler responde com o texto "true"/"false". Mantém um fallback
  // pro status HTTP (e pra formatos tipo JSON {"success":true}) caso o
  // JetPhotos mude o formato da resposta no futuro, pra sincronia não
  // quebrar de vez por causa disso.
  function parseSuccess(bodyText, httpOk) {
    if (typeof bodyText === 'string' && bodyText.trim()) {
      const trimmed = bodyText.trim().toLowerCase();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      try {
        const json = JSON.parse(trimmed);
        if (typeof json === 'boolean') return json;
        if (json && typeof json.success === 'boolean') return json.success;
        if (json && typeof json.ok === 'boolean') return json.ok;
      } catch (_) { /* não é JSON, segue pro fallback abaixo */ }
    }
    return httpOk;
  }

  function notify(url, ok, method) {
    try {
      const parsed = parseLikeAction(url);
      if (!parsed) return; // não é addFavorite/removeFavorite: ignora por completo
      window.dispatchEvent(new CustomEvent(EVENT_NAME, {
        detail: { url: String(url || ''), ok: !!ok, method: String(method || ''), id: parsed.id, action: parsed.action }
      }));
    } catch (_) { /* nunca deixa a ponte quebrar a página */ }
  }

  // --- fetch() ---------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const result = origFetch.apply(this, arguments);
      if (parseLikeAction(url)) {
        result.then(
          res => {
            const httpOk = !!(res && res.ok);
            // clone() é obrigatório: o body só pode ser lido uma vez, e a
            // página ainda precisa consumir a resposta original normalmente.
            res.clone().text()
              .then(text => notify(url, parseSuccess(text, httpOk), method))
              .catch(() => notify(url, httpOk, method));
          },
          () => notify(url, false, method)
        );
      }
      return result;
    };
  }

  // --- XMLHttpRequest ----------------------------------------------------
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__jpUrl = url;
    this.__jpMethod = method;
    return OrigOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (parseLikeAction(this.__jpUrl)) {
      this.addEventListener('loadend', () => {
        const httpOk = this.status >= 200 && this.status < 300;
        let bodyText = '';
        try { bodyText = this.responseText; } catch (_) { /* responseType incompatível com .responseText: ignora, cai no fallback do status */ }
        notify(this.__jpUrl, parseSuccess(bodyText, httpOk), this.__jpMethod);
      });
    }
    return OrigSend.apply(this, arguments);
  };
})();
