// Copia buckets e arquivos do Storage do projeto atual para o novo.
// Uso (Node 18+): ORIGEM_URL=https://<ref>.supabase.co ORIGEM_KEY=<secret> DESTINO_URL=... DESTINO_KEY=... node copiar-storage.mjs
// Só LÊ a origem. Idempotente: reexecutar sobrescreve (x-upsert) e pula o que já tem o mesmo tamanho.
const { ORIGEM_URL, ORIGEM_KEY, DESTINO_URL, DESTINO_KEY, SO_LISTAR } = process.env;
for (const [k, v] of Object.entries({ ORIGEM_URL, ORIGEM_KEY, ...(SO_LISTAR ? {} : { DESTINO_URL, DESTINO_KEY }) })) if (!v) throw new Error(`${k} ausente`);

const h = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });

async function json(res) {
  if (!res.ok) throw new Error(`${res.status} ${res.url}: ${await res.text()}`);
  return res.json();
}

async function listAll(base, key, bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await json(await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: h(key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    }));
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id === null) out.push(...await listAll(base, key, bucket, path)); // pasta
      else out.push({ path, size: row.metadata?.size ?? null, mimetype: row.metadata?.mimetype ?? 'application/octet-stream' });
    }
    if (rows.length < 1000) break;
  }
  return out;
}

const buckets = await json(await fetch(`${ORIGEM_URL}/storage/v1/bucket`, { headers: h(ORIGEM_KEY) }));
// SO_LISTAR=1: ensaio sem destino — só conta o que existe na origem.
if (SO_LISTAR) {
  for (const bucket of buckets) {
    const all = await listAll(ORIGEM_URL, ORIGEM_KEY, bucket.id);
    console.log(`${bucket.id} (public=${bucket.public}): ${all.length} arquivos, ${(all.reduce((t, o) => t + (o.size ?? 0), 0) / 1048576).toFixed(1)} MB`);
  }
  process.exit(0);
}
const destBuckets = new Set((await json(await fetch(`${DESTINO_URL}/storage/v1/bucket`, { headers: h(DESTINO_KEY) }))).map((b) => b.id));
let copied = 0, skipped = 0, failed = 0;
for (const bucket of buckets) {
  if (!destBuckets.has(bucket.id)) {
    await json(await fetch(`${DESTINO_URL}/storage/v1/bucket`, {
      method: 'POST', headers: h(DESTINO_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: bucket.id, name: bucket.name, public: bucket.public, file_size_limit: bucket.file_size_limit, allowed_mime_types: bucket.allowed_mime_types }),
    }));
    console.log(`bucket criado: ${bucket.id} (public=${bucket.public})`);
  }
  const origem = await listAll(ORIGEM_URL, ORIGEM_KEY, bucket.id);
  const destino = new Map((await listAll(DESTINO_URL, DESTINO_KEY, bucket.id)).map((o) => [o.path, o.size]));
  console.log(`${bucket.id}: ${origem.length} arquivos na origem, ${destino.size} já no destino`);
  for (const obj of origem) {
    if (obj.size !== null && destino.get(obj.path) === obj.size) { skipped += 1; continue; }
    try {
      const file = await fetch(`${ORIGEM_URL}/storage/v1/object/${bucket.id}/${obj.path.split('/').map(encodeURIComponent).join('/')}`, { headers: h(ORIGEM_KEY) });
      if (!file.ok) throw new Error(`download ${file.status}`);
      const bytes = Buffer.from(await file.arrayBuffer());
      const up = await fetch(`${DESTINO_URL}/storage/v1/object/${bucket.id}/${obj.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST', headers: h(DESTINO_KEY, { 'Content-Type': obj.mimetype, 'x-upsert': 'true', 'cache-control': 'max-age=3600' }), body: bytes,
      });
      if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
      copied += 1;
      if (copied % 50 === 0) console.log(`  ${copied} copiados...`);
    } catch (error) {
      failed += 1;
      console.error(`FALHOU ${bucket.id}/${obj.path}: ${error.message}`);
    }
  }
}
console.log(`== copiados ${copied}, já existiam ${skipped}, falharam ${failed}`);
if (failed) process.exit(1);
