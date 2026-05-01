# Pinly

> **街の"今"が、刺さる地図。**
> 世界中の街角に、誰でも匿名で50字のひとことを刺せる、リアルタイム地図SNS。

## Live

- **App**: https://guttyanneruuuuuu.github.io/service6/

## なに？

地図を開くと、そこに今いる人 / 過去にいた人が刺した一言ピンが浮かびます。

- 渋谷のスクランブル交差点 →「右の信号、青が異常に短い」
- 新宿のとあるカフェ →「Wi-Fiパス: cafe2024。穴場」
- 京都の路地 →「ここの猫、3時頃に必ず現れる」

LINEの位置情報感覚で、Twitterの匿名性、Googleマップの永続性。

## 設計

- **フレームワーク**: Vite + vanilla ES modules（フレームワークオーバーヘッド0）
- **地図**: MapLibre GL JS + CARTO dark タイル（無料・APIキー不要）
- **データ**: localStorage + BroadcastChannel（同一ブラウザの複数タブ間でリアルタイム同期）+ `pins.json` シードピン
- **ジオコーディング**: OpenStreetMap Nominatim（無料）
- **API代金**: 永久に¥0
- **完全静的**: GitHub Pages / Cloudflare Pages / どこでもデプロイ可

## カテゴリ

| | カテゴリ | 用途 |
|---|---|---|
| 🍜 | グルメ | 美味い・並ぶ・営業情報 |
| ✨ | 穴場 | 知る人ぞ知るスポット |
| ⚠️ | 注意 | 風が強い・人が多い・気をつけて |
| 🛋️ | 生活 | 通勤・住みやすさ・ライフハック |
| 😂 | おもしろ | この街の謎・あるある |
| 💬 | その他 | 全部 |

## マネタイズ

1. **公式ピン** ¥980/月: 店舗オーナー向け、認証バッジ + 通知 + 統計
2. **広告ピン**: 半径指定型ジオ広告（GoogleAdsより安い）
3. **位置情報API**: 商業・不動産・観光業向け（B2B）
4. **プレミアム**: ¥480/月、履歴・通知範囲拡張・フィルタ強化
5. **エグジット先**: メルカリ / LINE / Yahoo / 不動産テック大手

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → ./dist
npm run preview
```

## License

MIT
