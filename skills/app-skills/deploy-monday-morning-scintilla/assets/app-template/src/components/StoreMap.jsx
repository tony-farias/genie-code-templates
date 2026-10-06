// Leaflet-based geographic map showing stores as circle markers sized by sales.

import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip, Popup } from 'react-leaflet';

const fmt$ = (n) => {
  if (n == null) return '$0';
  n = Number(n);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

export default function StoreMap({ stores = [], national = false }) {
  const points = useMemo(
    () => stores.filter((s) => s.latitude != null && s.longitude != null),
    [stores]
  );
  const maxSales = useMemo(
    () => Math.max(1, ...points.map((s) => Number(s.sales || 0))),
    [points]
  );

  const center = useMemo(() => {
    if (national) return [39.5, -98.35]; // continental US
    if (points.length === 0) return [40.95, -73.8];
    const lat = points.reduce((s, p) => s + Number(p.latitude), 0) / points.length;
    const lng = points.reduce((s, p) => s + Number(p.longitude), 0) / points.length;
    return [lat, lng];
  }, [points, national]);

  if (points.length === 0) {
    return <div className="text-sm text-muted-foreground py-12 text-center">No store locations to render.</div>;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border" style={{ height: national ? 420 : 300 }}>
      <MapContainer center={center} zoom={national ? 4 : 9} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((s) => {
          const sales = Number(s.sales || 0);
          // sqrt scaling keeps small stores visible without giant blobs; tight range 3–13px
          const radius = 3 + Math.sqrt(sales / maxSales) * 10;
          const inStock = Number(s.in_stock_pct || 0);
          const fillColor = inStock < 80 ? '#FF3621' : inStock < 90 ? '#FBB300' : '#00A972';
          return (
            <CircleMarker
              key={s.store_id}
              center={[Number(s.latitude), Number(s.longitude)]}
              radius={radius}
              pathOptions={{ color: fillColor, fillColor, fillOpacity: 0.4, weight: 1, opacity: 0.7 }}
            >
              <LeafletTooltip direction="top" offset={[0, -radius]}>
                <div className="text-xs">
                  <div className="font-semibold">Store #{s.store_id}</div>
                  <div>{s.store_name}</div>
                  <div className="text-muted-foreground">{s.city}, {s.state} · {fmt$(sales)}</div>
                </div>
              </LeafletTooltip>
              <Popup>
                <div className="text-xs space-y-0.5 min-w-[180px]">
                  <div className="font-bold text-sm">Store #{s.store_id}</div>
                  <div className="font-semibold">{s.store_name}</div>
                  <div className="text-muted-foreground">{s.city}, {s.state}{s.market ? ` · ${s.market}` : ''}</div>
                  <div className="pt-1.5 border-t border-border mt-1.5 space-y-0.5">
                    <div>Sales: <span className="font-semibold tabular-nums">{fmt$(sales)}</span></div>
                    <div>Units: <span className="font-semibold tabular-nums">{Number(s.units || 0).toLocaleString()}</span></div>
                    {s.in_stock_pct != null && <div>In-stock: <span className={inStock < 90 ? 'text-red-600 font-semibold' : 'font-semibold'}>{s.in_stock_pct}%</span></div>}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
