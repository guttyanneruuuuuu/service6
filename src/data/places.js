/**
 * Curated list of real-world locations.
 *
 * Images are served from the Unsplash CDN under the Unsplash License
 * (https://unsplash.com/license) — free for commercial use, no
 * attribution required (attribution is still provided below as good
 * practice). The `pano` and `thumb` URLs query different widths of the
 * same source photo via imgix parameters.
 *
 * Each entry:
 *  - id:       stable slug (used in URLs)
 *  - name:     display name
 *  - country:  country / region
 *  - lat/lon:  reserved for a future world-map view
 *  - tag:      mood / category
 *  - pano:     large image for the spherical backdrop
 *  - thumb:    small preview image
 *  - credit:   short attribution line
 *  - sky:      dominant accent hex for transitions & HUD tint
 */

const U = (id, w) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const PLACES = [
  {
    id: 'tokyo-shibuya',
    name: 'Shibuya Crossing',
    country: 'Tokyo · Japan',
    tag: 'city',
    lat: 35.6595, lon: 139.7005,
    pano: U('photo-1540959733332-eab4deabeeaf', 2000),
    thumb: U('photo-1540959733332-eab4deabeeaf', 800),
    credit: 'Jezael Melgoza · Unsplash',
    sky: '#7ce7ff',
  },
  {
    id: 'paris-eiffel',
    name: 'Champ de Mars',
    country: 'Paris · France',
    tag: 'classic',
    lat: 48.8584, lon: 2.2945,
    pano: U('photo-1431274172761-fca41d930114', 2000),
    thumb: U('photo-1431274172761-fca41d930114', 800),
    credit: 'Chris Karidis · Unsplash',
    sky: '#ffd27c',
  },
  {
    id: 'nyc-times',
    name: 'Times Square',
    country: 'New York · USA',
    tag: 'city',
    lat: 40.7580, lon: -73.9855,
    pano: U('photo-1496442226666-8d4d0e62e6e9', 2000),
    thumb: U('photo-1496442226666-8d4d0e62e6e9', 800),
    credit: 'Jonathan Riley · Unsplash',
    sky: '#ff8c7c',
  },
  {
    id: 'iceland-aurora',
    name: 'Aurora over Iceland',
    country: 'Reykjavik · Iceland',
    tag: 'nature',
    lat: 64.1466, lon: -21.9426,
    pano: U('photo-1607604276583-eef5d076aa5f', 2000),
    thumb: U('photo-1607604276583-eef5d076aa5f', 800),
    credit: 'Unsplash',
    sky: '#7ce7b0',
  },
  {
    id: 'desert-sahara',
    name: 'Desert Dunes',
    country: 'Merzouga · Morocco',
    tag: 'nature',
    lat: 31.0994, lon: -4.0137,
    pano: U('photo-1473580044384-7ba9967e16a0', 2000),
    thumb: U('photo-1473580044384-7ba9967e16a0', 800),
    credit: 'Sergey Pesterev · Unsplash',
    sky: '#ffb066',
  },
  {
    id: 'space-earth',
    name: 'Low Earth Orbit',
    country: 'Above · Earth',
    tag: 'beyond',
    lat: 0, lon: 0,
    pano: U('photo-1451187580459-43490279c0fa', 2000),
    thumb: U('photo-1451187580459-43490279c0fa', 800),
    credit: 'NASA · Unsplash',
    sky: '#b794ff',
    procedural: 'space',
  },
  {
    id: 'venice-grand',
    name: 'Grand Canal',
    country: 'Venice · Italy',
    tag: 'classic',
    lat: 45.4408, lon: 12.3155,
    pano: U('photo-1514890547357-a9ee288728e0', 2000),
    thumb: U('photo-1514890547357-a9ee288728e0', 800),
    credit: 'Damiano Baschiera · Unsplash',
    sky: '#ffbf7c',
  },
  {
    id: 'santorini-oia',
    name: 'Oia Sunset',
    country: 'Santorini · Greece',
    tag: 'classic',
    lat: 36.4618, lon: 25.3753,
    pano: U('photo-1570077188670-e3a8d69ac5ff', 2000),
    thumb: U('photo-1570077188670-e3a8d69ac5ff', 800),
    credit: 'Heidi Kaden · Unsplash',
    sky: '#ff9b7c',
  },
  {
    id: 'kyoto-fushimi',
    name: 'Fushimi Inari',
    country: 'Kyoto · Japan',
    tag: 'classic',
    lat: 34.9671, lon: 135.7727,
    pano: U('photo-1504457047772-27faf1c00561', 2000),
    thumb: U('photo-1504457047772-27faf1c00561', 800),
    credit: 'Unsplash',
    sky: '#ff7c8c',
  },
  {
    id: 'machu-picchu',
    name: 'Machu Picchu',
    country: 'Cusco · Peru',
    tag: 'nature',
    lat: -13.1631, lon: -72.5450,
    pano: U('photo-1587595431973-160d0d94add1', 2000),
    thumb: U('photo-1587595431973-160d0d94add1', 800),
    credit: 'Willian Justen de Vasconcellos · Unsplash',
    sky: '#9cd6a0',
  },
  {
    id: 'hongkong-skyline',
    name: 'Victoria Harbour',
    country: 'Hong Kong',
    tag: 'city',
    lat: 22.2793, lon: 114.1628,
    pano: U('photo-1506146332389-18140dc7b2fb', 2000),
    thumb: U('photo-1506146332389-18140dc7b2fb', 800),
    credit: 'Simon Zhu · Unsplash',
    sky: '#7cc4ff',
  },
  {
    id: 'antarctica',
    name: 'Antarctic Ice',
    country: 'Antarctica',
    tag: 'nature',
    lat: -77.85, lon: 166.67,
    pano: U('photo-1543922596-b3bbaba80649', 2000),
    thumb: U('photo-1543922596-b3bbaba80649', 800),
    credit: 'Paul Carroll · Unsplash',
    sky: '#cde9ff',
  },
  {
    id: 'dubai-skyline',
    name: 'Burj Khalifa',
    country: 'Dubai · UAE',
    tag: 'city',
    lat: 25.1972, lon: 55.2744,
    pano: U('photo-1512453979798-5ea266f8880c', 2000),
    thumb: U('photo-1512453979798-5ea266f8880c', 800),
    credit: 'ZQ Lee · Unsplash',
    sky: '#ffcc99',
  },
  {
    id: 'norway-fjords',
    name: 'Lofoten Fjords',
    country: 'Nordland · Norway',
    tag: 'nature',
    lat: 68.2, lon: 14.5,
    pano: U('photo-1507003211169-0a1dd7228f2d', 2000),
    thumb: U('photo-1507003211169-0a1dd7228f2d', 800),
    credit: 'Johny Goerend · Unsplash',
    sky: '#a8d4ff',
  },
];

export const PLACE_TAGS = [
  { id: 'all', label: 'All doors' },
  { id: 'city', label: 'Cities' },
  { id: 'nature', label: 'Nature' },
  { id: 'classic', label: 'Landmarks' },
  { id: 'beyond', label: 'Beyond' },
];

export function getPlace(id) {
  return PLACES.find((p) => p.id === id) || PLACES[0];
}
