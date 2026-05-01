# Google Analytics（GA4）設定ガイド

**重要度**: ⭐⭐⭐ **推奨**  
**所要時間**: 約5分  
**難易度**: 初心者向け

---

## このガイドについて

Pinlyのアクセス数、ユーザー行動、地理的分布などを確認するために、Google Analytics（GA4）を設定します。

**完全無料で使用でき、月間1000万ヒットまでは無制限に分析できます。**

---

## ステップ1: Google Analyticsにログイン

1. 以下のURLにアクセス：
   ```
   https://analytics.google.com
   ```

2. Googleアカウントでログイン（ない場合は作成）

---

## ステップ2: 新しいプロパティを作成

1. 左下の **「管理」** をクリック
2. **「プロパティ」** セクションで **「プロパティを作成」** をクリック
3. 以下の情報を入力：
   - **プロパティ名**: `Pinly`
   - **レポートのタイムゾーン**: `日本`
   - **通貨**: `日本円（JPY）`

4. **「作成」** をクリック

---

## ステップ3: ウェブストリームを作成

1. **「ウェブストリームを作成」** をクリック
2. 以下の情報を入力：
   - **ウェブサイトのURL**: `https://guttyanneruuuuuu.github.io/service6/`
   - **ストリーム名**: `Pinly Web`

3. **「ストリームを作成」** をクリック

---

## ステップ4: Measurement IDを確認

1. ウェブストリームが作成されたら、**「タグの実装手順」** をクリック
2. 画面に表示される **「Measurement ID」** をコピー
   - 形式: `G-XXXXXXXXXX` のような英数字

---

## ステップ5: Pinlyにタグを設定

1. テキストエディタで `index.html` を開く
2. 以下の部分を探す：
   ```html
   <!-- Google Analytics (GA4) -->
   <!-- ⚠️ TODO: 以下のGA_MEASUREMENT_IDを、ご自身のGoogle Analyticsを設定した際のMeasurement IDに置き換えてください -->
   <script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
   <script>
     window.dataLayer = window.dataLayer || [];
     function gtag(){dataLayer.push(arguments);}
     gtag('js', new Date());
     gtag('config', 'GA_MEASUREMENT_ID');
   </script>
   ```

3. **2つの `GA_MEASUREMENT_ID`** を、ステップ4でコピーした Measurement ID に置き換える
   - 例: `GA_MEASUREMENT_ID` → `G-1234567890`

4. ファイルを保存

---

## ステップ6: 変更をデプロイ

1. ターミナルで以下を実行：
   ```bash
   cd /home/ubuntu/service6
   git add index.html
   git commit -m "feat: add Google Analytics tracking"
   git push origin main
   ```

2. GitHub Pages が自動的に更新されます（約1～2分）

---

## ステップ7: 動作確認

1. Pinlyを開く（ブラウザをリロード）
2. Google Analytics のダッシュボードに戻る
3. **「リアルタイム」** をクリック
4. 自分がアクセスしたことが表示されるか確認

---

## Google Analyticsで確認できる主な指標

### 1. ユーザー数
- **アクティブユーザー**: 過去30日間にアクセスしたユーザー数
- **新規ユーザー**: 初めてアクセスしたユーザー数

### 2. セッション
- **セッション数**: ユーザーがサイトを訪問した回数
- **平均セッション時間**: ユーザーが平均何分滞在したか

### 3. 地理的分布
- **国別**: どの国からアクセスが多いか
- **都市別**: 日本国内ではどの都市からアクセスが多いか

### 4. ページ分析
- **ページビュー**: 各ページが何回見られたか
- **離脱率**: ユーザーがどのページで離脱したか

### 5. ユーザー行動
- **イベント**: ユーザーがどのボタンをクリックしたか
- **コンバージョン**: 目標達成数（例：投稿数）

---

## よくある質問

### Q: Google Analyticsは本当に無料？

**A**: はい、完全に無料です。月間1000万ヒットまでは無制限に分析できます。Pinlyの規模であれば、数年間は無料プランで十分です。

### Q: プライバシーは大丈夫？

**A**: Google Analyticsは個人を特定しない匿名データのみを収集します。Pinlyの利用規約に「アクセス解析を行う」と明記すれば、法的な問題はありません。

### Q: 設定後、どのくらいでデータが表示される？

**A**: 設定から約24時間後に、レポートにデータが表示されます。リアルタイムレポートには数秒で反映されます。

### Q: 設定を間違えた場合は？

**A**: Google Analytics のダッシュボードから、プロパティやストリームを削除して、もう一度作成し直せます。

---

## 参考資料

- [Google Analytics 公式ドキュメント](https://support.google.com/analytics)
- [GA4 設定ガイド](https://support.google.com/analytics/answer/9304153)

---

**作成者**: Manus AI  
**最終更新**: 2026年5月1日
