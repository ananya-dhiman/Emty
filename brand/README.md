# Brand assets

Everything here is generated from a single source of truth —
`frontend/src/assets/cyan_on_black.png` — so the mark can never drift between
places. Regenerate with:

```bash
bash brand/render.sh
```

Needs Chrome and node, nothing else. `build.js` emits one HTML page per image
sized to its exact output, Chrome rasterizes it, the intermediates are deleted.
The two fonts are vendored here (`bebas.ttf`, `spacemono.ttf`,
`spacemono-bold.ttf`, both SIL OFL) and embedded as base64 so a render never
depends on the network.

## Files

| File | Size | Where it goes |
|---|---|---|
| `social-a-dark.png` | 1280×640 | GitHub social preview, landing page OG image, Twitter/LinkedIn post image |
| `social-b-centered.png` | 1280×640 | Alternate: quieter, most crop-proof |
| `social-c-cyan.png` | 1280×640 | Alternate: inverted, loud in a dark-mode timeline |
| `avatar-dark.png` | 1024×1024 | GitHub org / Twitter / LinkedIn profile picture |
| `avatar-cyan.png` | 1024×1024 | Alternate avatar |
| `favicon.png` | 256×256 | Copied to `landing-page/public/favicon.png` |

`render.sh` also copies `social-a-dark.png` to
`landing-page/public/og-image.png` and the favicon into place, so the landing
page and the social cards stay in sync.

## Colours

```
cyan   #00E5FF
black  #050505
```

## How the mark gets its colour

The source PNG is used as a *luminance mask*, not as pixels, so the mark is
painted in whatever colour the layout asks for and sits cleanly on any
background. A mask built straight from the PNG would land at ~62% alpha —
that is cyan's own relative luminance — so an `feColorMatrix` in `build.js`
normalizes the strokes to pure white first. Antialiased edges stay linear.

## Avatar sizing

The mark is inset to 64% of the avatar canvas. At its natural size the bottom
bar sits almost exactly on the circle that Twitter and LinkedIn crop to, so it
would clip. The favicon uses 82% instead, since nothing crops it.
