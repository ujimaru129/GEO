-- エンタメGEO MVP 初期スキーマ（Supabase / Postgres）
-- 方針: 生データ（runs / responses）は上書きしない。解析結果は analyzer_version 付きで別テーブルに積む。

create table clients (
  id text primary key,
  name text not null,
  plan text not null, -- config/plans.yaml のプラン名
  created_at timestamptz not null default now()
);

create table entities (
  id text primary key,
  client_id text not null references clients(id),
  industry text not null,
  role text not null check (role in ('target', 'competitor')),
  type text not null check (type in ('group', 'artist', 'member', 'title', 'company')),
  official_name text not null,
  ambiguous_flag boolean not null default false,
  updated_at timestamptz not null default now()
);

create table entity_aliases (
  entity_id text not null references entities(id) on delete cascade,
  alias text not null,
  normalized text not null,
  primary key (entity_id, alias)
);
create index entity_aliases_normalized on entity_aliases(normalized);

create table entity_relations (
  from_id text not null references entities(id) on delete cascade,
  to_id text not null references entities(id) on delete cascade,
  relation text not null, -- member_of / label / publisher / competitor など
  primary key (from_id, to_id, relation)
);

-- 正解データ。更新は上書きせず新しい行を追加する（created_at が登録日＝「反映日数」の起点）。
-- 同じ (entity_id, key, valid_from) の行は最新の created_at が有効（facts_current）。
create table facts (
  id bigint generated always as identity primary key,
  entity_id text not null references entities(id),
  key text not null,
  value_json jsonb not null,
  valid_from date, -- 現実世界で有効になった日（両端を含む）
  valid_to date, -- null = 現在も有効
  source_url text, -- 顧客の申告で公開情報がない場合のみ null
  source_type text not null default 'public' check (source_type in ('public', 'client_provided')),
  public_from date, -- 公表日。これより前の AI の回答には判定に使わない（null = 公表済み）
  checked_at date not null,
  note text,
  import_batch text not null, -- CSV の取り込みID、または fact_submissions の ID
  created_at timestamptz not null default now(),
  check (source_type = 'client_provided' or source_url is not null)
);
create index facts_entity_key on facts(entity_id, key);

create view facts_current as
select distinct on (entity_id, key, coalesce(valid_from, '-infinity'::date)) *
from facts
order by entity_id, key, coalesce(valid_from, '-infinity'::date), created_at desc, id desc;

create table questions (
  id text primary key,
  industry text not null,
  category text not null check (category in ('discovery', 'entity', 'comparison', 'recency')),
  template text not null,
  paraphrases jsonb not null default '[]',
  variables jsonb not null default '[]',
  priority text not null check (priority in ('high', 'normal')),
  fact_keys jsonb not null default '[]',
  synced_at timestamptz not null default now()
);

-- 実行条件のスナップショット（モデル名・単価・試行回数など）。全 run がハッシュで参照する
create table config_snapshots (
  hash text primary key,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- 1回の計測ジョブ（例: 週次の全件計測）
create table measurements (
  id text primary key,
  scope text not null, -- full / priority / test など
  started_at timestamptz not null,
  finished_at timestamptz,
  config_hash text not null references config_snapshots(hash),
  planned_calls int not null,
  estimated_usd numeric(12, 4) not null,
  summary jsonb
);

create table runs (
  id text primary key,
  measurement_id text not null references measurements(id),
  prompt_key text not null,
  question_id text not null references questions(id),
  entity_id text references entities(id),
  competitor_id text references entities(id),
  variant int not null default 0,
  prompt_text text not null,
  engine text not null check (engine in ('openai', 'gemini', 'perplexity', 'claude')),
  model text, -- API が返した正式名
  trial_no int not null,
  executed_at timestamptz not null,
  status text not null check (status in ('ok', 'failed', 'skipped_budget')),
  attempts int not null,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  reasoning_tokens int,
  search_count int,
  cost_usd numeric(12, 6) not null default 0,
  cost_jpy numeric(12, 2) not null default 0,
  cost_allocation jsonb not null default '{}', -- 顧客ID → 按分割合
  error text,
  config_hash text not null references config_snapshots(hash),
  unique (measurement_id, prompt_key, engine, trial_no)
);
create index runs_executed_at on runs(executed_at);
create index runs_question_engine on runs(question_id, engine);

create table responses (
  run_id text primary key references runs(id),
  text text not null,
  citations_json jsonb not null,
  request_json jsonb not null,
  raw_json jsonb not null
);

-- 以下はフェーズB以降で使用（解析結果。analyzer_version ごとに積む）
create table mentions (
  run_id text not null references runs(id),
  entity_id text not null references entities(id),
  rank int,
  method text not null, -- rule / llm
  analyzer_version text not null,
  primary key (run_id, entity_id, analyzer_version)
);

create table claims (
  id bigint generated always as identity primary key,
  run_id text not null references runs(id),
  entity_id text not null references entities(id),
  fact_key text not null,
  claim_json jsonb not null,
  verdict text not null check (verdict in ('correct', 'incorrect', 'outdated', 'unverifiable')),
  confidence numeric(4, 3) not null,
  evidence text not null,
  analyzer_version text not null
);

create table citations (
  run_id text not null references runs(id),
  url text not null,
  domain text not null,
  source_type text, -- official / media / wiki / sns / ec / other
  analyzer_version text not null,
  primary key (run_id, url, analyzer_version)
);

create table metrics_daily (
  entity_id text not null references entities(id),
  engine text not null,
  category text not null,
  date date not null,
  metric text not null,
  value numeric not null,
  ci_low numeric,
  ci_high numeric,
  n int not null,
  analyzer_version text not null,
  primary key (entity_id, engine, category, date, metric, analyzer_version)
);

create table eval_labels (
  run_id text primary key references runs(id),
  label_json jsonb not null,
  split text not null check (split in ('dev', 'test'))
);

create table eval_results (
  analyzer_version text not null,
  metric text not null,
  value numeric not null,
  run_at timestamptz not null default now(),
  primary key (analyzer_version, metric, run_at)
);

-- 顧客別の費用（按分後）
create view client_monthly_cost as
select date_trunc('month', r.executed_at_jst) as month, a.key as client_id, sum(r.cost_usd * a.value::numeric) as cost_usd,
       sum(r.cost_jpy * a.value::numeric) as cost_jpy
from (select *, executed_at at time zone 'Asia/Tokyo' as executed_at_jst from runs) r,
     jsonb_each_text(r.cost_allocation) a
group by 1, 2;

-- 予算管理用: 当月の費用
create view monthly_cost as
select date_trunc('month', executed_at at time zone 'Asia/Tokyo') as month,
       engine,
       count(*) filter (where status = 'ok') as ok_runs,
       count(*) filter (where status = 'failed') as failed_runs,
       sum(cost_usd) as cost_usd,
       sum(cost_jpy) as cost_jpy
from runs
group by 1, 2;
