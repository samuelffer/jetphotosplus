# AGENTS_ONLY_FOR_WEBSITE.MD — regras do SITE (GitHub Pages)

> **Leia este arquivo SOMENTE se a tarefa mexer no site.**
> Mexeu em `extension/`, popup, modo escuro, bolha, FAB ou qualquer coisa da
> extensão? Ignore este arquivo por completo e siga só o `AGENTS.md`.
> Mexeu em `docs/`? Este arquivo manda — e o `AGENTS.md` fica de lado na
> parte específica da extensão (as regras de branch/zip valem igual nos dois).

## Primeiro: o que é o site

Landing page enxuta de divulgação do JetPhotos+, publicada via
**GitHub Pages a partir da pasta `docs/`**:
`https://samuelffer.github.io/jetphotosplus/`.

- O botão de download consulta a **última release PUBLICADA**
  (`https://api.github.com/repos/samuelffer/jetphotosplus/releases/latest`).
  Sem release publicada, não há versão nova no site — e **não crie release
  sem o usuário pedir**.
- Os textos estáticos de versão no `index.html` (`Install vX.Y.Z`,
  `releaseVersion`, fallback de `tag_name`) são só o estado exibido antes
  de a API responder: devem espelhar a **última release publicada**, nunca
  a versão em desenvolvimento na `extension/`. Se apontarem pra uma versão
  que ainda não existe, o número "pisca" trocando de valor quando a API
  responde.
- O site se apresenta como extensão **não-oficial da comunidade**, sem
  sugerir afiliação com JetPhotos/Flightradar24. Mantenha isso em qualquer
  texto novo.

Idioma do projeto: **português (Brasil)** nos comentários, docs e na
comunicação com o usuário. (O conteúdo do site em si é bilíngue pt/en via
`data-i18n` — texto novo no site precisa das duas versões.)

## 🔴 Fluxo de trabalho (obrigatório — mesma lógica da extensão)

O chat **não transfere arquivos zip** — por isso o teste roda via GitHub:
o agente publica cada versão de teste como um `.zip` commitado na branch
da sessão (Arena), o usuário baixa esse zip pelo navegador e testa o site
no próprio PC. O GitHub é a ponte, não o destino final.

1. Receba o pedido e altere o código em `docs/`.
2. Se mexeu nas fotos (`docs/assets/photos/`), regenere o manifesto antes
   de empacotar:
   ```bash
   cd docs && node build-photo-manifest.mjs
   ```
   (Isso reescreve `docs/assets/photos.js`, que é o que o `index.html`
   realmente carrega.)
3. Gere o pacote de teste:
   ```bash
   node scripts/build-site-zip.mjs
   ```
   Isso cria `zips/jetphotosplus-site.zip` — ou `jetphotosplus-site-r2`,
   `-r3`, ... se já existir (o script **nunca sobrescreve**: cada
   modificação gera um zip novo). O zip sai com o `index.html` na **raiz**
   e contém **só os arquivos do site** — `README.md` e
   `build-photo-manifest.mjs` ficam de fora (são ferramentas do
   repositório, ver `ZIP_EXCLUDE` no script).
4. Commite e dê push **na branch da sessão (Arena)** — código + zip juntos:
   ```bash
   git add -A
   git add -f zips/<nome-do-zip-gerado>.zip
   git commit -m "..."
   git push origin <branch-da-sessão>
   ```
   (`zips/` está no `.gitignore`, por isso o `-f`: os zips vivem SÓ nas
   branches de sessão, nunca no `main`.)
5. Avise o usuário com o link do zip na branch pra ele baixar e testar.
6. O usuário baixa, descompacta e **abre o `index.html` no navegador**
   (duplo clique funciona: scripts clássicos, sem módulos ES, e a API do
   GitHub tem CORS liberado). Se um dia entrar `fetch()` de arquivo local,
   o teste passa a exigir servidor local (`python -m http.server`).
7. Se ele reportar problema, corrija, gere um novo zip e dê push de novo —
   tudo ainda só na branch da sessão.

### Regras que decorrem disso

- Trabalhe **sempre** na branch da sessão (Arena), nunca no `main`.
- **Nunca** faça push pro `main`, abra PR ou publique release sem o usuário
  pedir explicitamente. Quando o site estiver satisfatório, é **o próprio
  usuário** quem leva os arquivos pro `main` manualmente — a branch da
  sessão serve só como área de download dos zips de teste, não para merge.
- `zips/` está no `.gitignore` de propósito: os pacotes de teste são
  commitados com `-f` só nas branches de sessão e nunca chegam ao `main`.
- O site **não tem versão própria**: os zips de teste se diferenciam só
  pelo sufixo `-rN`. Não invente número de versão pro site.

## Mapa do site

```
docs/
  index.html               landing page (textos estáticos + i18n pt/en inline)
  style.css                estilos
  assets/
    photos.js              manifesto GERADO (não edite à mão — regenere pelo script)
    photos/                fotos de fundo (jpg/png/webp)
    jetphotosplus-logo.png logo
    favicon-*.png / apple-touch-icon.png / site.webmanifest
  build-photo-manifest.mjs gera assets/photos.js a partir de assets/photos/
  README.md                paleta, download, release atual (doc do repositório)
scripts/
  build-site-zip.mjs       gera o pacote de teste do site (Node puro, zero dependência)
```

## Estilo

- Comentários explicando o **porquê**, não o quê.
- Texto novo visível no site: sempre nas duas línguas (`data-i18n` + dicionários pt/en).
- Não reformate o que não foi pedido.
- Sempre avise quando algo foi **inferido** em vez de confirmado.
