-- ============================================================
-- Supabase Realtime 修正SQL
-- ============================================================
-- このSQLは Supabase ダッシュボードの SQL Editor で実行してください。
-- 実行することで、リアルタイム同期が有効になり、匿名ユーザーでも通知を受け取れるようになります。

-- 1. pins テーブルをリアルタイムパブリケーションに追加
-- (既に存在する場合も考慮して、一度削除してから追加)
BEGIN;
  -- パブリケーションが存在しない場合は作成
  DO $$ 
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END $$;

  -- テーブルを追加
  ALTER PUBLICATION supabase_realtime ADD TABLE pins;
COMMIT;

-- 2. 匿名ユーザー(anon)に SELECT 権限を明示的に付与
-- (RLSが有効な場合、Realtimeは権限がないと変更を通知しません)
GRANT SELECT ON public.pins TO anon;

-- 3. 匿名ユーザー向けの SELECT ポリシーを確認・追加
-- (既存の 'Allow public read' ポリシーがあるはずですが、念のため)
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

-- 4. レプリケーションの識別子をフルに設定（UPDATE/DELETEの同期を確実にするため）
ALTER TABLE public.pins REPLICA IDENTITY FULL;

-- ============================================================
-- 実行後の確認手順:
-- 1. ダッシュボードの Database -> Replication を開く
-- 2. 'supabase_realtime' パブリケーションに 'pins' が含まれていることを確認
-- 3. ブラウザをリロードして動作確認
-- ============================================================
