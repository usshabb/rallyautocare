'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

// Leaflet tooltips and icons take HTML; names and addresses come from customers.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type MapStop = { lat: number; lng: number; label: string; tag: string; color: string };
export type MapLine = { color: string; points: { lat: number; lng: number }[] };

/** Stops on an OpenStreetMap map, numbered, with the day's driving order drawn between them. Browser only. */
export function RouteMap({ stops, lines = [], base, height = 360 }: { stops: MapStop[]; lines?: MapLine[]; base: { lat: number; lng: number }; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify({ stops, lines, base });

  useEffect(() => {
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    import('leaflet').then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      for (const line of lines) {
        L.polyline(line.points.map((p) => [p.lat, p.lng] as [number, number]), { color: line.color, weight: 3, opacity: 0.75, dashArray: '6 6' }).addTo(map);
      }
      const pin = (html: string, cls: string) => L.divIcon({ html, className: cls, iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker([base.lat, base.lng], { icon: pin('B', 'map-pin map-pin--base'), title: 'Base' }).addTo(map);
      for (const s of stops) {
        L.marker([s.lat, s.lng], { icon: pin(`<span style="background:${esc(s.color)}">${esc(s.tag)}</span>`, 'map-pin'), title: s.label })
          .bindTooltip(esc(s.label))
          .addTo(map);
      }
      const all: [number, number][] = [[base.lat, base.lng], ...stops.map((s) => [s.lat, s.lng] as [number, number])];
      if (all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [32, 32], maxZoom: 13 });
      else map.setView(all[0], 11);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the data changes
  }, [key]);

  return <div ref={el} className="route-map" style={{ height }} role="img" aria-label="Map of the jobs" />;
}
