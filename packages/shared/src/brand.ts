import { colors } from './tokens';

/** The ShifuBot mark as an SVG string, built from the design tokens. Used for the favicon and the logo. */
export function logoSvg(size = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
<defs><linearGradient id="shifu-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.primary}"/><stop offset="1" stop-color="${colors.lavender}"/></linearGradient></defs>
<rect width="64" height="64" rx="18" fill="${colors.background}"/>
<rect x="3" y="3" width="58" height="58" rx="16" fill="none" stroke="url(#shifu-g)" stroke-width="2" opacity=".7"/>
<path d="M41 21.5c-2.4-2.2-5.6-3.5-9.3-3.5-6.1 0-10.2 3.3-10.2 8 0 4.5 3.6 6.4 9.4 7.6 4.2.9 5.6 1.8 5.6 3.6 0 2-2.1 3.3-5.2 3.3-3.4 0-6.2-1.4-8.4-3.7l-3.6 4c2.9 3 7 4.7 11.9 4.7 6.7 0 11.1-3.4 11.1-8.6 0-4.7-3.3-6.8-9.7-8.1-3.9-.8-5.3-1.7-5.3-3.3 0-1.7 1.8-2.9 4.5-2.9 2.5 0 4.7.9 6.6 2.6z" fill="url(#shifu-g)"/>
</svg>`;
}

export function logoDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(logoSvg())}`;
}
