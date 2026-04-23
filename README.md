# Zeropoint

> **Step through the door.**
> A real-time, peer-to-peer teleportation network. Visit any place on Earth in a single tap — and cross paths with strangers, in real-time, in real places.

Zeropoint is a cinematic, browser-native "digital Anywhere Door". You pick a real place, the world reassembles around you in 3D, and other travellers who are there *right now* become little glowing presences walking around you. You can wave, chat, leave emotes behind.

No downloads. No accounts. No servers you have to pay for — all real-time traffic is peer-to-peer over WebRTC.

## Live

- **App**: https://guttyanneruuuuuu.github.io/service6/
- Share a direct link to any door: `?at=kyoto-fushimi`, `?at=iceland-aurora`, …

## Why

Zeropoint is the consumer-facing first step toward a long-term research agenda: *real* teleportation. The profits fund the next generation of spatial computing and physics research — the kind that, a decade from now, might turn a digital Anywhere Door into a physical one.

## Tech

- **Vite** + vanilla ES modules (no framework overhead)
- **Three.js** for the 3D panorama sphere, starfield and avatar system
- **PeerJS** (public broker, no self-hosted server) for WebRTC mesh networking
- **BroadcastChannel** for same-browser multi-tab presence (instant multi-user demo)
- **100% static** — deploys to GitHub Pages / Cloudflare Pages / anywhere
- **Zero API costs** forever: no LLM / TTS / image-gen API in the critical path

## Local dev

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # outputs ./dist
npm run preview      # serve the production build
```

## Deploy

The site is fully static. Any of these work out of the box:

- GitHub Pages (this repo's default)
- Cloudflare Pages — point at `main` branch, build command `npm run build`, output `dist`
- Vercel / Netlify

## Roadmap

- [x] Panorama sphere rendering + WASD / drag controls + mobile touch
- [x] P2P mesh (hub-election) with BroadcastChannel fallback
- [x] Chat, emotes, presence, avatars
- [x] Shareable deep-link URLs
- [x] Teleport transition sequence
- [ ] User-submitted places (Pro)
- [ ] Real 360° equirectangular capture tooling
- [ ] Spatial audio
- [ ] Ambient SFX per place
- [ ] WebXR / Vision Pro mode

## Credits

All panorama imagery in the default door list is from **Wikimedia Commons** / **NASA** under Creative Commons or Public Domain licenses. See `src/data/places.js` for per-place attribution.

## License

MIT © Zeropoint
