/**
 * MapLibre style definition.
 *
 * Uses CARTO's free "dark-matter" raster tile service (no API key needed,
 * generous public CDN, OSM-derived). This gives us a beautiful dark map
 * that matches the Pinly visual identity.
 *
 * If CARTO is rate-limited at any point we fall back to OSM tiles (also
 * free) at the cost of a brighter background.
 */

export const DARK_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0d14' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-fade-duration': 200 } },
  ],
};
