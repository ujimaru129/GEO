-- 回答の解析（フェーズB）
-- mentions / claims / citations は 0001 で作成済み。ここでは解析の実行記録と、公式ドメインを追加する。

-- 公式サイト・公式SNSのドメイン（引用元の「公式」判定に使う）
alter table entities add column if not exists official_domains text[] not null default '{}';

-- 解析の実行単位（判定に使った LLM の費用を記録する。予算の集計に含める）
create table analysis_batches (
  id text primary key,
  measurement_id text references measurements(id),
  analyzer_version text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  runs int not null,
  llm_calls int not null,
  llm_failed int not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric(12, 6) not null,
  cost_jpy numeric(12, 2) not null,
  cost_allocation jsonb not null default '{}', -- 顧客ID → USD（社内の原価把握用）
  model text
);

-- どの run をどの解析方法で解析済みか（言及・判定・引用が0件の run も記録する）
create table run_analyses (
  run_id text not null references runs(id),
  analyzer_version text not null,
  batch_id text not null references analysis_batches(id),
  primary key (run_id, analyzer_version)
);

create index claims_run on claims(run_id, analyzer_version);
create index mentions_entity on mentions(entity_id, analyzer_version);
create index citations_run on citations(run_id, analyzer_version);
