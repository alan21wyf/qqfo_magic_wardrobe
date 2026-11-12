# Design assets

## Approved homepage — 2026-11-12

`home/approved-home.png` is the approved full-resolution reference: the Tiandu wardrobe and phoenix, teal equipment entry, muted coming-soon entries, floating-island footer, and a small Alan signature at bottom right.

The runtime uses `miniprogram/images/wardrobe/home-artwork.jpg`, a JPEG export of the reference. The homepage clips this artwork into separate native controls. Labels, disabled states, navigation, touch feedback and image-error fallbacks remain implemented in WXML/JS. Both image sources and this document are versioned for later revisions.

Artwork coordinates (source: 1122 × 1402 pixels):

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Hero | 0 | 0 | 1122 | 620 |
| Equipment button | 94 | 628 | 934 | 147 |
| Fashion button | 94 | 790 | 934 | 146 |
| MBTI button | 94 | 958 | 460 | 140 |
| Coming-soon button | 565 | 958 | 460 | 140 |
| Footer | 0 | 1112 | 1122 | 290 |

## Archived duo — not in use

`archive/qq-fantasy-duo-v1.png` is the first overhead wide-angle duo illustration: dark-haired male with sword and shield, teal-haired female with staff, and brown leather outfits. The original PNG is preserved without changes.

This image is archived at the user's request and is not referenced by the mini program, posters, or runtime code. It is outside `miniprogramRoot` and is not shipped in the mini-program package. It was created with QQ Fantasy character-art references; archiving does not establish a license for public or commercial use. A separate decision is required before using it in the product.
