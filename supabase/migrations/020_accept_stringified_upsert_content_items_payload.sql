-- Accept both JSON arrays and stringified JSON arrays for backwards compatibility
-- with older Edge Function deployments.

CREATE OR REPLACE FUNCTION upsert_content_items(
  p_keyword TEXT,
  p_items   JSONB
)
RETURNS TABLE(id UUID, url TEXT) AS $$
#variable_conflict use_column
DECLARE
  v_items JSONB;
BEGIN
  v_items := CASE
    WHEN jsonb_typeof(p_items) = 'string' THEN (p_items #>> '{}')::jsonb
    ELSE p_items
  END;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'upsert_content_items expects a JSON array, got %', jsonb_typeof(v_items)
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO content_items (
    url, platform, title, description, snippet,
    author, thumbnail, published_at, keywords
  )
  SELECT
    item->>'url',
    item->>'platform',
    item->>'title',
    COALESCE(item->>'description', ''),
    NULLIF(item->>'snippet', ''),
    NULLIF(item->>'author', ''),
    NULLIF(item->>'thumbnail', ''),
    NULLIF(item->>'published_at', ''),
    ARRAY[p_keyword]
  FROM jsonb_array_elements(v_items) AS item
  ON CONFLICT (url) DO UPDATE SET
    title        = EXCLUDED.title,
    description  = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE content_items.description END,
    snippet      = COALESCE(EXCLUDED.snippet,      content_items.snippet),
    author       = COALESCE(EXCLUDED.author,       content_items.author),
    thumbnail    = COALESCE(EXCLUDED.thumbnail,    content_items.thumbnail),
    keywords     = (
      SELECT ARRAY(SELECT DISTINCT unnest(content_items.keywords || ARRAY[p_keyword]))
    ),
    search_count = content_items.search_count + 1,
    last_seen_at = NOW()
  RETURNING content_items.id, content_items.url;
END;
$$ LANGUAGE plpgsql;
