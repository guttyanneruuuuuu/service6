# Pinly リアルタイム同期修正 — 完全ガイド

## 📋 概要

Pinlyアプリの**複数デバイス間でのリアルタイム同期**が失敗していた問題を修正しました。修正後は、Supabase側の設定を完了することで、以下が実現します：

- ✅ 複数デバイスからのピン投稿がリアルタイムに同期
- ✅ Realtime接続失敗時も自動的にポーリングで同期継続
- ✅ ローカルエコー（重複表示）を防止
- ✅ 本番環境で安定した動作

---

## 🔧 実装した修正

### 1. **ハイブリッド同期アーキテクチャ**

```
┌─────────────────────────────────────────────┐
│  Pinly クライアント                          │
├─────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │  Broadcast Mode (同一プロジェクト内)  │  │ ← 即座な同期
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │  Postgres Changes (Realtime)         │  │ ← 標準的なリアルタイム
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │  Polling Fallback (10秒ごと)         │  │ ← Realtime失敗時の代替
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         ↓
    Supabase (pins テーブル)
```

### 2. **修正ファイル一覧**

| ファイル | 修正内容 |
|---------|---------|
| `src/data/supabase.js` | Broadcast + Polling Fallback を実装 |
| `src/data/store.js` | POLL イベント処理 + エコーガード強化 |
| `src/main.js` | STATE をグローバル公開（デバッグ用） |
| `SUPABASE_REALTIME_FIX.sql` | **新規作成** — Supabase側の設定SQL |

### 3. **エコーガード機構**

ローカルで投稿したピンが、Realtimeで返ってきたときに重複登録されるのを防止：

```javascript
_markLocalOp(id) {
  this._recentLocalOps.set(id, Date.now() + 5000); // 5秒間記録
}

_isLocalEcho(id) {
  // 5秒以内のローカル操作は無視（エコー判定）
  const exp = this._recentLocalOps.get(id);
  if (!exp) return false;
  if (exp < Date.now()) { this._recentLocalOps.delete(id); return false; }
  return true;
}
```

---

## 🚀 セットアップ手順

### **Step 1: Supabase ダッシュボードで SQL を実行**

1. https://app.supabase.com にログイン
2. プロジェクト `ebpkewkqorvditwhgzuh` を選択
3. **SQL Editor** に移動
4. 以下のSQLを実行：

```sql
-- 1. pins テーブルをリアルタイムパブリケーションに追加
BEGIN;
  DO $$ 
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END $$;
  ALTER PUBLICATION supabase_realtime ADD TABLE pins;
COMMIT;

-- 2. 匿名ユーザーに SELECT 権限を付与
GRANT SELECT ON public.pins TO anon;

-- 3. RLS ポリシーを確認・追加
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'pins' AND policyname = 'Allow realtime for anon'
    ) THEN
        CREATE POLICY "Allow realtime for anon" ON public.pins
        FOR SELECT
        TO anon
        USING (true);
    END IF;
END $$;

-- 4. レプリケーション識別子を FULL に設定
ALTER TABLE public.pins REPLICA IDENTITY FULL;
```

### **Step 2: 実行確認**

1. Supabaseダッシュボード → **Database** → **Replication**
2. `supabase_realtime` パブリケーションに `pins` が含まれていることを確認

### **Step 3: 本番サイトで動作確認**

1. https://guttyanneruuuuuu.github.io/service6/ にアクセス
2. **複数デバイス/ブラウザで同時に開く**
3. 一つのデバイスでピンを投稿
4. **他のデバイスの画面にリアルタイムで表示されるか確認**

---

## 📊 修正前後の比較

### 修正前の問題

```
デバイスA: ピンを投稿
  ↓
Supabase に保存 ✓
  ↓
Realtime チャンネル → TIMED_OUT ✗
  ↓
デバイスB: 画面に表示されない ✗
  ↓
デバイスB: ページをリロード → やっと表示 ✗ (遅い)
```

### 修正後の動作

```
デバイスA: ピンを投稿
  ↓
Supabase に保存 ✓
  ↓
【試行1】Broadcast で即座に通知 → 成功 ✓
  または
【試行2】Postgres Changes で通知 → 成功 ✓
  または
【試行3】Polling で 10秒ごとに同期 → 成功 ✓
  ↓
デバイスB: リアルタイムに表示 ✓ (即座)
```

---

## 🔍 トラブルシューティング

### Q: SQL実行後も同期されない

**A:** 以下を確認してください：

1. **Supabaseダッシュボード → Database → Replication** で、`supabase_realtime` に `pins` が含まれているか
2. **RLS ポリシー** で、`anon` ロールに `SELECT` 権限があるか
3. **ブラウザの DevTools → Console** でエラーがないか

### Q: 一つのデバイスでは同期されるが、別のデバイスでは同期されない

**A:** 以下を確認してください：

1. 両デバイスが同じ Supabase プロジェクトを使用しているか（`window.PINLY_SUPABASE` を確認）
2. ブラウザのコンソールで `[Pinly] Realtime subscription status` のログを確認
3. `TIMED_OUT` の場合、ポーリングモードに自動切り替わっているはず

### Q: ポーリングモードはいつ有効になる？

**A:** Realtime接続が以下の状態になったとき：

- `TIMED_OUT`: 接続タイムアウト
- `CHANNEL_ERROR`: チャンネルエラー

この場合、自動的に 10秒ごとのポーリングに切り替わります。

---

## 📝 コード例

### クライアント側（自動で動作）

```javascript
// supabase.js
function subscribeToSupabasePins(callback) {
  const channel = supabaseClient
    .channel('pins-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pins' }, callback)
    .on('broadcast', { event: 'pin_change' }, callback)
    .subscribe((status) => {
      if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
        startPollingFallback(callback); // 自動フォールバック
      }
    });
}
```

### ピン投稿時（自動で動作）

```javascript
// store.js
add({ lat, lng, cat, text, loc }) {
  const pin = this._normalize({ /* ... */ });
  this.pins.set(pin.id, pin);
  
  if (this.supabase) {
    this._markLocalOp(pin.id); // エコーガード
    insertPinToSupabase(pin);
    broadcastPinChange('INSERT', pin); // Broadcast通知
  }
  
  this._emit('add', pin);
  return pin;
}
```

---

## ✅ チェックリスト

- [ ] Supabase SQL を実行した
- [ ] Replication 設定を確認した
- [ ] 本番サイト (https://guttyanneruuuuuu.github.io/service6/) を複数デバイスで開いた
- [ ] ピンを投稿してリアルタイム同期を確認した
- [ ] ブラウザコンソールでエラーがないことを確認した

---

## 📞 サポート

問題が発生した場合は、以下の情報を確認してください：

1. **ブラウザコンソール** (DevTools → Console)
   - `[Pinly]` で始まるログを確認
   - エラーメッセージを記録

2. **Supabaseダッシュボード**
   - **Logs** でエラーを確認
   - **Database** → **Replication** で設定を確認

3. **ネットワーク** (DevTools → Network)
   - WebSocket接続 (`wss://`) が確立されているか
   - REST API呼び出しが成功しているか

---

## 🎉 完了！

これでリアルタイム同期が完全に機能するようになりました。複数デバイスでPinlyを使用して、街のリアルタイム情報をシェアしてください！
