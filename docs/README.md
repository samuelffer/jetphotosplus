# JetPhotos+ — GitHub Pages

Landing page enxuta para distribuição da extensão.

## Paleta

A identidade usa azul inspirado no projeto atual, com um acento mais controlado:

- Light accent: `#669DF6`
- Light hover: `#7BAAF7`
- Dark accent: `#8AB4F8`
- Dark background: `#202124`
- Dark surface: `#2D2E31`
- Light surface: `#F1F3F4`
- Text: `#1F1F1F` / `#E8EAED`

## Download

O site consulta automaticamente a release `1.9.3-BETA` do repositório oficial do projeto através da API pública do GitHub.

Se a release tiver um arquivo `.zip`, o botão **Download** aponta diretamente para esse asset. Se o asset não estiver disponível ou a API estiver temporariamente indisponível, o botão abre a página da release como fallback.

Para publicar uma nova versão, basta criar a nova Release no GitHub e atualizar `RELEASE_API` e `FALLBACK_RELEASE` em `index.html` para a nova tag.

## Repositório

`https://github.com/samuelffer/jetphotosplus`

## Release atual

`1.9.3-BETA` — `https://github.com/samuelffer/jetphotosplus/releases/tag/1.9.3-BETA`


## Branding note
The site identifies the extension as an unofficial community extension and does not claim affiliation with JetPhotos/Flightradar24.
