-- Korean display names for KRX listings; the UI leads with these when KR assets are viewed in KRW.
alter table public.symbols add column if not exists name_kr text;
update public.symbols s set name_kr = v.ko
from (values
  ('005930.KS', '삼성전자'),
  ('005935.KS', '삼성전자우'),
  ('000660.KS', 'SK하이닉스'),
  ('373220.KS', 'LG에너지솔루션'),
  ('207940.KS', '삼성바이오로직스'),
  ('005380.KS', '현대차'),
  ('000270.KS', '기아'),
  ('068270.KS', '셀트리온'),
  ('035420.KS', '네이버'),
  ('035720.KS', '카카오'),
  ('051910.KS', 'LG화학'),
  ('006400.KS', '삼성SDI'),
  ('005490.KS', '포스코홀딩스'),
  ('105560.KS', 'KB금융'),
  ('055550.KS', '신한지주'),
  ('086790.KS', '하나금융지주'),
  ('316140.KS', '우리금융지주'),
  ('032830.KS', '삼성생명'),
  ('000810.KS', '삼성화재'),
  ('012330.KS', '현대모비스'),
  ('028260.KS', '삼성물산'),
  ('066570.KS', 'LG전자'),
  ('034730.KS', 'SK'),
  ('003550.KS', 'LG'),
  ('017670.KS', 'SK텔레콤'),
  ('030200.KS', 'KT'),
  ('036570.KS', '엔씨소프트'),
  ('251270.KS', '넷마블'),
  ('259960.KS', '크래프톤'),
  ('352820.KS', '하이브'),
  ('090430.KS', '아모레퍼시픽'),
  ('011200.KS', 'HMM'),
  ('042660.KS', '한화오션'),
  ('012450.KS', '한화에어로스페이스'),
  ('047810.KS', '한국항공우주'),
  ('010130.KS', '고려아연'),
  ('010950.KS', '에스오일'),
  ('096770.KS', 'SK이노베이션'),
  ('267250.KS', 'HD현대'),
  ('329180.KS', 'HD현대중공업'),
  ('034020.KS', '두산에너빌리티'),
  ('247540.KQ', '에코프로비엠'),
  ('086520.KQ', '에코프로'),
  ('293490.KQ', '카카오게임즈'),
  ('263750.KQ', '펄어비스'),
  ('041510.KQ', '에스엠'),
  ('035900.KQ', 'JYP엔터테인먼트'),
  ('122870.KQ', '와이지엔터테인먼트'),
  ('024110.KS', '기업은행'),
  ('003690.KS', '코리안리'),
  ('139480.KS', '이마트'),
  ('004370.KS', '농심'),
  ('097950.KS', 'CJ제일제당'),
  ('051900.KS', 'LG생활건강'),
  ('005940.KS', 'NH투자증권'),
  ('000150.KS', '두산')
) as v(sym, ko)
where s.symbol = v.sym;
drop view if exists public.portfolio;
create view public.portfolio as
  select h.user_id, h.id as holding_id, h.symbol, h.account, h.nickname, s.name, s.name_kr, s.currency, s.kind,
         sum(l.qty) as qty,
         sum(l.qty * l.cost_per_share) as cost_basis,
         case when sum(l.qty) > 0 then sum(l.qty * l.cost_per_share) / sum(l.qty) end as avg_cost,
         p.price, p.change_pct, p.as_of,
         sum(l.qty) * p.price as value,
         sum(l.qty) * p.price - sum(l.qty * l.cost_per_share) as total_gl
  from public.holdings h
  join public.symbols s using (symbol)
  left join public.lots l on l.holding_id = h.id
  left join public.prices p on p.symbol = h.symbol
  group by h.user_id, h.id, h.symbol, h.account, h.nickname, s.name, s.name_kr, s.currency, s.kind, p.price, p.change_pct, p.as_of;
alter view public.portfolio set (security_invoker = true);
grant select on public.portfolio to anon, authenticated, service_role;
