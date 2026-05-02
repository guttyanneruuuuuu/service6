-- ============================================================
-- Pinly: Supabase RLS fix for cross-device realtime sync
-- ============================================================
--
-- 症状: 別デバイスでピンが反映されない / 自分のピンが他端末に出ない。
-- 原因:
--   1) `pins` テーブルの RLS で anon の INSERT/UPDATE/DELETE が拒否されている
--      （HTTP 401 / code 42501 "row-level security policy" を返す）。
--   2) Realtime publication に `pins` テーブルが入っていない可能性。
--
-- このSQLをそのまま Supabase の SQL editor で実行すれば、
-- 公開アプリ（anon キーでアクセス）でも書き込みと realtime 配信が成立します。
-- 個人情報・サインインは扱わないので RLS は最小限のみ。
-- 本格運用する場合はレート制限テーブル等を別途用意してください。
-- ============================================================

-- 念のため RLS は有効に保つ（既に有効ならそのまま）
alter table public.pins enable row level security;

-- 既存の競合ポリシーを掃除（無ければスキップされる）
drop policy if exists "anon read pins"          on public.pins;
drop policy if exists "anon insert pins"        on public.pins;
drop policy if exists "anon update pins"        on public.pins;
drop policy if exists "anon delete pins"        on public.pins;
drop policy if exists "Allow public read"       on public.pins;
drop policy if exists "Allow public insert"     on public.pins;
drop policy if exists "Allow public update"     on public.pins;
drop policy if exists "Allow public delete"     on public.pins;

-- 読み取り: 全員OK
create policy "anon read pins"
  on public.pins
  for select
  to anon, authenticated
  using (true);

-- 追加: 全員OK（匿名サービスなので）
create policy "anon insert pins"
  on public.pins
  for insert
  to anon, authenticated
  with check (true);

-- 更新: 反応や通報の更新を許可
-- 厳格にしたい場合は `using (auth.uid() is null or author = auth.uid()::text)` 等に変更可
create policy "anon update pins"
  on public.pins
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- 削除: 自分のピンのみ削除させたい場合は、author をチェックするように変更してください。
-- ここでは検証用に anon で削除可。
create policy "anon delete pins"
  on public.pins
  for delete
  to anon, authenticated
  using (true);

-- ============================================================
-- Realtime publication: `pins` テーブルを supabase_realtime publication に追加
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pins'
  ) then
    execute 'alter publication supabase_realtime add table public.pins';
  end if;
end$$;

-- 反映確認
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
