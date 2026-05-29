# Design flaw in `@substrate-system/blur-hash`: decode resolution is tied to display size

Discovered: 2026-05-29, while debugging multi-second jank navigating to the
home (`/`) route in rsss.

## Summary

The `<blur-hash>` web component uses a single pair of `width`/`height`
attributes for three unrelated jobs at once:

1. The pixel resolution it decodes the BlurHash placeholder to.
2. The pixel size of the backing `<canvas>`.
3. The element's inline layout size (`this.style.width/height`).

Because the decode resolution is the same number a caller naturally
reaches for (the source image's dimensions), the component decodes a
placeholder at full image resolution by default. BlurHash decoding is
`O(width * height * componentsX * componentsY)`, so a single 1200x630
placeholder is ~756,000 pixels each summed over the DCT basis -- tens of
millions of operations, synchronously, on the main thread, inside
`connectedCallback`. The result is then displayed at 80x80 after a CSS
downscale, so essentially all of that work is wasted.

There is no separate "decode at this small size, display at that larger
size" knob. A caller cannot ask for a cheap decode without also shrinking
the element.

## Where the flaw lives

`@substrate-system/blur-hash/dist/index.js`:

```js
connectedCallback() {
    const width = parseInt(this.getAttribute("width") ?? "");
    const height = parseInt(this.getAttribute("height") ?? "");
    const placeholder = this.getAttribute("placeholder");
    ...
    const pixels = decode(placeholder, width, height);   // <-- O(w*h*cx*cy)
    const canvas = this.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(width, height); // <-- canvas at same size
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    this.sharpen();
}
```

and in the constructor:

```js
this.style.width = "" + w;    // layout size, also from the same attribute
this.style.height = "" + h;
```

The accompanying stylesheet scales the canvas to fill the host
regardless of its pixel dimensions, which is the crucial fact that makes
a small decode look identical to a large one:

```css
blur-hash canvas { width: 100%; height: 100%; }
```

So the canvas could be decoded at 32x17 and still fill an 80x80 (or any
size) host with no visible difference -- a BlurHash placeholder is a
low-frequency blur, it carries no detail that a higher decode resolution
would preserve.

## Why it is easy to trigger

The component's own type signatures and examples invite the caller to
pass the image's real dimensions as `width`/`height` (they are the
obvious values to have on hand, and they are needed to reserve correct
layout space and avoid layout shift). Doing the obvious thing produces a
full-resolution decode. The expensive path is the default path; the cheap
path requires the caller to know that `width`/`height` secretly means
"decode resolution" and to pass deliberately wrong (small) numbers.

The cost is also invisible in isolation. One element decoding once is a
few hundred milliseconds at most and is easy to miss. The problem only
becomes obvious when many elements mount in the same synchronous commit
(a list view), where the per-element cost stacks into a multi-second
main-thread block that delays paint.

## Impact observed in rsss

The home route renders a list of items, each with one `<blur-hash>`
thumbnail. Navigating to `/` mounted ~20 of them in one Preact commit.
Measured with a route-change-to-next-paint probe plus a `longtask`
observer:

```
/ -> /settings:        19 ms   (no blur-hash mounted)
/settings -> /:      6032 ms   (single longtask, starts at +0 ms)
/ -> /post/...:        13 ms   (item view, no list of blur-hashes)
/post/... -> /:      5745 ms   (single longtask, starts at +0 ms)
```

Each decode ran at the source image size (~1200x630). Displayed size was
80x80. The decode work was ~150x larger in each dimension than anything
the user could see.

## Workaround applied in the consumer

rsss now decodes at a bounded, aspect-preserved resolution (~32px on the
long edge) by passing small `width`/`height` to the element, relying on
the canvas's `width: 100%` CSS to scale it back up to the 80px thumbnail.
See `src/client/components/item-row.ts` (`blurhashDecodeSize`). This drops
the per-row decode from ~756,000 pixels to ~544, roughly a 1,390x
reduction, and the navigation longtask from ~6 s to a few ms.

This is a band-aid at the call site. It works because we happen to know
the component's internals and that the canvas is CSS-scaled. It is not
discoverable, and every other consumer of the package has the same trap
waiting for them.

## Proper fix (upstream, in the package)

Cap the decode resolution internally. No API change.

A BlurHash encodes a tiny number of DCT components (at most 9x9), so the
decoded output is strictly low-frequency -- a smooth gradient with no
detail. Decoding above roughly 32px on the long edge adds no visual
information whatsoever: a 32px decode scaled up by CSS is
indistinguishable from a native large decode (often smoother). The hash
itself is the fidelity ceiling, and the only thing this component renders
is a placeholder. Therefore "decode small" is correct in every case;
there is no scenario where a larger decode of a placeholder is useful.

The fix follows directly from that: clamp the dimensions passed to
`decode(...)` and `createImageData(...)` to a small cap (e.g. 32px on the
long edge, aspect ratio preserved from `width`/`height`), while continuing
to honor `width`/`height` for layout (`this.style.width/height`). The
source dimensions are legitimately needed only to reserve layout space and
avoid layout shift -- never to size the decode. This needs no API change,
fixes every existing consumer on upgrade, and makes the expensive path
unreachable rather than merely non-default.

Optionally, as defense in depth: move the decode off the synchronous
`connectedCallback` (e.g. via a worker or `OffscreenCanvas`) so that even
a pathological caller cannot block paint. Secondary to the cap, not a
substitute for it.

### Rejected: an opt-in decode-size attribute

An earlier draft of this doc proposed an optional `decode-size` (or
`decode-width`/`decode-height`) attribute defaulting small but allowing a
caller to request a larger decode. That is rejected. It contradicts the
premise above: it adds API surface to document and test purely to expose a
capability that has no use case, since a larger decode of a low-frequency
placeholder yields no benefit. It also leaves a smaller version of the
same footgun in place for anyone who passes the wrong value. If a concrete,
justified need for a specific decode size ever appears, add the attribute
then -- but the unconditional internal cap should ship regardless.

## References

- Component: `node_modules/@substrate-system/blur-hash/dist/index.js`
  (`connectedCallback`, constructor), `dist/style.css`.
- `blurhash` decode complexity: `decode(hash, width, height)` is linear
  in `width * height` and in the number of DCT components encoded.
- Consumer workaround: `src/client/components/item-row.ts`,
  `test/item-row.ts` (bounded-decode-resolution assertions).
