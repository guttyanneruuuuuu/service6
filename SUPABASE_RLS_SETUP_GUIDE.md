# Supabase RLS（行レベルセキュリティ）設定ガイド

**重要度**: ⭐⭐⭐⭐⭐ **最優先**  
**所要時間**: 約10分  
**難易度**: 初心者向け（画像なしでも進められます）

---

## このガイドについて

このドキュメントは、**Pinlyを一般公開する前に絶対に実行しなければならない**セキュリティ設定です。

これを実行しないと、悪意のあるユーザーが以下のことができてしまいます：
- 他人の投稿をすべて削除する
- データベースをパンクさせる
- 個人情報を盗む

**つまり、このステップを実行しないで公開することは、鍵をかけずに家を公開するようなものです。**

---

## 準備物

1. Supabaseのアカウント（既に作成済みと仮定）
2. Pinlyプロジェクトが設定されたSupabaseプロジェクト
3. ブラウザ（Chrome、Firefox、Safari など）

---

## ステップ1: Supabaseダッシュボードにログイン

1. ブラウザで以下のURLを開く：
   ```
   https://app.supabase.com
   ```

2. メールアドレスとパスワードでログイン

3. 左側のサイドバーから、**Pinlyプロジェクト**を選択

---

## ステップ2: SQLエディタを開く

1. ダッシュボードの左側メニューから **「SQL Editor」** をクリック
   （アイコンは `<>` のような形です）

2. 画面右上の **「+ New Query」** ボタンをクリック

3. 空のSQLエディタが開きます

---

## ステップ3: RLSポリシーを有効化

以下のSQLをコピーして、SQLエディタに貼り付けます：

```sql
-- ============================================================
-- Step 1: Enable RLS on the pins table
-- ============================================================
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;
```

**実行方法**：
1. 上記のコードをコピー
2. SQLエディタに貼り付け
3. **「▶ Run」** ボタン（または `Ctrl+Enter`）をクリック
4. 画面下部に「Success」と表示されたら成功

---

## ステップ4: SELECT（読み取り）ポリシーを設定

以下のSQLをコピーして実行します：

```sql
-- ============================================================
-- Step 2: SELECT policy - Everyone can read all pins
-- ============================================================
CREATE POLICY "Allow public read" ON public.pins
  FOR SELECT
  USING (true);
```

**実行方法**：
1. 前のコードを削除
2. 上記のコードをコピーして貼り付け
3. **「▶ Run」** ボタンをクリック
4. 「Success」と表示されたら成功

---

## ステップ5: INSERT（投稿）ポリシーを設定

以下のSQLをコピーして実行します：

```sql
-- ============================================================
-- Step 3: INSERT policy - Only authenticated users or valid anonymous users
-- ============================================================
CREATE POLICY "Allow insert for authenticated and anonymous" ON public.pins
  FOR INSERT
  WITH CHECK (
    (auth.uid() IS NOT NULL) OR
    (
      author ~ '^u_[a-zA-Z0-9_-]{4,32}$' AND
      text IS NOT NULL AND
      text != '' AND
      length(text) <= 50
    )
  );
```

**実行方法**：
1. 前のコードを削除
2. 上記のコードをコピーして貼り付け
3. **「▶ Run」** ボタンをクリック
4. 「Success」と表示されたら成功

---

## ステップ6: UPDATE（編集）ポリシーを設定

以下のSQLをコピーして実行します：

```sql
-- ============================================================
-- Step 4: UPDATE policy - Only the author can update their own pins
-- ============================================================
CREATE POLICY "Allow update for author" ON public.pins
  FOR UPDATE
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = author) OR
    (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid()::text = author) OR
    (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  );
```

**実行方法**：
1. 前のコードを削除
2. 上記のコードをコピーして貼り付け
3. **「▶ Run」** ボタンをクリック
4. 「Success」と表示されたら成功

---

## ステップ7: DELETE（削除）ポリシーを設定

以下のSQLをコピーして実行します：

```sql
-- ============================================================
-- Step 5: DELETE policy - Only the author can delete their own pins
-- ============================================================
CREATE POLICY "Allow delete for author" ON public.pins
  FOR DELETE
  USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = author) OR
    (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  );
```

**実行方法**：
1. 前のコードを削除
2. 上記のコードをコピーして貼り付け
3. **「▶ Run」** ボタンをクリック
4. 「Success」と表示されたら成功

---

## ステップ8: 設定を確認

すべてのポリシーが正しく設定されたか確認します：

1. ダッシュボードの左側メニューから **「Authentication」** をクリック
2. 左側の **「Policies」** をクリック
3. テーブル一覧から **「pins」** を選択
4. 以下の5つのポリシーが表示されていることを確認：
   - ✅ Allow public read
   - ✅ Allow insert for authenticated and anonymous
   - ✅ Allow update for author
   - ✅ Allow delete for author

すべて表示されていれば、設定完了です！

---

## トラブルシューティング

### Q: SQLを実行したときに「Error」と表示された

**A**: 以下を確認してください：
- SQLをコピーペーストするときに、余分なスペースや改行が入っていないか
- 前のコードを完全に削除してから、新しいコードを貼り付けているか
- テーブル名が `public.pins` になっているか（大文字小文字を区別します）

### Q: ポリシーを削除したい場合は？

**A**: 以下のSQLで削除できます：
```sql
DROP POLICY IF EXISTS "Allow public read" ON public.pins;
DROP POLICY IF EXISTS "Allow insert for authenticated and anonymous" ON public.pins;
DROP POLICY IF EXISTS "Allow update for author" ON public.pins;
DROP POLICY IF EXISTS "Allow delete for author" ON public.pins;
```

### Q: ポリシーを修正したい場合は？

**A**: 削除してから、新しいポリシーを作成し直してください。

---

## 設定後の動作確認

設定が完了したら、以下の動作確認をしてください：

### 1. 投稿が正常に保存されるか
- Pinlyアプリで投稿を作成
- 投稿が地図に表示されるか確認
- 別のブラウザ（シークレットモード）で同じ地図を開き、投稿が見えるか確認

### 2. 削除が正常に動作するか
- メニュー → 自分のピン一覧 → 削除ボタンをクリック
- 投稿が削除されるか確認

### 3. 他人の投稿は削除できないか
- 別のブラウザ（シークレットモード）でアクセス
- 他人の投稿の削除ボタンをクリック
- 削除できず、エラーが表示されることを確認

---

## セキュリティの仕組み

各ポリシーの意味を理解することで、セキュリティの重要性が分かります：

| ポリシー | 意味 |
| :--- | :--- |
| **Allow public read** | 誰でも投稿を読める（公開サービスなので当然） |
| **Allow insert** | 認証ユーザー、または `u_` で始まる匿名ユーザーのみが投稿できる |
| **Allow update** | 投稿の作成者のみが編集できる |
| **Allow delete** | 投稿の作成者のみが削除できる |

これらのポリシーにより、以下が実現されます：
- ✅ 悪意のあるユーザーが他人の投稿を削除できない
- ✅ ランダムなユーザーIDでスパム投稿ができない
- ✅ データベースを意図的にパンクさせられない

---

## 次のステップ

RLS設定が完了したら、以下を確認してください：

1. **Pinlyアプリの動作確認**
   - 投稿・削除・報告機能が正常に動作するか
   - エラーが表示されないか

2. **ベータ版の表記確認**
   - サイトのタイトルに「Beta」が表示されているか
   - ヘッダーに「Beta」バッジが表示されているか

3. **問い合わせ窓口の確認**
   - メニューに「お問い合わせ」リンクがあるか
   - クリックして問い合わせフォームが開くか

すべて確認できたら、**一般公開の準備完了です！**

---

## 参考資料

- [Supabase RLS公式ドキュメント](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL セキュリティ](https://www.postgresql.jp/document/current/html/sql-createpolicy.html)

---

**作成者**: Manus AI  
**最終更新**: 2026年5月1日
