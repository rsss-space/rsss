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
`decode(...)` and `createImageData(...)` to a small cap (32px on the long
edge, aspect ratio preserved from `width`/`height`), while continuing to
honor `width`/`height` for layout (`this.style.width/height`). The source
dimensions are legitimately needed only to reserve layout space and avoid
layout shift -- never to size the decode. This needs no API change, fixes
every existing consumer on upgrade, and makes the expensive path
unreachable rather than merely non-default.

The clamp must be applied at every site that sizes the pixel buffer, via a
single shared pure helper to avoid drift:

- `src/index.ts` `connectedCallback` -- `decode(...)` and
  `createImageData(...)`.
- `src/index.ts` `reset()` -- the same two calls on image change.
- `src/html.ts` `render()` -- the `<canvas>` intrinsic `width`/`height`
  attributes, which currently bake in the full layout size too.

Extract `clampDecodeDimensions(width, height) -> { width, height }` (32px
long edge, aspect preserved, short edge floored per the caveat below) and
call it from all three. The constructor's `this.style.width/height`
assignment is the layout job and stays exactly as-is.

### Why 32px on the long edge

32px is the principled cap, not just a cheap one -- it is provably
lossless for any valid blurhash. A blurhash decodes to a sum of cosine
basis functions; the highest-frequency term along an axis with `c`
components completes `(c-1)/2` cycles across that edge, so sampling it
without loss requires more than `(c-1)` pixels on the edge. BlurHash caps
components at 9, so the worst case ever needs >8px on the long edge; 32px
is ~2-3.5x oversampled. Above 32px there is no frequency content left to
capture for any hash -- a larger decode only changes how finely the
browser interpolates the same gradient, and the canvas (`width: 100%`)
already does that interpolation on upscale regardless of decode size.

64px was considered and rejected: it is 4x the pixels for zero additional
detail, since 32px already covers the 9x9 maximum with margin. The
"headroom for high-component hashes" intuition does not hold.

### Caveat: floor the short edge

With aspect-ratio-preserving scaling and a `min 1px` short edge, an
extreme aspect ratio (e.g. a 2000x100 banner) crushes the short edge to
~2px, which can undersample whatever components that hash carries on the
short axis. The correct guard is to floor the short edge (e.g. at ~8px),
not to raise the long-edge cap. In practice blurhash encoders choose
component counts proportional to aspect ratio, so wide images carry few
vertical components and even a 2px short edge is usually fine -- but the
short-edge floor is the clean fix if robustness against pathological
inputs is wanted.

### Decode off the synchronous mount (main thread, no worker)

In scope for this change, but as defense in depth, not the primary fix --
the 32px cap already turns a list of decodes from ~6 s into single-digit
milliseconds. The remaining goal is only to keep that small cost out of
the synchronous mount/commit so it can never delay first paint: have
`connectedCallback` *schedule* the decode and return immediately rather
than decode inline.

Do this on the main thread. A Web Worker / `OffscreenCanvas` is explicitly
rejected here: at 32px the decode is sub-millisecond, so `postMessage` +
buffer transfer can cost more than the decode it offloads, and it adds a
worker entry point, cross-format (ESM/CJS/min) bundling, a message
protocol, and a no-worker fallback -- disproportionate surface to protect
work that is already cheap.

Use `requestAnimationFrame` to run the decode after the mount commit. It
keeps the blur present on the first paint that follows mount in the common
case. (A batch of N elements still decodes in one rAF before that paint,
so rAF does not fully evict the work from the paint-critical path -- but
with the cap that batch is ~10-20ms typical, and only approaches ~100ms
for the rare 9-component hash across many rows. The alternative,
`requestIdleCallback`/`setTimeout`, fully leaves the paint path but paints
one frame of empty thumbnail before the blur, which undercuts the
placeholder's purpose; rAF is the better default.)

Deferral introduces a pending-handle lifecycle that must be managed: a
second `reset()`, or `disconnectedCallback`, before a scheduled decode
runs must cancel the stale handle, and the scheduled callback must bail if
the element is no longer connected (the canvas may be gone). This is the
same cancellation discipline as a `cancelIdle`/token guard -- without it,
a stale decode races a newer one or writes to a detached canvas.

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

Locations below are in the `@substrate-system/blur-hash` package source
(confirmed against `src/`, not the built `dist/` a consumer sees):

- `src/index.ts` `connectedCallback` (~lines 108-111) and `reset()`
  (~lines 65-68): both call `decode(placeholder, width, height)` and
  `createImageData(width, height)` at full layout size.
- `src/html.ts` `render()` (~lines 23-28): bakes the full `width`/`height`
  into the `<canvas>` intrinsic dimensions, so the pixel buffer is sized
  to layout size too. Any fix must touch this file as well.
- `src/index.ts` constructor (~lines 36-37): sets `this.style.width/height`
  from the same attribute -- the legitimate layout job; leave as-is.
- `src/index.css`: `canvas { width:100%; height:100% }` -- confirms a
  small decode stretches to fill the host invisibly.
- `blurhash` decode complexity: `decode(hash, width, height)` is linear
  in `width * height` and in the number of DCT components encoded.
- Consumer workaround already shipped in rsss:
  `src/client/components/item-row.ts` (`blurhashDecodeSize`, 32px cap),
  `test/item-row.ts` (bounded-decode-resolution assertions).
