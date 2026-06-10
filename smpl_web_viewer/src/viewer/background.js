export function imageUrlForFrame(image, frame) {
  const match = image.pattern.match(/%0(\d+)d/);
  if (!match) return `${image.baseUrl}${image.pattern.replace('%d', String(frame))}`;
  return `${image.baseUrl}${image.pattern.replace(match[0], String(frame).padStart(Number(match[1]), '0'))}`;
}
