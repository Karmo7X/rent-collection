-- Payment slips bucket (SPEC.md section 6, "Storage").
--
-- Private bucket; files live under <org_id>/... Only staff and managers of
-- that org can upload and read (read = creating short-lived signed URLs).
-- Tenants, other orgs and anon: no read, list or upload. No update/delete
-- policies: users can't overwrite or remove slips. Cleanup of a slip left
-- behind by a failed payment is done server-side with the secret key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy payment_slips_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (select private.member_org_id()) is not null
    and (storage.foldername(name))[1] = (select private.member_org_id())::text
  );

create policy payment_slips_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (select private.member_org_id()) is not null
    and (storage.foldername(name))[1] = (select private.member_org_id())::text
  );
