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

O chat **não transfere arquivos zip** — por isso o teste roda via GitHub:
o agente publica cada versão de teste como um `.zip` commitado na branch
da sessão (Arena), o usuário baixa esse zip pelo navegador e testa a
extensão no próprio PC. O GitHub é a ponte, não o destino final.

1. Receba o pedido e altere o código em `extension/`.
2. Gere o pacote de teste:
   ```bash
   node scripts/build-zip.mjs
   ```
   Isso cria `zips/jetphotosplus-v<versão>.zip` (a versão vem do
   `manifest.json`). O zip sai com o `manifest.json` na **raiz** e contém
   **só os arquivos de instalação** — `CHANGELOG.md` fica de fora (é
   documento do repositório, ver `ZIP_EXCLUDE` no script).
   Cada modificação gera um zip novo e **nunca sobrescreve** um anterior:
   como a versão só muda quando o usuário mandar, testes repetidos na
   mesma versão ganham sufixo automático (`-r2`, `-r3`, ...).
3. Commite e dê push **na branch da sessão (Arena)** — código + zip juntos:
   ```bash
   git add -A
   git add -f zips/<nome-do-zip-gerado>.zip
   git commit -m "..."
   git push origin <branch-da-sessão>
   ```
   (`zips/` está no `.gitignore`, por isso o `-f`: os zips vivem SÓ nas
   branches de sessão, nunca no `main`.)
4. Avise o usuário com o link do zip na branch pra ele baixar e testar.
5. O usuário baixa, descompacta e carrega via "Carregar sem compactação"
   (`chrome://extensions`). Se ele já tiver a pasta carregada, basta
   sobrescrever os arquivos e clicar no **↻**.
6. Se ele reportar problema, corrija, gere um novo zip e dê push de novo —
   tudo ainda só na branch da sessão, **sem trocar a versão**.

### Regras que decorrem disso

- Trabalhe **sempre** na branch da sessão (Arena), nunca no `main`.
- **Nunca** faça push pro `main`, abra PR ou publique release sem o usuário
  pedir explicitamente. Quando uma versão estiver satisfatória, é **o próprio
  usuário** quem pega os arquivos do zip e commita no `main` manualmente —
  a branch da sessão serve só como área de download dos zips de teste,
  não para merge.
- `zips/` está no `.gitignore` de propósito: os pacotes de teste são
  commitados com `-f` só nas branches de sessão e nunca chegam ao `main`.

## Versão: manter tudo sincronizado

**Não troque a versão a cada alteração.** A versão só muda quando o usuário
disser explicitamente qual deve ser (enquanto isso, os zips de teste da
mesma versão se diferenciam pelo sufixo `-rN`).

Quando ele mandar subir a versão, atualize **todos** os lugares abaixo — eles já
ficaram divergentes uma vez e isso gerou confusão:

| Arquivo | Onde |
|---|---|
| `extension/manifest.json` | `"version"` — é a fonte da verdade (o script de zip lê daqui) |
| `extension/CHANGELOG.md` | nova entrada no topo + cabeçalho "Versão atual" |
| `extension/leia-me.txt` | linha "Versão atual:" |
| `docs/index.html` | textos `Install vX.Y.Z` (pt/en), `releaseVersion` e fallback de `tag_name` — **mas estes devem espelhar a última release PUBLICADA, não a versão em desenvolvimento** |

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
