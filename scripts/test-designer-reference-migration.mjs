import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/202610170001_designer_request_reference_attachments.sql', import.meta.url), 'utf8');
assert.match(sql, /content_type in \('image\/jpeg', 'image\/png', 'image\/webp'\).*size_bytes <= 10485760/s);
assert.match(sql, /content_type = 'application\/pdf'.*size_bytes <= 31457280/s);
assert.match(sql, /p_content_type in \('image\/jpeg','image\/png','image\/webp'\).*p_size_bytes > 10485760/s);
assert.match(sql, /public\.can_access_designer_request\(a\.request_id\)/);
assert.match(sql, /public = false/);
assert.match(sql, /grant select on table public\.designer_request_reference_attachments to authenticated/);
assert.match(sql, /public\.can_read_designer_reference_object\(name\)/);
assert.match(sql, /create policy "Request owners read removable reference objects" on storage\.objects for select to authenticated using \([\s\S]*public\.can_delete_designer_reference_object\(name\)/);
assert.match(sql, /create policy "Request owners remove eligible reference objects"/);
assert.match(sql, /public\.can_delete_designer_reference_object\(name\)/);
assert.doesNotMatch(sql, /grant execute on function public\.designer_reference_path_is_registered\(text\)[\s\S]*to authenticated/);
assert.match(sql, /Reference file extension does not match its content type/);
assert.match(sql, /metadata->>'mimetype'.*image\/jpeg/s);
assert.doesNotMatch(sql, /delete\s+from\s+storage\.objects/i);
console.log('designer reference migration security contract: passed');
