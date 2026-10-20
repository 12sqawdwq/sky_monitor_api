import type { Observer } from '../core/coords';

const STORAGE_KEY = 'sky-atlas.observer';

export const DEFAULT_OBSERVER: Observer = { lat: 31.2304, lon: 121.4737, label: '上海', source: 'default' };

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
      reject(new Error('浏览器不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        lat: Math.round(position.coords.latitude * 1e4) / 1e4,
        lon: Math.round(position.coords.longitude * 1e4) / 1e4,
        label: '我的位置',
        source: 'geolocation'
      }),
      error => reject(new Error(error.code === 1 ? '定位权限被拒绝' : '暂时无法获取定位')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });
}
