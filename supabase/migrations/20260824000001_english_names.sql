-- English-first product copy (US-targeted): seed KR names become English.
-- Korean naming still appears naturally when a user adds a KR listing whose
-- market-data name is Korean — that is expected and allowed.
update public.symbols set name = 'Samsung Electronics'        where symbol = '005930.KS';
update public.symbols set name = 'Samsung Electronics (Pref)' where symbol = '005935.KS';
update public.symbols set name = 'SK Hynix'                   where symbol = '000660.KS';
