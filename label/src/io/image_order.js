// label/src/io/image_order.js
// Decide the ordered list of image basenames for the frame axis.
// - With COCO images that carry file_name: follow json array order EXACTLY
//   (authoritative; no sort), returning each entry's file_name basename.
// - Without file_names (data-less / synthesized): numeric-sort the available
//   basenames (so 2.jpg precedes 10.jpg).
export function basename(p) { return String(p).split('/').pop(); }

export function orderedImageNames({ cocoImages, availableNames }) {
  const hasNames = Array.isArray(cocoImages) && cocoImages.length > 0
    && cocoImages.every((im) => typeof im.file_name === 'string' && im.file_name.length);
  if (hasNames) return cocoImages.map((im) => basename(im.file_name));
  return [...availableNames]
    .map((p) => basename(p))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
