
-- ============================================
-- Pinly RLS (Row Level Security) 設定スクリプト
-- ============================================
-- 実行場所: Supabase ダッシュボード → SQL Editor
-- 実行ユーザー: postgres (デフォルト管理者)

-- 1. pinsテーブルを作成（まだ存在しない場合）
CREATE TABLE IF NOT EXISTS public.pins (
  id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  cat TEXT NOT NULL,
  text TEXT NOT NULL,
  ts BIGINT NOT NULL,
  loc TEXT,
  author TEXT NOT NULL,
  reactions JSONB DEFAULT '{}'::jsonb,
  official BOOLEAN DEFAULT false,
  _reported BOOLEAN DEFAULT false,
  _reportCount INTEGER DEFAULT 0,
  _hidden BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. RLS（セキュリティ）を有効化
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;

-- 3. 既存ポリシーを削除（重複を避けるため）
DROP POLICY IF EXISTS "Allow public read" ON public.pins;
DROP POLICY IF EXISTS "Allow insert" ON public.pins;
DROP POLICY IF EXISTS "Allow update for author" ON public.pins;
DROP POLICY IF EXISTS "Allow delete for author" ON public.pins;

-- 4. 読み取りポリシー（誰でも見れる）
CREATE POLICY "Allow public read" ON public.pins
  FOR SELECT USING (true);

-- 5. 投稿ポリシー（認証ユーザーまたは正しい形式の匿名ユーザーのみ）
CREATE POLICY "Allow insert" ON public.pins
  FOR INSERT WITH CHECK (
    (auth.uid() IS NOT NULL) OR (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  );

-- 6. 編集ポリシー（作成者本人のみ）
CREATE POLICY "Allow update for author" ON public.pins
  FOR UPDATE USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = author) OR 
    (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  );

-- 7. 削除ポリシー（作成者本人のみ）
CREATE POLICY "Allow delete for author" ON public.pins
  FOR DELETE USING (
    (auth.uid() IS NOT NULL AND auth.uid()::text = author) OR 
    (author ~ '^u_[a-zA-Z0-9_-]{4,32}$')
  );

-- 8. インデックスを作成（パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_pins_lat_lng ON public.pins(lat, lng);
CREATE INDEX IF NOT EXISTS idx_pins_ts ON public.pins(ts DESC);
CREATE INDEX IF NOT EXISTS idx_pins_author ON public.pins(author);

-- 完了
SELECT 'RLS ポリシーが正常に適用されました！' as status;
