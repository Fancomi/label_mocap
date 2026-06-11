export function imageUrlForFrame(image, frame) {
  if (!image || typeof image.pattern !== 'string') {
    throw new Error('image pattern is required');
  }
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error('frame must be a non-negative integer');
  }

  const placeholders = image.pattern.match(/%0\d+d|%d/g) ?? [];
  if (placeholders.length !== 1) {
    throw new Error('image pattern must contain a single %d or %0Nd placeholder');
  }

  const placeholder = placeholders[0];
  const match = placeholder.match(/^%0(\d+)d$/);
  const formattedFrame = match ? String(frame).padStart(Number(match[1]), '0') : String(frame);
  return `${image.baseUrl ?? ''}${image.pattern.replace(placeholder, formattedFrame)}`;
}
