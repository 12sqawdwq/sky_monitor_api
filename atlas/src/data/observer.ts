import type { Observer } from '../core/coords';
import { t } from '../core/i18n';

const STORAGE_KEY = 'sky-atlas.observer';

export const DEFAULT_OBSERVER: Observer = { lat: 31.2304, lon: 121.4737, label: 'Shanghai', source: 'default' };

/** Observer label in the current language (saved labels may predate a language switch). */
export function observerLabel(observer: Observer): string {
  if (observer.source === 'default') return t('上海', 'Shanghai');
  if (observer.source === 'geolocation') return t('我的位置', 'My location');
  return observer.label;
}

export function loadObserver(): Observer {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Observer;
      if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lon)) return parsed;
    }
  } catch {
    // Storage unavailable: fall back to the default observer.
  }
  return { ...DEFAULT_OBSERVER };
}

export function saveObserver(observer: Observer): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(observer));
  } catch {
    // Non-essential convenience; ignore.
  }
}

export function locate(): Promise<Observer> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error(t('浏览器不支持定位', 'Geolocation is not supported')));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: Math.round(position.coords.latitude * 1e4) / 1e4,
        lon: Math.round(position.coords.longitude * 1e4) / 1e4,
        label: t('我的位置', 'My location'),
        source: 'geolocation'
      }),
      error => reject(new Error(error.code === 1 ? t('定位权限被拒绝', 'Location permission denied') : t('暂时无法获取定位', 'Location unavailable'))),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });
}
