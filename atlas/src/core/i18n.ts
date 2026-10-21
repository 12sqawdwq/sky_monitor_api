export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'sky-atlas.lang';

/** `?lang=` wins (shareable links), then the stored choice; English by default. */
function detect(): Lang {
  try {
    const param = new URLSearchParams(location.search).get('lang');
    if (param === 'en' || param === 'zh') return param;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    // Storage unavailable: use the default.
  }
  return 'en';
}

export const lang: Lang = detect();
export const isEn = lang === 'en';

/** Pick the string for the current language. The language is fixed per page load. */
export function t(zh: string, en: string): string {
  return isEn ? en : zh;
}

export interface Named {
  zh: string;
  en?: string;
  /** English title when `en` is a composite subtitle (e.g. stars). */
  nameEn?: string;
  /** English-mode subtitle; defaults to the Chinese name. */
  subEn?: string;
}

/** Primary display name in the current language. */
export function nameOf(item: Named): string {
  return isEn ? item.nameEn || item.en || item.zh : item.zh;
}

/** Secondary line under the name: the other language, when it adds anything. */
export function subtitleOf(item: Named): string {
  if (!isEn) return item.en && item.en !== item.zh ? item.en : '';
  const sub = item.subEn ?? item.zh;
  return sub && sub !== nameOf(item) ? sub : '';
}

/** Switch language: remember it and reload the current route without `?lang=`. */
export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Fall through: the query parameter still carries the choice.
  }
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  location.replace(url.toString());
}

/** Static markup is authored in English; `data-zh*` attributes carry the Chinese. */
export function applyStaticTranslations(root: ParentNode = document): void {
  document.documentElement.lang = isEn ? 'en' : 'zh-CN';
  if (isEn) return;
  root.querySelectorAll<HTMLElement>('[data-zh]').forEach(node => {
    node.textContent = node.dataset.zh!;
  });
  root.querySelectorAll<HTMLElement>('[data-zh-html]').forEach(node => {
    node.innerHTML = node.dataset.zhHtml!;
  });
  root.querySelectorAll<HTMLElement>('[data-zh-placeholder]').forEach(node => {
    node.setAttribute('placeholder', node.dataset.zhPlaceholder!);
  });
  root.querySelectorAll<HTMLElement>('[data-zh-label]').forEach(node => {
    node.setAttribute('aria-label', node.dataset.zhLabel!);
  });
  const title = document.querySelector<HTMLMetaElement>('meta[name="zh-title"]');
  if (title) document.title = title.content;
}
