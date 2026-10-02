import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../supabase-config.js';

const configured = !SUPABASE_URL.includes('YOUR_PROJECT_REF') && !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
export const isSupabaseConfigured = configured;
