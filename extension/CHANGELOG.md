# Changelog — JetPhotos+

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) + [SemVer](https://semver.org/lang/pt-BR/).

> **Versão atual: 1.9.3.** Os ajustes desta revisão permanecem dentro da 1.9.3 para estabilização e testes.

## [1.9.3] — Atual

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
- Removido o rótulo redundante de “ao vivo”.
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
