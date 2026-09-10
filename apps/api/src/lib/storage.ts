import { getSupabaseAdminClient } from '@desigual-os/auth';

const BUCKET = 'user-uploads';
const STUDIO_BUCKET = 'studio-assets';

export interface UploadedFile {
  url: string;
  path: string;
}

export async function uploadUserFile(path: string, content: Buffer, contentType: string): Promise<UploadedFile> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator');
  }

  const supabase = getSupabaseAdminClient(supabaseUrl, secretKey);
  const { error } = await supabase.storage.from(BUCKET).upload(path, content, { contentType, upsert: true });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Remove um arquivo do bucket 'user-uploads'. A storage key é derivada da URL
 * pública no mesmo formato montado por uploadUserFile:
 * `<SUPABASE_URL>/storage/v1/object/public/user-uploads/<path>`.
 */
export async function deleteUserFile(storageUrl: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator');
  }

  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const markerIndex = storageUrl.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Cannot derive storage key from URL: ${storageUrl}`);
  }
  const key = decodeURIComponent(storageUrl.slice(markerIndex + marker.length));

  const supabase = getSupabaseAdminClient(supabaseUrl, secretKey);
  const { error } = await supabase.storage.from(BUCKET).remove([key]);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Remove um asset gerado do bucket 'studio-assets'. A storage key é derivada
 * da URL pública gravada em studio_assets.storage_url, que o studio-node
 * monta como `<SUPABASE_URL>/storage/v1/object/public/studio-assets/<clientId>/<filename>`
 * (ver nodes/studio-node/src/storage.ts).
 */
export async function deleteStudioAssetFile(storageUrl: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator');
  }

  const marker = `/storage/v1/object/public/${STUDIO_BUCKET}/`;
  const markerIndex = storageUrl.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Cannot derive storage key from URL: ${storageUrl}`);
  }
  const key = decodeURIComponent(storageUrl.slice(markerIndex + marker.length));

  const supabase = getSupabaseAdminClient(supabaseUrl, secretKey);
  const { error } = await supabase.storage.from(STUDIO_BUCKET).remove([key]);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}
