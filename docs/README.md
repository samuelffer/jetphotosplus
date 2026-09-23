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

O site consulta automaticamente a **última release publicada** (`/releases/latest`) do repositório oficial do projeto através da API pública do GitHub.

Se a release tiver um arquivo `.zip`, o botão **Download** aponta diretamente para esse asset. Se o asset não estiver disponível ou a API estiver temporariamente indisponível, o botão abre a página da release como fallback.

Para publicar uma nova versão, basta criar a nova Release no GitHub: como o site consulta `/releases/latest`, ela passa a ser exibida automaticamente. Os textos estáticos de `index.html` (`Install vX.Y.Z` e o fallback de `version`) são apenas o estado exibido antes de a API responder — atualize-os junto para manter o pré-carregamento coerente com a nova versão.

> **Atenção:** enquanto a nova versão não estiver publicada, esses textos devem continuar apontando para a **última release publicada** (hoje `v1.9.4`). Senão o site anuncia uma versão que ainda não pode ser baixada e o número "pisca" trocando de valor assim que a API responde.

## Repositório

`https://github.com/samuelffer/jetphotosplus`

## Release atual

`v1.9.4` — `https://github.com/samuelffer/jetphotosplus/releases/tag/v1.9.4`

> Última release publicada. A versão **2.0.0** já está no código (`extension/manifest.json`), mas ainda depende de uma release no GitHub para aparecer no site.


## Branding note
The site identifies the extension as an unofficial community extension and does not claim affiliation with JetPhotos/Flightradar24.


## Photo background
Put images in `assets/photos/`, double-click `update_photos.bat`, then open/reload `index.html`.
