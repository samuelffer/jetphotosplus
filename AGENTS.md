# AGENTS.md — como trabalhar neste repositório

> **Leia isto antes de qualquer alteração.** Este arquivo existe porque cada
> nova sessão/agente começa sem memória das conversas anteriores: se o
> combinado não estiver escrito aqui, ele se perde.

## Primeiro: o que é o projeto

**JetPhotos+** — extensão de navegador (Manifest V3, Chrome + Firefox) que
roda em `https://www.jetphotos.com/*`. Três frentes:

- **Curtidas:** acha as fotos ainda não curtidas numa página e curte em massa
  com um clique, corrigindo o bug visual do próprio JetPhotos.
- **Modo escuro do site (beta):** recoloração elemento a elemento via
  `getComputedStyle`, com anti-FOUC.
- **Estimador da fila (experimental):** em `queue.php`, estima quanto falta
  pra uma foto ser avaliada.

Idioma do projeto: **português (Brasil)** nos comentários, changelog,
`leia-me.txt` e na comunicação com o usuário.

## 🔴 Fluxo de trabalho (obrigatório)

O usuário **testa no próprio PC antes de qualquer commit**. O GitHub é o
destino final, não o ambiente de teste.

1. Receba o pedido e altere o código em `extension/`.
2. Gere o pacote de teste:
   ```bash
   node scripts/build-zip.mjs
   ```
   Isso cria `zips/jetphotosplus-v<versão>.zip` (a versão vem do
   `manifest.json`). O zip sai com o `manifest.json` na **raiz**.
3. **Mostre o arquivo .zip ao usuário** (`present_file`) e aguarde.
4. O usuário baixa, descompacta e carrega via "Carregar sem compactação"
   (`chrome://extensions`). Se ele já tiver a pasta carregada, basta
   sobrescrever os arquivos e clicar no **↻**.
5. **Só commite depois que o usuário disser explicitamente que aprovou.**
   Se ele reportar problema, corrija e gere um novo zip — sem commitar.

### Regras que decorrem disso

- **Nunca** faça commit, push, abra PR ou publique release sem aprovação
  explícita do usuário depois do teste.
- `zips/` está no `.gitignore` — os pacotes de teste nunca são commitados.
- Não crie branches de teste nem espere que o usuário faça `git pull` pra
  testar. O teste é via zip.

## Versão: manter tudo sincronizado

Sempre que subir a versão, atualize **todos** os lugares abaixo — eles já
ficaram divergentes uma vez e isso gerou confusão:

| Arquivo | Onde |
|---|---|
| `extension/manifest.json` | `"version"` — é a fonte da verdade (o script de zip lê daqui) |
| `extension/CHANGELOG.md` | nova entrada no topo + cabeçalho "Versão atual" |
| `extension/leia-me.txt` | linha "Versão atual:" |
| `docs/index.html` | textos `Install vX.Y.Z` (pt/en), `releaseVersion` e fallback de `tag_name` |

O site em `docs/` busca `https://api.github.com/repos/samuelffer/jetphotosplus/releases/latest`.
Ou seja: **o site só passa a exibir uma versão nova depois que a release é
publicada no GitHub** — os textos no HTML são só o estado pré-carregamento.
Não crie release sem o usuário pedir.

## Mapa do código

```
extension/
  manifest.json      MV3, content script em document_start
  content.js         (~3.100 linhas) o cérebro: UI na página, curtidas,
                     modo escuro, estimador da fila
  content-hook.js    roda no MUNDO DA PÁGINA; espiona fetch/XHR do
                     PostHandler.php pra confirmar like no servidor
  background.js      service worker: coleta a fila a cada 10 min (alarms)
  popup.*            popup do ícone (Ritmo da fila + gráfico + export/import)
  _locales/          só nome e descrição da extensão
  CHANGELOG.md       histórico (Keep a Changelog + SemVer)
  leia-me.txt        instruções de instalação pro usuário final
scripts/
  build-zip.mjs      gera o pacote de teste (Node puro, zero dependência)
docs/                site de divulgação (GitHub Pages)
```

### Armazenamento

- `chrome.storage.local`: `jpQueueDailyStats`, `jpSiteDarkMode`,
  `jpQueueEstimatorEnabled`, `jpLanguage`
- `localStorage` da página: `jpPlusLikedPhotoIds_v1` (cache de curtidas)

### Pontos sensíveis do código

- O estado de "curtido" vem da classe `.social__link--active` + cache local.
  **Não** use o `src` do ícone pra diferenciar like/unlike — é o mesmo nos
  dois estados.
- `getPhotoId()` usa seletor restrito (`.result[data-photo]`, `.social[data-id]`)
  de propósito: um `[data-id]` genérico casaria com widgets alheios e
  marcaria fotos erradas como curtidas.
- O parse do `queue.php` está **duplicado** em `background.js` e `content.js`.
  Se o layout do site mudar, corrija os dois.

## Estilo

- Comentários explicando o **porquê**, não o quê (é o padrão do projeto).
- Não reformate o que não foi pedido: `content.js` é grande, mas está
  segmentado por blocos de comentário.
- Sempre avise quando algo foi **inferido** em vez de confirmado,
  principalmente em texto de changelog.
