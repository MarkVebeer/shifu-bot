import { colors, coreMessages, fonts, gradients, isLocale, radii, shadows, withAlpha, type Locale } from '@shifubot/shared';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function localeFromCookie(cookieHeader: string | undefined, fallback: Locale): Locale {
  const match = cookieHeader?.match(/(?:^|;\s*)shifu_lang=(\w+)/);
  return match && isLocale(match[1]) ? match[1] : fallback;
}

/** Styled server rendered error page that matches the dashboard design. */
export function renderErrorPage(options: { status: number; title: string; message: string; locale: Locale }): string {
  const home = coreMessages[options.locale].errors.goHome;
  return `<!doctype html>
<html lang="${options.locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${options.status} · ShifuBot</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: ${gradients.aurora}, ${colors.background};
    color: ${colors.text}; font-family: ${fonts.sans.join(', ')};
  }
  main {
    width: 100%; max-width: 440px; padding: 40px 32px; text-align: center;
    background: ${withAlpha(colors.surface, 0.72)}; border: 1px solid ${withAlpha(colors.border, 0.9)};
    border-radius: ${radii.xl}; box-shadow: ${shadows.glow}; backdrop-filter: blur(16px);
  }
  .code {
    font-family: ${fonts.mono.join(', ')}; font-size: 56px; font-weight: 700; line-height: 1;
    background: ${gradients.brand}; -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  h1 { font-size: 20px; margin: 16px 0 8px; }
  p { color: ${colors.muted}; margin: 0 0 28px; line-height: 1.6; }
  a {
    display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 22px;
    border-radius: ${radii.full}; background: ${gradients.brand}; color: ${colors.background};
    font-weight: 600; text-decoration: none; box-shadow: ${shadows.glow};
  }
  a:focus-visible { outline: 2px solid ${colors.aqua}; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="code">${options.status}</div>
  <h1>${escapeHtml(options.title)}</h1>
  <p>${escapeHtml(options.message)}</p>
  <a href="/">${escapeHtml(home)}</a>
</main>
</body>
</html>`;
}
