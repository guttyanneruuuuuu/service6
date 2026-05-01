```sql
-- Create pins table (unchanged)
CREATE TABLE pins (
  id TEXT PRIMARY KEY,
  lat FLOAT NOT NULL,
  lng FLOAT NOT NULL,
  cat TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  loc TEXT,
  author TEXT NOT NULL,
  reactions JSONB DEFAULT '{}',
  myReactions TEXT[] DEFAULT '{}',
  official BOOLEAN DEFAULT FALSE,
  _reported BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster queries (unchanged)
CREATE INDEX idx_pins_ts ON pins(ts DESC);
CREATE INDEX idx_pins_cat ON pins(cat);
CREATE INDEX idx_pins_author ON pins(author);
CREATE INDEX idx_pins_location ON pins(lat, lng);

-- Enable Row Level Security (RLS) (unchanged)
ALTER TABLE pins ENABLE ROW LEVEL SECURITY;

-- Revised RLS Policies

-- Allow all users (anonymous or authenticated) to read pins
DROP POLICY IF EXISTS "Allow anonymous read" ON pins;
CREATE POLICY "Allow all reads" ON pins
  FOR SELECT USING (true);

-- Allow authenticated users to insert pins, with basic validation
-- For anonymous users, the 'author' field is client-generated (u_xxxx). 
-- We assume 'author' is set to the client-generated ID for anonymous posts.
-- This policy prevents authenticated users from spoofing other authors.
DROP POLICY IF EXISTS "Allow anonymous insert" ON pins;
CREATE POLICY "Allow authenticated inserts with author match" ON pins
  FOR INSERT WITH CHECK (
    (auth.uid() IS NOT NULL AND author = auth.uid()::text) OR
    (auth.uid() IS NULL AND author ~ '^u_[a-z0-9_-]{4,32}$' AND LENGTH(text) <= 50 AND LENGTH(text) > 0)
  );

-- Allow authenticated users to update their own pins, with basic validation
DROP POLICY IF EXISTS "Allow anonymous update" ON pins;
CREATE POLICY "Allow authenticated updates to own pins" ON pins
  FOR UPDATE USING (
    (auth.uid() IS NOT NULL AND author = auth.uid()::text) OR
    (auth.uid() IS NULL AND author ~ '^u_[a-z0-9_-]{4,32}$' AND LENGTH(text) <= 50 AND LENGTH(text) > 0)
  ) WITH CHECK (
    (auth.uid() IS NOT NULL AND author = auth.uid()::text) OR
    (auth.uid() IS NULL AND author ~ '^u_[a-z0-9_-]{4,32}$' AND LENGTH(text) <= 50 AND LENGTH(text) > 0)
  );

-- Allow authenticated users to delete their own pins
DROP POLICY IF EXISTS "Allow anonymous delete" ON pins;
CREATE POLICY "Allow authenticated deletes to own pins" ON pins
  FOR DELETE USING (
    (auth.uid() IS NOT NULL AND author = auth.uid()::text) OR
    (auth.uid() IS NULL AND author ~ '^u_[a-z0-9_-]{4,32}$')
  );

-- Prevent direct modification of internal fields by users
-- This is a more advanced RLS, often handled by triggers or backend logic.
-- For now, we'll focus on the above, as direct RLS for specific column updates can be complex.
```

## 3. APIキーの取得

1. Supabaseダッシュボードで、「Settings」→「API」に移動します。
2. 「Project URL」と「anon public」キーをコピーします。

## 4. Pinlyの設定

1. `src/data/supabase.js` を開きます。
2. 以下の部分を修正します：

```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

実際のプロジェクトURLとAPIキーに置き換えてください。

## 5. ストアの統合

`src/data/store.js` を修正して、Supabaseとの同期を有効にします。

### 修正例

```javascript
import { 
  initSupabase, 
  fetchPinsFromSupabase, 
  insertPinToSupabase,
  updatePinInSupabase,
  subscribeToSupabasePins 
} from './supabase.js';

export class PinStore extends EventTarget {
  constructor() {
    super();
    this.pins = new Map();
    this.self = this._loadSelf();
    this.bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(BC_NAME) : null;
    if (this.bc) this.bc.onmessage = (e) => this._onBC(e.data);
    this.supabase = null;
  }

  async init() {
    // Initialize Supabase
    this.supabase = await initSupabase();
    
    // Load from Supabase if available
    if (this.supabase) {
      try {
        const remotePins = await fetchPinsFromSupabase();
        remotePins.forEach((p) => {
          const normalized = this._normalize(p);
          this.pins.set(normalized.id, normalized);
        });
        
        // Subscribe to real-time updates
        subscribeToSupabasePins((payload) => {
          this._onSupabaseChange(payload);
        });
      } catch (err) {
        console.warn('Supabase sync failed, using local storage:', err);
      }
    }
    
    // Load from localStorage
    const local = this._loadLS();
    local.forEach((p) => this.pins.set(p.id, p));
    
    // ... rest of init
  }

  async add({ lat, lng, cat, text, loc }) {
    const pin = this._normalize({
      id: 'p_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)),
      lat, lng, cat, text, loc,
      ts: Math.floor(Date.now() / 1000),
      author: this.self.id,
      reactions: {},
      myReactions: [],
    });
    
    this.pins.set(pin.id, pin);
    this._saveLS();
    
    // Save to Supabase
    if (this.supabase) {
      insertPinToSupabase(pin).catch(err => console.error('Failed to save to Supabase:', err));
    }
    
    this._emit('add', pin);
    this._broadcast({ t: 'add', pin });
    return pin;
  }

  react(id, emoji) {
    const p = this.pins.get(id);
    if (!p) return null;
    const has = p.myReactions.includes(emoji);
    if (has) {
      p.myReactions = p.myReactions.filter((x) => x !== emoji);
      p.reactions[emoji] = Math.max(0, (p.reactions[emoji] || 1) - 1);
      if (p.reactions[emoji] === 0) delete p.reactions[emoji];
    } else {
      p.myReactions.push(emoji);
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
    }
    this._saveLS();
    
    // Update in Supabase
    if (this.supabase) {
      updatePinInSupabase(id, { reactions: p.reactions }).catch(err => console.error('Failed to update reactions:', err));
    }
    
    this._emit('update', p);
    this._broadcast({ t: 'update', pin: p });
    return p;
  }

  _onSupabaseChange(payload) {
    // Handle real-time updates from Supabase
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const p = this._normalize(newRecord);
      this.pins.set(p.id, p);
      this._saveLS();
      this._emit(eventType === 'INSERT' ? 'add' : 'update', p);
    } else if (eventType === 'DELETE') {
      this.pins.delete(oldRecord.id);
      this._saveLS();
      this._emit('delete', oldRecord);
    }
  }
}
```

## 6. デプロイ

1. 変更をコミットしてGitHubにプッシュします：
   ```bash
   git add .
   git commit -m "feat: add Supabase integration for persistent storage"
   git push origin main
   ```

2. GitHub Pagesが自動的に更新されます。

## 注意事項

- **セキュリティ**: 本番環境では、RLSポリシーをより厳密に設定してください。
- **レート制限**: Supabaseの無料プランには一定のレート制限があります。
- **バックアップ**: 定期的にデータをバックアップしてください。

## トラブルシューティング

### Supabaseに接続できない場合

1. APIキーが正しく設定されているか確認します。
2. プロジェクトのURLが正しいか確認します。
3. ブラウザのコンソールでエラーメッセージを確認します。

### データが同期されない場合

1. RLSポリシーが正しく設定されているか確認します。
2. ネットワーク接続を確認します。
3. Supabaseダッシュボードでテーブルにデータが存在するか確認します。
