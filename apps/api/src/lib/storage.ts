import { getSupabaseAdminClient } from '@desigual-os/auth';

const BUCKET = 'user-uploads';

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
