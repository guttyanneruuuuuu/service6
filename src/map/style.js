/**
 * MapLibre raster styles for Pinly.
 *
 * Uses CARTO's free public raster tiles. Two themes:
 *   - LIGHT_STYLE: voyager (bright, friendly)
 *   - DARK_STYLE_REAL: dark-matter (kawaii dark)
 *
 * `DARK_STYLE` is exported for backward compatibility but currently equals LIGHT.
 */

const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

function rasterStyle(name, urls, bg) {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      [name]: {
        type: 'raster',
        tiles: urls,
        tileSize: 256,
        attribution: ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': bg } },
      { id: name, type: 'raster', source: name, paint: { 'raster-fade-duration': 200 } },
    ],
  };
}

export const LIGHT_STYLE = rasterStyle(
  'voyager',
  [
    'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
    'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
  ],
  '#f5f0fa'
);

export const DARK_STYLE_REAL = rasterStyle(
  'dark',
  [
    'https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
    'https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
    'https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
    'https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
  ],
  '#14161e'
);

// Backward compat
export const DARK_STYLE = LIGHT_STYLE;

export function getStyleForTheme(theme) {
  return theme === 'dark' ? DARK_STYLE_REAL : LIGHT_STYLE;
}
