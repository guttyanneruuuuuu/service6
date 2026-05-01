# Pinly — 街の"今"が刺さる地図

> 世界中の街角に、誰でも匿名で短い"ピン"を刺せるリアルタイム地図SNS。

地図を開けば、そこに今いる人/過去にいた人が刺した一言ピンが浮かぶ。
登録不要・完全匿名・50字制限。LINEの位置情報感覚で、Twitterの匿名性、
Googleマップの永続性。

## 🚀 Live

- **App**: https://guttyanneruuuuuu.github.io/service6/

## ✨ Features

### Core Features
- **MapLibre GL** ダークテーマ地図（CARTOの無料公開タイル使用）
- **ピン投稿**: 地図をタップ → 50字つぶやき → 公開（匿名）
- **カテゴリ**: グルメ 🍜 / 穴場 ✨ / 注意 ⚠️ / 生活 🛋️ / おもしろ 😂 / その他 💬
- **リアルタイム性**: 投稿時間の相対表示、新鮮度の視覚的強調
- **クラスタリング**: ズームレベルに応じて自動集約
- **検索**: テキスト検索でピンを発見
- **現在地**: ブラウザの位置情報API対応

### Social & Engagement
- **🔥 トレンドパネル**: ホットなピンをランキング表示
- **🏆 ユーザーランキング**: 投稿数・リアクション数でユーザーをランク表示
- **バッジシステム**: 🥇 🥈 🥉 ⭐ 🔥 などのバッジを自動付与
- **SNSシェア**: 𝕏 / Instagram / LINE で簡単シェア
- **シェアURL**: `?pin=xxx` でピン直リンク

### User Experience
- **PWA対応**: マニフェスト & スマホでホーム画面追加可能
- **クロスタブ同期**: BroadcastChannel で複数タブ間のリアルタイム同期
- **完全静的**: GitHub Pagesで無料ホスティング、APIコストゼロ
- **レスポンシブ**: モバイル・タブレット・デスクトップ対応

## 🎯 Concept

Pinlyは「街の"今"」に特化した情報共有プラットフォームです。

- **Google Maps** のような網羅的な「正解」ではなく、**地域住民ならではの「生の声」と「発見」** を共有
- **Twitter** の匿名性と **Zenly** のようなリアルタイム感を融合
- **バイラル性** を重視し、SNS拡散を通じた有機的な成長を目指す

## 📊 Competitive Advantages

| 特徴 | Pinly | Google Maps | まちビュー | Auglinn |
|------|-------|-------------|----------|---------|
| リアルタイム性 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 匿名性 | ⭐⭐⭐⭐⭐ | ✗ | ⭐⭐ | ⭐⭐⭐ |
| 投稿の手軽さ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| SNS連携 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| ゲーミフィケーション | ⭐⭐⭐⭐ | ✗ | ⭐⭐ | ⭐⭐ |

## 🛠️ Stack

- **Frontend**: Vite + vanilla ES modules
- **Map**: MapLibre GL JS（OSS、Mapboxトークン不要）
- **Storage**: localStorage + BroadcastChannel（クロスタブ同期）
- **Seed Data**: `public/pins.json`
- **Hosting**: GitHub Pages（無料・無制限）

## 🚀 Local Development

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # Production build
npm run preview      # Preview production build
```

## 📋 Roadmap

### Phase 1: Viral Growth 🚀
- [x] SNS シェア機能（𝕏 / Instagram / LINE）
- [x] ユーザーランキング表示
- [x] バッジシステム
- [x] リアルタイム性の強調
- [ ] インフルエンサー連携プログラム

### Phase 2: Data Diversification 📊
- [ ] SNS（X/Instagram）からの自動情報取得
- [ ] 公的データ（イベント情報、統計）の統合
- [ ] リアルタイムセンサーデータ（混雑度、気象）

### Phase 3: Monetization 💰
- [ ] フリーミアムモデル（有料プラン）
- [ ] 公式ピン購入（Stripe）
- [ ] 地域ビジネス向けプロモーション枠
- [ ] データ分析レポート提供

### Phase 4: Scale 🌍
- [ ] Supabaseでグローバル同期
- [ ] 通知（Web Push）
- [ ] 都道府県ランキング・日次ダイジェスト
- [ ] 広告ピン枠（距離指定型ジオ広告）

## 💡 Design Philosophy

Pinlyのデザインは以下の原則に基づいています：

1. **シンプル性**: 登録不要、50字制限で気軽な投稿を実現
2. **リアルタイム性**: 投稿時間の相対表示で「今」を強調
3. **バイラル性**: SNS連携とゲーミフィケーションで拡散を促進
4. **没入感**: 地図操作を通じた直感的な地域発見体験

## 📈 Growth Strategy

- **SNS バイラル**: 𝕏・Instagram での自然な拡散
- **Product-Led Growth**: 無料で完全な機能を提供し、口コミで成長
- **コミュニティ形成**: ランキング・バッジで継続利用を促進
- **地域連携**: 各地域のインフルエンサーとの協力

## 🔐 Privacy & Security

- **完全匿名**: ユーザー登録不要、デバイスIDのみで識別
- **ローカル優先**: 全データはブラウザのlocalStorageに保存
- **オプショナルクラウド**: Supabase連携は将来のオプション

## 📄 License

MIT

---

**Made with ❤️ by Pinly Team**

Pinlyは「どこでもドア」のような空間移動技術を目指す壮大なビジョンの第一歩です。
