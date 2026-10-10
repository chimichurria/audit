'use client'
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export function AdminPanel({ html }: { html: string }) {
  localStorage.setItem('session_token', 'x');
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
