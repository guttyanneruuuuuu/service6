# Broadcast モード同期ガイド

Pinly のリアルタイム同期が改善されました。従来の「Postgres Changes」モードに加えて、「Broadcast」モードを導入し、**より確実で高速な同期**を実現しました。

## 何が変わったか

### 従来の方式（Postgres Changes）
*   データベースの変更を監視して通知
*   RLS（セキュリティ設定）の制限を受けやすい
*   スマホのブラウザでは通知が届かないことがある

### 新しい方式（Broadcast + Postgres Changes）
*   **Broadcast**: 端末間で直接メッセージを送り合う（RLSの影響を受けない）
*   **Postgres Changes**: データベース側の変更も監視（フォールバック）
*   **自動再接続**: 接続が切れたら自動的に再接続

## 動作の仕組み

1.  **投稿時**: 
    *   ローカルに保存 → Supabase に送信 → **同時に Broadcast で全端末に通知**
2.  **リアクション時**: 
    *   ローカルに反映 → Supabase に送信 → **同時に Broadcast で全端末に通知**
3.  **接続が切れた場合**: 
    *   5秒後に自動的に再接続を試行

## 使用方法

特別な設定は不要です。以前と同じように Pinly を使用してください。

## トラブルシューティング

### 「それでも同期されない」場合

1.  **ブラウザのコンソールを確認**（F12 キー → Console タブ）
    *   以下のログが表示されているか確認：
    ```
    [Pinly] Realtime subscribed successfully (Broadcast + Postgres)
    [Pinly] Realtime subscription status: SUBSCRIBED
    [Pinly] Broadcasted: INSERT ...
    ```

2.  **ネットワーク接続を確認**
    *   スマホが WiFi または 4G で安定して接続されているか確認
    *   ブラウザの「Network」タブで WebSocket 接続が確立されているか確認

3.  **ブラウザを再読み込み**
    *   Ctrl+Shift+R（Windows）または Cmd+Shift+R（Mac）で完全再読み込み

4.  **キャッシュをクリア**
    *   ブラウザのキャッシュをすべてクリアしてから再度試す

### コンソールにエラーが表示される場合

*   「Realtime subscription error」が表示される場合は、Supabase の Replication 設定を再度確認してください。
*   詳しくは `REALTIME_TROUBLESHOOT.md` を参照してください。

## 技術的な詳細

*   Broadcast チャンネル: `pins-sync`
*   イベント名: `pin_change`
*   再接続間隔: 5秒
*   イベント送信レート制限: 5 events/second（Supabase の制限）

## 今後の改善

*   UI に同期状態インジケーターを追加予定
*   手動更新ボタンの追加予定
*   オフライン対応の強化予定
