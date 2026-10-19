#!/usr/bin/env bash
# Contagem de linhas de cada tabela (public, drizzle, auth.users/identities) nos dois bancos, lado a lado.
set -euo pipefail
: "${ORIGEM_URL:?}"; : "${DESTINO_URL:?}"
Q="select string_agg(t, E'\n' order by t) from (select format('%s.%s=%s', n.nspname, c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text) t from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('public','drizzle') or (n.nspname='auth' and c.relname in ('users','identities')))) x"
docker run --rm postgres:17-alpine psql "$ORIGEM_URL" -X -A -t -c "$Q" > /tmp/conferir-origem.txt
docker run --rm postgres:17-alpine psql "$DESTINO_URL" -X -A -t -c "$Q" > /tmp/conferir-destino.txt
if diff /tmp/conferir-origem.txt /tmp/conferir-destino.txt; then echo "== IGUAL: $(wc -l < /tmp/conferir-origem.txt) tabelas"; else echo "== DIFERENTE (acima)"; exit 1; fi
