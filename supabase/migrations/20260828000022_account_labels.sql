-- per-account provenance label for imported holdings ("Fidelity …4998")
alter table public.holdings add column if not exists account_label text;
drop view if exists public.portfolio;
create view public.portfolio with (security_invoker = true) as
 SELECT h.user_id, h.id AS holding_id, h.symbol, h.account, h.nickname, h.source, h.account_label,
    s.name, s.name_kr, s.currency, s.kind,
    sum(l.qty) AS qty,
    sum(l.qty * l.cost_per_share) AS cost_basis,
    CASE WHEN sum(l.qty) > 0::numeric THEN sum(l.qty * l.cost_per_share) / sum(l.qty) ELSE NULL::numeric END AS avg_cost,
    p.price, p.change_pct, p.as_of,
    sum(l.qty) * p.price AS value,
    sum(l.qty) * p.price - sum(l.qty * l.cost_per_share) AS total_gl
   FROM holdings h
     JOIN symbols s USING (symbol)
     LEFT JOIN lots l ON l.holding_id = h.id
     LEFT JOIN prices p ON p.symbol = h.symbol
  GROUP BY h.user_id, h.id, h.symbol, h.account, h.nickname, h.source, h.account_label, s.name, s.name_kr, s.currency, s.kind, p.price, p.change_pct, p.as_of;
grant select on public.portfolio to authenticated, anon;
