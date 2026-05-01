# Realtime 同期トラブルシューティング

「スマホと同期されていない」という問題が発生している場合の解決手順です。

## 問題の症状

*   デバイス A で投稿したピンが、デバイス B に**ページをリロードするまで表示されない**
*   複数デバイスで同時に使用しても、変更がリアルタイムで反映されない

## 原因

Supabase の RLS（Row Level Security）が有効な場合、Realtime 機能が権限を確認するため、匿名ユーザーが変更通知を受け取れないことがあります。

## 解決手順

### ステップ 1: Supabase ダッシュボードで SQL を実行

1.  [Supabase ダッシュボード](https://app.supabase.com/)を開きます。
2.  プロジェクト「service6」を選択します。
3.  左メニューの「**SQL Editor**」をクリックします。
4.  「**+ New Query**」をクリックして新しいエディタを開きます。
5.  以下の SQL をすべてコピーして貼り付けます：

```sql
-- Realtime 権限設定の修正
GRANT SELECT ON public.pins TO anon;

CREATE POLICY "Allow realtime for anon" ON public.pins
  FOR SELECT
  TO anon
  USING (true);
```

6.  「**▶ Run**」ボタンをクリックして実行します。
7.  「**Success**」と表示されれば完了です。

### ステップ 2: Replication 設定を再確認

1.  左メニューの「**Database**」→「**Replication**」をクリックします。
2.  「**supabase_realtime**」Publication を確認します。
3.  その下の「**Tables**」セクションで、**「pins」にチェックが入っている**ことを確認します。
4.  チェックボックスの右側の「INSERT」「UPDATE」「DELETE」**すべてにチェックが入っている**ことを確認します。

### ステップ 3: ブラウザをリセット

1.  **スマホ・PC の両方で、Pinly のブラウザウィンドウを完全に閉じます**。
2.  ブラウザのキャッシュをクリアします：
    *   **iPhone**: 設定 → Safari → 履歴とウェブサイトデータを削除
    *   **Android**: Chrome → 設定 → プライバシー → キャッシュを削除
    *   **PC**: Ctrl+Shift+Delete（Windows）または Cmd+Shift+Delete（Mac）
3.  Pinly を再度開きます。

### ステップ 4: 動作確認

1.  **デバイス A**（スマホ等）で Pinly を開きます。
2.  **デバイス B**（別のスマホ、PC等）でも Pinly を開きます。
3.  デバイス A で新しいピンを投稿します。
4.  **デバイス B で、ページをリロードせずに、そのピンが地図上に表示されるか確認**します。
    *   表示されれば、Realtime が正常に動作しています！

## コンソールでの確認（上級者向け）

ブラウザのコンソール（F12 キー → Console タブ）を開くと、以下のようなログが表示されます：

```
[Pinly] Realtime subscribed successfully
[Pinly] Realtime subscription status: SUBSCRIBED
```

これが表示されれば、Realtime の購読が成功しています。

もし以下のようなエラーが表示される場合は、上記のステップを再度確認してください：

```
[Pinly] Realtime subscription error: ...
```

## それでも解決しない場合

以下の点を確認してください：

1.  **Supabase の接続設定が正しいか**: ダッシュボードで Project URL と Anon Key が正しいか確認
2.  **ネットワーク接続**: スマホが WiFi または 4G で安定して接続されているか確認
3.  **ブラウザの互換性**: Chrome、Safari、Firefox など、最新バージョンを使用しているか確認

それでも解決しない場合は、GitHub Issues で報告してください。
