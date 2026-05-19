-- Public Storage bucket for the setup web app.
-- Files are uploaded by scripts/deploy-web.sh.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'web',
  'web',
  true,
  10485760,
  ARRAY[
    'text/html',
    'text/css',
    'application/javascript',
    'application/json',
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/x-icon'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read access for web assets'
  ) THEN
    CREATE POLICY "Public read access for web assets"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'web');
  END IF;
END $$;
