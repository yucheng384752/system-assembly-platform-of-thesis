import { Resvg } from '@resvg/resvg-js';

// Test helpers only: decode a PNG back to pixels so tests can look at what was actually drawn.
export const PNG_SIGNATURE_FOR_TEST = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Number of opaque pixels within `tolerance` of `rgb` on every channel (text edges are antialiased). */
export function inkIn(png: Uint8Array, rgb: [number, number, number], tolerance = 0): number {
  // resvg reads PNG only through an <image>, so wrap the bytes in an SVG and read the pixels back at original size.
  const view = new DataView(png.buffer, png.byteOffset);
  const [w, h] = [view.getUint32(16), view.getUint32(20)];
  const href = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><image width="${w}" height="${h}" href="${href}"/></svg>`;
  const { pixels } = new Resvg(wrapper, { fitTo: { mode: 'original' } }).render();
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 255 && [0, 1, 2].every(c => Math.abs(pixels[i + c]! - rgb[c]!) <= tolerance)) count++;
  }
  return count;
}
