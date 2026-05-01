# Pinly — 街の"今"が刺さる地図

> 世界中の街角に、誰でも匿名で短い"ピン"を刺せるリアルタイム地図SNS。

地図を開けば、そこに今いる人/過去にいた人が刺した一言ピンが浮かぶ。
登録不要・完全匿名・50字制限。LINEの位置情報感覚で、Twitterの匿名性、
Googleマップの永続性。

## Live

- **App**: https://guttyanneruuuuuu.github.io/service6/

## Features

- **MapLibre GL** ダークテーマ地図（CARTOの無料公開タイル使用）
- **ピン投稿**: 地図をタップ → 50字つぶやき → 公開（匿名）
- **カテゴリ**: グルメ / 穴場 / 注意 / 生活 / おもしろ / その他
- **トレンドパネル**: ホット・新着・スポットランキング
- **リアクション**: 🔥 💯 😂 ✨ 🤔 ⚠️
- **クラスタリング**: ズームレベルに応じて自動集約
- **検索**: Nominatim（無料）でジオコーディング
- **現在地**: ブラウザの位置情報API
- **シェアURL**: `?pin=xxx` でピン直リンク
- **PWA対応**: マニフェスト & スマホでホーム画面追加可能
- **完全静的**: GitHub Pagesで無料ホスティング、APIコストゼロ

## Stack

- Vite + vanilla ES modules
- MapLibre GL JS（OSS、Mapboxトークン不要）
- localStorage + BroadcastChannel（クロスタブ同期）
- 初期 seed: `public/pins.json`

## Local dev

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run preview
```

## Roadmap

- [ ] Supabaseでグローバル同期（オプショナル）
- [ ] 公式ピン購入（Stripe）
- [ ] 通知（Web Push）
- [ ] 都道府県ランキング・日次ダイジェスト
- [ ] 広告ピン枠（距離指定型ジオ広告）

## License

MIT
