import { DEFAULT_LOCALE, createTranslator, isLocale, type Locale, type PlaceholderValues } from '@shifubot/shared';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { messages, type AppMessageKey } from '../../../../features';

const COOKIE = 'shifu_lang';

/** Language chosen on the login page and guild picker, kept in a cookie. */
export function readLanguageCookie(): Locale {
  const match = document.cookie.match(/(?:^|;\s*)shifu_lang=(\w+)/);
  if (match && isLocale(match[1])) return match[1];
  const browser = navigator.language.slice(0, 2);
  return isLocale(browser) ? browser : DEFAULT_LOCALE;
}

export function writeLanguageCookie(locale: Locale) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export type TFunction = (key: AppMessageKey, values?: PlaceholderValues) => string;

interface I18nValue {
  locale: Locale;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);
const CookieLocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);

/** Root provider: language from the cookie, used outside of a server. */
export function CookieLanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLanguageCookie);
  const cookieValue = useMemo(
    () => ({
      locale,
      setLocale: (next: Locale) => {
        writeLanguageCookie(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );
  return (
    <CookieLocaleContext.Provider value={cookieValue}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </CookieLocaleContext.Provider>
  );
}

/** Scoped provider, e.g. a server's own language inside its dashboard. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    document.documentElement.lang = locale;
    return { locale, t: createTranslator(messages, locale) };
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export function useT(): TFunction {
  return useI18n().t;
}

export function useCookieLocale() {
  const value = useContext(CookieLocaleContext);
  if (!value) throw new Error('useCookieLocale must be used inside CookieLanguageProvider');
  return value;
}

/** Translate an API error code with a fallback to the server's message. */
export function errorText(t: TFunction, error: unknown): string {
  const code = (error as { code?: string }).code;
  const key = `errors.${code}` as AppMessageKey;
  const text = code ? t(key) : '';
  if (text && text !== key) return text;
  return (error as Error).message || t('errors.internal');
}
