// The <blur-hash> element decodes its placeholder synchronously in
// connectedCallback at the width/height it is given. The thumbnail is
// only ever shown at 80px (the canvas is CSS-scaled to fill), so the
// decode resolution should be bounded small. Decoding at the source
// image dimensions (often ~1200x800) is ~150x more pixels than are
// displayed and blocks the main thread for hundreds of ms per row --
// across a list of items this is multi-second jank on every mount.
export const BLURHASH_DECODE_MAX = 32

export function blurhashDecodeSize (
    width:number,
    height:number
):{ width:number; height:number } {
    if (width >= height) {
        return {
            width: BLURHASH_DECODE_MAX,
            height: Math.max(
                1,
                Math.round(BLURHASH_DECODE_MAX * height / width)
            )
        }
    }
    return {
        width: Math.max(
            1,
            Math.round(BLURHASH_DECODE_MAX * width / height)
        ),
        height: BLURHASH_DECODE_MAX
    }
}
