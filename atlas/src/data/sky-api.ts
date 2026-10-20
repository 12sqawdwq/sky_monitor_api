import type { Observer } from '../core/coords';

// Production is served from the backend's own origin (empty base); dev goes
// through the Vite proxy.
const BASE = ((import.meta.env.VITE_SKY_API_BASE as string | undefined) ?? '/sky-api').replace(/\/$/, '');
const TIMEOUT_MS = 8000;

export interface SkyChartObject {
  key: string;
  zh: string;
  en: string;
  category: string;
  azimuth: number;
  altitude: number;
  magnitude: number | null;
}

export interface SkyChartResult {
  source: 'backend';
  timeUtc: string;
  objects: SkyChartObject[];
}

interface RawObject {
  id?: string;
  display_name?: string;
  name_zh?: string;
  name_en?: string;
  name?: string;
  category?: string;
  object_type?: string;
  azimuth_deg?: number;
  altitude_deg?: number;
  magnitude?: number | null;
}

function splitDisplayName(display: string): { en: string; zh: string } {
  const parts = display.split('/').map(part => part.trim());
  if (parts.length === 2) return { en: parts[0], zh: parts[1] };
  return /[一-鿿]/.test(display) ? { en: '', zh: display } : { en: display, zh: '' };
}

export async function fetchSkyChart(observer: Observer, signal?: AbortSignal, time?: Date): Promise<SkyChartResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  try {
    return await requestChart(observer, controller.signal, time);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestChart(observer: Observer, signal: AbortSignal, time?: Date): Promise<SkyChartResult> {
  const response = await fetch(`${BASE}/sky/chart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lat: observer.lat,
      lon: observer.lon,
      total_limit: 28,
      include_planets: true,
      include_deep_sky: true,
      ...(time ? { time_utc: time.toISOString().replace(/\.\d{3}Z$/, 'Z') } : {})
    }),
    signal
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const chart = json.sky_chart ?? json;
  const objects: SkyChartObject[] = (chart.objects as RawObject[] ?? []).map((raw, index) => {
    const split = splitDisplayName(raw.display_name ?? '');
    return {
      key: raw.id ?? `${index}`,
      zh: raw.name_zh || split.zh || raw.display_name || raw.name || '',
      en: raw.name_en || split.en || raw.name || '',
      category: raw.category ?? raw.object_type ?? '',
      azimuth: Number(raw.azimuth_deg),
      altitude: Number(raw.altitude_deg),
      magnitude: typeof raw.magnitude === 'number' ? raw.magnitude : null
    };
  });
  return { source: 'backend', timeUtc: chart.time_utc ?? new Date().toISOString(), objects };
}
