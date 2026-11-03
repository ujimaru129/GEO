-- 画面（顧客レポート・顧客入力・運営コンソール）のための仕組み
-- 設計: https://claude.ai/artifact/U7sajCRw1nh9qsZxhXWzi2（2026-11-03 確定）

-- 社内メンバー。運営コンソールは Supabase のメールログインで、ここに登録された有効なメンバーだけが入れる
create table staff_members (
  email text primary key,
  name text not null,
  role text not null default 'member' check (role in ('admin', 'member')), -- admin はメンバー管理もできる
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 顧客ごとの専用URL。トークン本体は保存せず SHA-256 だけ持つ（漏れたら再発行して古いものを無効化）
create table report_links (
  token_hash text primary key,
  client_id text not null references clients(id),
  created_by text not null references staff_members(email),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_viewed_at timestamptz
);
create unique index report_links_one_active on report_links(client_id) where revoked_at is null;

-- 社内で分からない正解データを顧客に記入依頼する
create table fact_requests (
  id text primary key,
  client_id text not null references clients(id),
  entity_id text not null references entities(id),
  key text not null,
  reason text not null, -- 顧客に表示する依頼理由
  requested_by text not null references staff_members(email),
  requested_at timestamptz not null default now(),
  -- open: 記入待ち / submitted: 記入済み・社内確認待ち / answered: 承認済み / unknown: 顧客も分からない / cancelled
  status text not null default 'open' check (status in ('open', 'submitted', 'answered', 'unknown', 'cancelled')),
  closed_at timestamptz
);
create unique index fact_requests_one_open on fact_requests(entity_id, key) where status in ('open', 'submitted');

-- 顧客（または社内フォーム）からの記入。承認されると facts に1行追加される
create table fact_submissions (
  id text primary key,
  request_id text references fact_requests(id),
  client_id text not null references clients(id),
  entity_id text not null references entities(id),
  key text not null,
  value_raw text not null, -- 入力そのまま（承認時に型どおりに解釈して facts.value_json にする）
  valid_from date,
  valid_to date,
  public_from date,
  source_url text,
  note text,
  via text not null check (via in ('client_form', 'staff_form')),
  submitted_by text not null, -- 顧客は 'client:<client_id>'、社内はメールアドレス
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text references staff_members(email),
  reviewed_at timestamptz,
  review_note text -- 差し戻し理由（顧客に表示）
);

-- 「誤り」判定の社内確認（誰がいつ、どう判断したか）。確認済みの判定だけ顧客に公開する
create table claim_reviews (
  id bigint generated always as identity primary key,
  claim_id bigint not null references claims(id),
  reviewer text not null references staff_members(email),
  decision text not null check (decision in ('correct', 'incorrect', 'outdated', 'unverifiable')),
  note text,
  reviewed_at timestamptz not null default now()
);
create index claim_reviews_claim on claim_reviews(claim_id, reviewed_at desc);

-- 改善の助言（Lite のレポートにも含める）。下書きを社内が確認してから公開する
create table report_advice (
  id bigint generated always as identity primary key,
  client_id text not null references clients(id),
  measurement_id text not null references measurements(id),
  content_json jsonb not null, -- [{priority, action, reason, effort, draft_text}]
  generator_version text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by text references staff_members(email),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
