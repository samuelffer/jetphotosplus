# Changelog — JetPhotos+

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) + [SemVer](https://semver.org/lang/pt-BR/).

> **Versão atual: 2.0.1.**

---

## [2.0.1]

### Botão de Like no layout mobile
- Aumentado o ícone do botão de Like injetado no layout mobile de 16px para 20px (caixa de toque de 28px para 30px, sem alterar a altura da fileira de estatísticas).
- Alinhado o botão verticalmente com os demais ícones da fileira (remoção da folga de baseline do `<img>` + `vertical-align: middle` no stat), com ajuste fino de 2px pra cima.

### Curtidas no mobile: instantâneas + animação pop
- O joinha agora acende na hora do toque (UI otimista), sem esperar a resposta do servidor; se o servidor recusar ou a rede falhar, o estado é desfeito sozinho via evento `!ok` do hook de rede.
- Nova microanimação de "pop" (escala 1 → 1.35 → 0.95 → 1, 0.2s) ao curtir no mobile; respeita `prefers-reduced-motion`.
- Cada confirmação de rede agora atualiza só a própria foto (busca mirada por `data-photo`/`data-id`) em vez de revarrer a página inteira; durante o "curtir faltantes" o `refresh()` completo roda uma vez só no final — elimina as dezenas de reflows seguidos que travavam o celular.
- Janela anti-duplo-toque reduzida de 500ms para 300ms e removido o dim do botão durante o clique (brigava com o feedback instantâneo).

### Widget de curtidas: minimizar pra bolha
- Novo botão `−` no canto do widget que recolhe ele pra uma bolha compacta (coração + faltantes, `✓` verde quando termina); um clique na bolha expande de volta.
- Estado aberto/recolhido salvo em `chrome.storage.local`, continua igual ao trocar de página.
- A bolha acompanha a contagem ao vivo, inclusive durante o "curtir faltantes".

### Bolha vira o widget principal no celular
- Em telas de até 520px o widget já abre recolhido na bolha (coração + faltantes); girar/redimensionar alterna sozinho, sem mexer na preferência salva do desktop.
- Tocar na bolha no celular curte todas as faltantes direto (via o botão escondido, com a mesma contagem ao vivo); tocar sem nada faltando, durante a leva ou no desktop continua expandindo.
- Durante a leva a bolha pulsa verde; ao terminar o anel fecha completo (ver abaixo).

### Bolha: anel de progresso no lugar do ✓
- O `✓` de conclusão foi substituído por um anel de progresso em volta do coração: o contorno sutil fica sempre visível, o arco verde preenche durante a leva e fecha completo quando tudo está curtido (o número passa a mostrar `0`).
- Pop de conclusão na bolha ao terminar uma leva que curtiu algo (respeita `prefers-reduced-motion`).
- No celular o toque na bolha não expande mais — só curte tudo quando há faltantes; no desktop o toque continua expandindo como antes.

### Bolha: selo de concluído + centralização do anel
- Corrigida a centralização do coração dentro do anel (agora por flex, à prova de desalinhamento) e removida a regra genérica de `svg` que podia interferir nos tamanhos.
- Quando tudo está curtido, o anel + coração dão lugar a um selo verde com confere branco (entra com um pop); o número continua mostrando `0` em verde.

### Bolha: padrão em todo lugar + tamanho responsivo
- A bolha agora é o UI padrão também no PC (o widget grande continua acessível tocando na bolha no desktop); preferência salva continua valendo.
- Corrigido pontinho verde no topo do anel com progresso zerado (arco de comprimento 0 com ponta redonda ainda renderizava) — o arco some de verdade no zero.
- Tamanho responsivo: maior no celular (54px, fonte 15px), cresce no tablet (58px) e no desktop (62px + rótulo "faltando", ex: "10 faltando").

### Bolha: UI único de curtidas (widget grande removido)
- O widget grande e todo o sistema de expandir/minimizar foram removidos — a bolha é agora o único UI de curtidas em qualquer tela, sem exceção.
- Tocar na bolha curte todas as fotos faltantes de uma vez (quando há algo faltando); sem nada faltando, o toque não faz nada.
- Removida a preferência salva de recolhido/expandido e o maquinário de colapso (menos código, sem mudança no visual da bolha).

### Bolha: visual sóbrio + selo sozinho + toast de aviso
- Bolha mais discreta: sem pulsar durante a leva (só a borda fica verde), sem pop de conclusão e entrada só com fade — o progresso continua no anel e na contagem regressiva.
- Tudo curtido = só o selo verde, sem o número 0 do lado: a bolha encolhe pra um disco com o confere.
- Clicar na bolha verde mostra um toast ("Todas as fotos da página já estão curtidas"), no PC e no celular; some sozinho e nunca bloqueia toques.

### Toast com a cara do site
- O toast agora é um cartão claro como os cards de resultado (fundo branco, texto escuro, filete azul como os botões) em vez da pílula escura.
- Fonte declarada explícita com a mesma pilha sans do JetPhotos (antes herdada do body, o que podia cair em fonte errada); aplicada também na bolha.
- O toast fica de fora da recolorida do modo escuro do site, mantendo o visual.

### Modo escuro: tema manual caprichado
- O motor antigo (recoloração por elemento via getComputedStyle + observer) foi aposentado e trocado por um tema CSS escrito à mão para os seletores reais do JetPhotos — sem varredura de DOM, sem flash em conteúdo novo, sem custo de CPU e com toggle instantâneo.
- Cobertura inicial (extração da página inicial): página, cards, títulos, links, submenu, galeria, formulários, selects, botões genéricos, alertas, modal de login, rodapé, carrossel e tabelas; fotos, header, azul picton, shares de marca e nosso UI nunca são tocados.
- Bolha e toast agora usam Fira Sans (a fonte do site) quando disponível.
- Próximo passo: extrações da página de resultados e da página de foto pra completar a cobertura (linhas de resultado, paginação, comentários).

### Modo escuro: zebra da fila + links em fundo escuro
- queue.php: as tabelas nativas da fila agora herdam o zebra escuro (linhas alternadas legíveis, sem fileira branca com texto branco); vale no carregamento e no toggle.
- Links sobre fundos que já eram escuros (header, popups, dropdowns) herdam o branco do contexto em vez de forçar o azul.

### Modo escuro: cobertura da auditoria (home, perfil, membros, upload, stats)
- Home: coluna lateral (.index-col) e cards do carrossel de perfis (.slick-profile__layout) escurecidos; títulos e textos da sidebar voltam a ser legíveis.
- Perfil: nome sobre a foto de capa volta a ser branco.
- Área de membros: painel das abas (.tabnav__content) e botões das abas (.tabnav__btn, ativa em destaque) escurecidos.
- Upload: dropdowns Chosen (.chosen-drop, opções e destaque) e pílulas de checkbox/radio escurecidos; pílula ativa ganha borda azul pra manter a distinção.
- Zebra escuro generalizado: todas as tabelas nativas (fila, photostats, Period Totals...) herdam o striping escuro, não só a fila.

### Modo escuro: teste A/B com filtro total (CSS puro v2)
- Novo método "Filtro": inverte a página inteira com invert(1)+hue-rotate(180) e restaura mídia e chrome — cobertura total instantânea em qualquer página, sem varredura de DOM.
- Fotos pixel-idênticas por construção: o par invert(1) puro aplicado 2x volta à cor exata; o contra-filtro mira só img/video (nunca containers); header (já escuro, logo branco) e todo o UI da extensão voltam verbatim; mapa vira "noturno" de propósito.
- Chave nas configurações: Método do modo escuro = Manual (tema r14) ou Filtro (teste, padrão). Troca ao vivo, sem reinstalar; o perdedor será removido na próxima versão.

### Modo escuro: filtro v2 removido, manual volta a ser único
- Veredito do teste A/B: o filtro total foi aposentado e o tema manual (r14) volta a ser o método único — chave removida das configurações, todo o código do filtro deletado (~100 linhas a menos).
- Próximo passo: completar a cobertura manual com auditorias das páginas restantes (resultados, foto individual, fórum...).

### Modo escuro: paginação, filtros, badges, Like branco
- Paginação (.paging__pager) escurecida — vale pra álbum, /new, resultados e todas as listas.
- Barra de filtros dos resultados (.show-photos-header) escurecida.
- Cards de badges (.badge-overview__frame) + nomes escurecidos; imagens dos badges intactas.
- Títulos avulsos escuros (.title) clareados (ex: upload guidelines).
- Like 100% branco no escuro (texto + joinha, qualquer estado, resultados e foto): o ícone preto fixo vira branco via invert(1), com a opacidade de estado intacta; modo claro intocado.
- Nome do perfil sobre a capa: regra blindada com -webkit-text-fill-color (o site pinta links com ele).

### Modo escuro: paginação branca, câmeras do perfil, menu mobile
- Números da paginação (.paging__pager) agora brancos no escuro (antes seguiam azuis).
- Ícones de câmera do perfil (trocar avatar/capa) brancos no escuro — só nas páginas de fotógrafo, modo claro intocado.
- Menu lateral mobile (.header__extended-section--navigation) escurecido + links (.nav__link) brancos.

### Modo escuro: social cinza/branco + menu mobile azul
- Album/Like/Share (resultados + foto): rótulos e ícones em cinza neutro (#9aa0a6, tom do joinha não-curtido); branco no hover e no Like curtido.
- Links do menu lateral mobile (.nav__link) agora no azul padrão do JetPhotos (#2c94e8).

### Modo escuro: social mais claro + joinha da extensão branco
- Album/Like/Share: cinza clareado (#c3c9d2 nos rótulos, invert(0.78) nos ícones); continua branco no hover e no Like curtido.
- Filtros dos ícones agora valem pra img, svg e fonte de ícone (o layout mobile pode usar qualquer um dos três).
- Joinha injetado pela extensão nos cards mobile (.jp-mobile-like-btn) vira branco no escuro (opacidade .4/1 de estado mantida).

### Like curtido verde (TESTE) + ícone do mobile corrigido
- Correção: o seletor do ícone do Like agora pega qualquer formato (img, svg, fonte de ícone ou span com fundo) — o joinha da página de foto no mobile estava escapando e ficava preto.
- Like curtido = verde nos dois temas (rótulo + joinha, PC e mobile, resultados e foto): verde-claro (#3ddc84) no escuro, verde-escuro (#188038) no claro.
- Não-curtido segue o padrão de cada tema (claro: nativo do site; escuro: cinza claro, branco no hover).
- Joinha injetado pela extensão nos cards mobile acompanha: verde quando curtido (tom por tema).

### Like verde exato + barrinha do mobile (TESTE)
- Verde desbotado corrigido: o JS agora troca o joinha curtido pela máscara verde no tom exato do rótulo (#3ddc84 no escuro, #188038 no claro) — vale pro site (resultados + foto, PC + mobile) e pro botão injetado nos cards.
- Barrinha da foto no mobile: seletores expandidos (ícone como filho direto, aninhado no rótulo ou ::before; i/svg por cor exata) pra pegar o formato que escapava e ficava preto.
- Filtros verdes do CSS viraram fallback pra arquivos de ícone desconhecidos.

### Like verde unificado: ícone = tom exato do rótulo (TESTE)
- Troca de técnica (máscara + JS removidos): o verde do joinha curtido agora é feColorMatrix constante — todo pixel vira exatamente #3ddc84 (escuro) ou #188038 (claro), igual ao rótulo LIKE, em qualquer formato de ícone.
- Seletor verde aprofunda (.social__text *): cobre ícone aninhado em qualquer nível da barrinha da foto no mobile.
- Botão injetado nos cards mobile usa a mesma matriz (tom por tema).

### Like verde à prova de estrutura inicial (TESTE)
- Correção: na foto já curtida (mobile, dois temas), o ícone abria num verde escuro nativo e só igualava ao rótulo após descurtir/curtir — o ícone inicial escapa dos seletores (o site remonta a estrutura no toggle).
- Backstop em JS: pinta o ícone (img/svg/i) inline com a matriz do tema em force/revoke, no botão injetado, no refresh e na troca de tema — qualquer estrutura, mesmo tom do rótulo.
- Seletor verde cobre ::after também (antes só ::before).

### Like descurtido volta ao cinza (TESTE)
- Correção: no escuro, descurtir a foto deixava o joinha preto (o site remonta o ícone mais fundo e o cinza só ia até 1 nível) — cinza, branco-hover e verde agora valem em qualquer profundidade + ::before/::after do link e do rótulo.
- Branco do hover virou brightness(0) invert(1) (idempotente, mesmo branco de antes): aninhamento não duplica o efeito.

### Hover branco só com mouse (TESTE)
- Correção: no touch, o :hover gruda após o toque e o joinha descurtido ficava branco em vez de cinza — as regras de hover (ícones + rótulos) agora só valem com (hover:hover) e (pointer:fine). No PC nada muda.

---

## [2.0.0]

Versão de reorganização do acompanhamento da fila: o histórico que antes só era visível
dentro do `queue.php` passou a ter um painel próprio no ícone da extensão, com badge,
gráfico e portabilidade (exportar/importar).

### Popup do ícone — "Ritmo da fila" (novo)
- O ícone da extensão na barra do navegador passou a abrir um popup dedicado ao histórico da fila, sem precisar estar no JetPhotos nem abrir o `queue.php`.
- Três métricas no topo: **Hoje** (maior `Total Screened` observado no dia), **Média** (média dos últimos dias fechados) e **Fila** (total de fotos na fila do site, conforme a última coleta).
- Gráfico de barras em SVG com as fotos analisadas por dia, cobrindo os últimos até **60 dias**, com tooltip ao passar o mouse e destaque para o dia atual.
- Selo no cabeçalho com a quantidade de dias acompanhados e rodapé com o horário da **última coleta**.
- Botão **Abrir fila ↗** abre o `queue.php` em uma nova aba.
- Os dados continuam vindo do coletor em background (`background.js`), o mesmo introduzido na 1.8.6 — o popup apenas lê `jpQueueDailyStats` do `chrome.storage.local`.

### Badge no ícone
- O ícone da extensão passou a exibir a quantidade de dias acompanhados no histórico (limitado a `99`), na cor `#4299dc`.
- O título do ícone acompanha a contagem: `JetPhotos+ — N dias acompanhados` (com plural correto para 1 dia).

### Exportar e importar histórico
- **Exportar histórico** baixa um JSON (`jetphotos-plus-history-AAAA-MM-DD.json`) com o campo `history` completo, no formato `{ format: 'JetPhotos+', type: 'queue-history', version: 2 }`.
- **Importar histórico** mescla o arquivo ao histórico atual, dia a dia, preservando os dados já coletados.
- O `__meta` do coletor **não** volta no tempo: o estado importado só substitui o atual se for mais recente (`lastObservedAtMs`), evitando que um backup antigo regrida a coleta.
- A poda de 60 dias é reaplicada depois da importação, junto com a atualização do badge.

### Documentação
- Corrigida a divergência de versão: `manifest.json` já marcava **2.0.0**, enquanto `CHANGELOG.md` e `leia-me.txt` ainda diziam **1.9.4**. Os três agora apontam para a mesma versão.
- `leia-me.txt` atualizado com o passo a passo do popup e das opções de exportar/importar.

---

## [1.9.4]

### Idioma
- Ajustado o idioma inicial para seguir as preferências do navegador: Português usa Português (Brasil), English usa English e outros idiomas usam English como fallback. A escolha manual em Configurações continua tendo prioridade.

### Modo escuro
- Ajustada a cor dos textos secundários no modo escuro para `rgb(224 224 224)` (`#E0E0E0`).
- Ajustado o fundo das linhas de `Period Totals` e do estimador da fila para um cinza elevado, evitando que os rows permaneçam brancos ou se confundam com o fundo geral do site.
- Mantida a correção do pisca-pisca durante as atualizações em tempo real do estimador.

### Contraste do estimador
- Ajustada a cor dos rótulos do estimador no modo escuro para `rgb(224 224 224)`, incluindo Analisadas hoje, Média diária, Tempo estimado e Última coleta.

### Zebra do Period Totals
- Ajustada a alternância de fundo das duas fileiras para seguir o padrão visual do JetPhotos: a segunda fileira recebe o fundo elevado e a primeira permanece integrada ao fundo escuro.
- Aplicado o mesmo comportamento ao estimador da fila da extensão.

---

## [1.9.3]

> **Nota histórica:** os ajustes desta revisão permaneceram dentro da 1.9.3 para estabilização e testes.

### Correções (revisão pós-lançamento)
- Corrigido o dropdown **Configurações** que fechava sozinho ao mover o mouse da logo em direção ao menu, mesmo com o cursor ainda dentro da área do cabeçalho. A causa era um espaçamento vertical (`top: calc(100% + 2px)`) entre a logo e o dropdown/painel: esse intervalo de 2px criava uma "zona morta" onde o cursor deixava de estar sobre qualquer elemento com `:hover`, fazendo o menu sumir com `display: none` antes do mouse alcançar o item **Configurações**. O espaçamento foi removido (`top: 100%`, colado à logo, igual ao comportamento da versão estável anterior).
- Corrigido o clique em **Configurações** não abrir o painel. A função `buildSettingsMenu()` continha uma referência a uma variável (`row`) de um toggle antigo ("Sempre iniciar expandida") que havia sido removido do código nesta versão, mas uma linha (`inner.appendChild(row)`) que a usava ficou esquecida. Isso disparava um erro de JavaScript (`row is not defined`) assim que o painel era montado pela primeira vez, interrompendo a execução antes de o painel ser exibido — por isso o clique não tinha efeito nenhum. A linha órfã foi removida.

### Identidade visual
- Substituído o texto **JETPHOTOS+** do launcher do cabeçalho pelo símbolo **JP+** fornecido.
- Adicionado `icons/logo.png` em PNG com fundo transparente.
- A logo fica branca normalmente e muda suavemente para azul ao passar o mouse ou receber foco.
- Atualizados os ícones da extensão (`16`, `32`, `48` e `128`) para a nova identidade.
- Adicionado `web_accessible_resources` para carregar a logo no cabeçalho do JetPhotos.

### Cabeçalho e Configurações
- Mantida a logo mais afastada da área da conta para evitar que fique colada ao nome/e-mail.
- O dropdown **Configurações** agora aparece logo abaixo da área da logo, com espaçamento vertical reduzido para manter o menu próximo ao cabeçalho.
- O dropdown foi centralizado em relação à logo, com um pequeno deslocamento para a direita.
- Removidas bordas que apareciam nas extremidades do item **Configurações** durante o hover/foco.
- O item **Configurações** agora é preenchido integralmente em azul ao passar o mouse ou receber foco.
- Mantido o suporte ao modo escuro do submenu.

### Correção de regressão
- Corrigido o espaçamento entre a logo e o dropdown **Configurações** que fazia o menu desaparecer ao mover o cursor até o item.
- O dropdown agora permanece acessível durante a transição do ponteiro e o clique em **Configurações** volta a abrir o painel corretamente.
- Removido o pequeno espaçamento que criava uma área sem hover entre o launcher e o dropdown.

### Limpeza e fixes
- Removido o antigo sistema de destaque/cor do botão **JETPHOTOS+** que não tinha mais função.
- Removido o CSS do antigo `jp-like-helper-panel`, que não era mais criado pela extensão.
- Removida a animação `jpSubmenuIn` que não era utilizada.
- Removida a classe `jp-card-liked-pop`, que já não possuía animação associada.
- Removidas variáveis e funções sem uso relacionadas ao antigo estado persistido do painel (`jpPanelVisible` / `alwaysOpen`).
- Removido o listener de clique do ícone da extensão no toolbar que enviava `jp-toggle-panel` sem existir um receptor funcional no content script.
- Removidas strings de tradução antigas que não eram mais utilizadas.
- Renomeado o identificador interno de estilos para `jp-plus-styles`, eliminando a referência ao antigo painel removido.
- Mantida a versão **1.9.3**, sem bump de versão.

---

## [1.9.2] — Experimental

### Correção do painel de Configurações
- A v1.9.1 mexeu no lugar errado (card da fila) e foi revertida.
- Corrigida a causa raiz do texto cortado no painel de Configurações: o menu de conta do JetPhotos aplica `white-space: nowrap`, que era herdado pelo painel da extensão.
- O painel e seus elementos agora usam `white-space: normal !important`, permitindo quebra de linha correta dentro dos 360px disponíveis.

---

## [1.9.1] — Experimental / revertida

### Correção de interface
- Foi testada uma alteração no card **Estimativa da fila** para empilhar rótulos e valores.
- A alteração foi revertida na v1.9.2 porque o problema real estava no painel de Configurações, não no card da fila.

---

## [1.9.0] — Experimental

### Submenu global + ferramenta contextual de curtidas
- O **JETPHOTOS+** passou a usar um submenu próprio em todas as páginas, aberto somente por hover/foco.
- O submenu do header contém, por enquanto, apenas **Configurações**.
- A ferramenta de curtidas deixou de ficar no submenu do header e passou a ser contextual, aparecendo no canto inferior direito apenas quando a página possui ações de Like.
- Corrigida a contagem de curtidas para o formato `X faltando / Y já curtidas`.
- Em `queue.php`, a fila continua sendo mostrada exclusivamente na própria página e o estimador permanece separado.

### Integração ao cabeçalho
- Corrigada a busca pelo header real do JetPhotos, substituindo a tentativa anterior baseada em `section.header_menu`.
- O launcher passou a ser inserido no mesmo contêiner da área da conta, integrado à navegação existente.
- Tipografia, tamanho, peso, espaçamento, altura e cor do launcher são herdados dinamicamente do header do JetPhotos.
- O painel passou a abrir como dropdown ancorado ao cabeçalho.
- Removidos o antigo ícone azul de avião e a estética Material do launcher.
- Removido o título **Assistente de Curtidas** e o botão **Atualizar contagem**.
- Mantida a integração visual do estimador dentro de `queue.php`.

---

## [1.8.9]

### Limpeza e estabilização do estimador de fila
- Removido código legado de `jpQueueHistory` e `jpQueueSnapshots`.
- Removido parsing de `periodDays`, que não participava mais de nenhum cálculo.
- `STORAGE_KEY_QUEUE_DAILY_STATS` voltou a ser a única fonte da chave `jpQueueDailyStats`.
- O `MutationObserver` da fila passou a ignorar mutações criadas pela própria interface da extensão.
- Mantido o algoritmo principal baseado na média dos últimos dias fechados coletados em background, com fallback para `Total Screened` quando ainda não há histórico suficiente.

---

## [1.8.8]

### Correções
- Corrigido `ReferenceError: STORAGE_KEY_QUEUE_DAILY_STATS is not defined` no leitor do histórico diário da fila.
- Protegido o ciclo assíncrono do estimador contra `Uncaught (in promise)` após recarregar a extensão.
- Preservada a UI e a lógica original do estimador durante o patch.

---

## [1.8.6] — Queue Monitor + idioma (experimental)

> **Experimental:** esta versão introduziu o monitor automático da fila e deve ser tratada como uma etapa de validação.

### Adicionado
- Monitor automático do **Total Screened** em background.
- Máximo diário persistente para cada dia observado.
- Histórico diário usado na média do estimador.
- Botão **Coletar agora** mantido como ferramenta de teste.
- Seletor de idioma com **Português (Brasil)** e **English**.

### Correções de interface
- Ajustado o layout do monitor para evitar sobreposição em colunas estreitas.
- Corrigidos rótulos em inglês.
- ETA do monitor passou a mostrar apenas duração.

### Alterado
- Monitor integrado à área de `Period Totals`.
- Removido o rótulo redundante de "ao vivo".
- Média histórica simplificada para **Média diária**, usando apenas dias concluídos.
- ETA da fila passou a usar duração legível, como `22 dias e 5h`.
- Rótulos e espaçamentos compactados para evitar quebras na coluna `Period Totals`.

### Observação técnica
- O histórico representa apenas valores que a extensão conseguiu observar enquanto o navegador estava ativo.
- A tabela de sete dias do JetPhotos continua sendo uma fonte auxiliar.

---

## [1.8.5]

### Correções / validação do estimador
- Identificado que a coluna `processed` não representava corretamente o ritmo real da fila.
- Passou a ser usada como fonte principal a área **Period Totals**, especialmente o **Total Screened** (`Total Accepted + Total Rejected`) do período selecionado.
- O ritmo diário passou a ser calculado dividindo o `Total Screened` pelo número de dias do período.
- Métodos anteriores foram mantidos apenas como fallback para mudanças futuras no layout do JetPhotos.
- A versão foi mantida propositalmente em 1.8.5 enquanto a conta era validada com números reais.

### Identidade e desempenho
- Marca atualizada para **JetPhotos+**.
- Paleta de destaque refinada para azul `#669DF6`, com `#8AB4F8` no modo escuro e neutros Material.
- Delay entre cliques do **Curtir faltantes** reduzido para aproximadamente 17ms por clique.

---

## [1.8.4]

### Alterado
- Delay entre cliques do **Curtir faltantes** reduzido de aproximadamente 150ms para aproximadamente 57ms por clique.

---

## [1.8.3]

### Alterado
- **Curtir faltantes desta página** passou a clicar uma foto por vez, com pausa curta entre os cliques.
- Botão fica desabilitado durante a execução para evitar duas levas simultâneas.

---

## [1.8.2]

### Corrigido
- Melhorado o contraste de textos cinza do menu da conta no modo escuro do site.
- Limite usado para decidir quando clarear textos foi ajustado de `0.45` para `0.7`.

---

## [1.8.1]

### Corrigido
- Ícones de Album / Like / Share e outros arquivos `*-black.svg` passaram a ser invertidos corretamente no modo escuro do site, sem alterar fotos reais.

---

## [1.8.0] — Experimental

### Alterado
- Modo escuro do site reescrito usando recoloração direcionada elemento a elemento via `getComputedStyle`.
- Removido o método anterior de `smart invert` baseado em `invert()` + `hue-rotate()` aplicado à página inteira.
- O novo método evita problemas com fotos carregadas posteriormente, cores saturadas e propagação de filtros entre containers.

---

## Anteriores — a confirmar

Funcionalidades identificadas no histórico do código, sem versão/data exata confirmada:

- Painel flutuante com **Curtir faltantes desta página** e contagem automática.
- Atualização da contagem via `MutationObserver` + debounce.
- Botão **Atualizar contagem**.
- Menu de configurações com opções de inicialização e modo escuro do painel.
- Suporte a múltiplas páginas do JetPhotos além do perfil de fotógrafo.
- Painel compacto em páginas sem suporte a curtidas.
- Primeira implementação do modo escuro experimental do site.
- **Sincronia de likes:** `content-hook.js` rodando no mundo da página para espionar `fetch`/`XHR` em `PostHandler.php?addFavorite=`/`removeFavorite=`, lendo o corpo da resposta (`"true"`/`"false"`) para confirmar o like no servidor e corrigir o bug visual do JetPhotos.
- **Cache local de curtidas** (`jpPlusLikedPhotoIds_v1` no `localStorage`), usado como fonte de verdade extra para manter o estado "curtido" depois de um F5.
- **Botão de Like injetado no layout mobile**, com requisição direta ao `PostHandler.php` e estado sincronizado a cada scan.
