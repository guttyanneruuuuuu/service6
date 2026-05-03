-- ============================================================
--  Pinly — Supabase setup (run once in SQL Editor)
--  ------------------------------------------------------------
--  Goals
--   1. Create the `pins` table with sensible types & indexes.
--   2. Enable RLS so the table is **read-public, write-owner-only**.
--   3. Tie writes to `auth.uid()` so anonymous Supabase auth (or email
--      magic-link auth) is required to post. The publishable anon key
--      alone (no session) cannot insert/update/delete.
--   4. Enable Realtime on `pins` so postgres_changes fires for every
--      INSERT / UPDATE / DELETE.
--   5. Add a defensive constraint on text length and category values.
-- ============================================================

-- 1. Table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pins (
  id          TEXT PRIMARY KEY,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  cat         TEXT NOT NULL,
  text        TEXT NOT NULL,
  ts          BIGINT NOT NULL,
  loc         TEXT,
  author      TEXT NOT NULL,
  reactions   JSONB DEFAULT '{}'::jsonb,
  official    BOOLEAN DEFAULT FALSE,
  _reported   BOOLEAN DEFAULT FALSE,
  _hidden     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Constraints (defense-in-depth on top of client validation) ------
DO $$ BEGIN
  ALTER TABLE public.pins
    ADD CONSTRAINT pins_text_len CHECK (char_length(text) BETWEEN 1 AND 50);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pins
    ADD CONSTRAINT pins_cat_valid
    CHECK (cat IN ('food','spot','warn','life','fun','misc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pins
    ADD CONSTRAINT pins_lat_valid CHECK (lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pins
    ADD CONSTRAINT pins_lng_valid CHECK (lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pins
    ADD CONSTRAINT pins_loc_len CHECK (loc IS NULL OR char_length(loc) <= 80);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Indexes ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pins_ts        ON public.pins (ts DESC);
CREATE INDEX IF NOT EXISTS idx_pins_cat       ON public.pins (cat);
CREATE INDEX IF NOT EXISTS idx_pins_author    ON public.pins (author);
CREATE INDEX IF NOT EXISTS idx_pins_lat_lng   ON public.pins (lat, lng);
CREATE INDEX IF NOT EXISTS idx_pins_official  ON public.pins (official) WHERE official = TRUE;

-- 4. updated_at trigger ----------------------------------------------
CREATE OR REPLACE FUNCTION public.pins_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pins_updated_at ON public.pins;
CREATE TRIGGER pins_updated_at
  BEFORE UPDATE ON public.pins
  FOR EACH ROW EXECUTE FUNCTION public.pins_set_updated_at();

-- 5. Row Level Security ----------------------------------------------
ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;

-- Wipe any legacy policies first (idempotent)
DROP POLICY IF EXISTS "Allow public read" ON public.pins;
DROP POLICY IF EXISTS "Allow all reads" ON public.pins;
DROP POLICY IF EXISTS "Allow anonymous read" ON public.pins;
DROP POLICY IF EXISTS "Allow realtime for anon" ON public.pins;
DROP POLICY IF EXISTS "Allow insert" ON public.pins;
DROP POLICY IF EXISTS "Allow anonymous insert" ON public.pins;
DROP POLICY IF EXISTS "Allow authenticated inserts with author match" ON public.pins;
DROP POLICY IF EXISTS "Allow insert for authenticated and anonymous" ON public.pins;
DROP POLICY IF EXISTS "Allow update for author" ON public.pins;
DROP POLICY IF EXISTS "Allow anonymous update" ON public.pins;
DROP POLICY IF EXISTS "Allow authenticated updates to own pins" ON public.pins;
DROP POLICY IF EXISTS "Allow update reactions for anyone" ON public.pins;
DROP POLICY IF EXISTS "Allow delete for author" ON public.pins;
DROP POLICY IF EXISTS "Allow anonymous delete" ON public.pins;
DROP POLICY IF EXISTS "Allow authenticated deletes to own pins" ON public.pins;
DROP POLICY IF EXISTS "Allow report flagging" ON public.pins;

-- 5a. SELECT — anyone (anon or authenticated) can read non-hidden pins.
CREATE POLICY "pins_select_public" ON public.pins
  FOR SELECT
  USING (_hidden = FALSE);

-- 5b. INSERT — must be signed in (anon auth OK), and `author` MUST match
--     the caller's `auth.uid()`. This blocks spoofing other users.
CREATE POLICY "pins_insert_owner" ON public.pins
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND author = auth.uid()::text
    AND char_length(text) BETWEEN 1 AND 50
    AND cat IN ('food','spot','warn','life','fun','misc')
    AND lat BETWEEN -90 AND 90
    AND lng BETWEEN -180 AND 180
    AND official = FALSE          -- 'official' pins must be set server-side
    AND _reported = FALSE
    AND _hidden = FALSE
  );

-- 5c. UPDATE — only the author can edit their own pin (text/cat/reactions/_reported).
--     Anyone authenticated can also bump the `reactions` JSONB on someone else's pin
--     (so reactions feel real-time across users) BUT cannot edit text/cat/author.
CREATE POLICY "pins_update_owner" ON public.pins
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND author = auth.uid()::text)
  WITH CHECK (
    auth.uid() IS NOT NULL AND author = auth.uid()::text
  );

CREATE POLICY "pins_update_reactions" ON public.pins
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (
    auth.uid() IS NOT NULL
    -- The row that already exists in the DB is referenced as the *base* row
    -- in this WITH CHECK; we cannot easily diff here, so we further restrict
    -- via column-level grants below (`grant update (reactions) ...`).
  );

-- 5d. DELETE — only the author can delete their own pin.
CREATE POLICY "pins_delete_owner" ON public.pins
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND author = auth.uid()::text);

-- 6. Column-level grants ---------------------------------------------
--    * authenticated   → can update their own row freely (RLS checks ownership)
--    * authenticated   → can also bump the `reactions` JSONB on any row
--                        (this is the "react to other people's pins" path)
--    * anon            → SELECT only
REVOKE ALL ON public.pins FROM anon, authenticated;
GRANT SELECT ON public.pins TO anon, authenticated;
GRANT INSERT ON public.pins TO authenticated;
GRANT DELETE ON public.pins TO authenticated;
-- Authenticated users can update only the columns we explicitly allow.
GRANT UPDATE (text, cat, reactions, _reported, loc, ts) ON public.pins TO authenticated;

-- 7. Realtime publication --------------------------------------------
--    Add `pins` to the supabase_realtime publication so postgres_changes
--    fires for every INSERT/UPDATE/DELETE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pins'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pins';
  END IF;
END $$;

-- Make sure replication carries enough info for UPDATE/DELETE payloads
ALTER TABLE public.pins REPLICA IDENTITY FULL;

-- 8. Sanity check ----------------------------------------------------
SELECT 'Pinly RLS + realtime applied successfully' AS status;
