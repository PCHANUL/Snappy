# Trend Content Finder v2 Planning

## Goal

Build a simple Notion-first SaaS that takes one keyword and saves popular content by platform into a Notion page.

MVP scope intentionally excludes AI analysis. The first release is search, normalization, usage tracking, and Notion persistence.

## Source Documents

- Product spec: `docs/specs/trend-content-finder-spec-v4.md`
- Phase plan: `docs/specs/trend-content-finder-phases-v4.md`

## Architecture

```text
Notion button automation
  -> Supabase Edge Function: trigger-search
  -> quota check + user lookup
  -> parallel platform search
  -> normalized results
  -> Notion page update
  -> usage/log persistence
```

## MVP Modules

- `supabase/functions/trigger-search`: webhook entrypoint for Notion automation.
- `supabase/functions/manage-user`: signup, Notion setup, and usage lookup.
- `supabase/functions/search`: Naver Blog, YouTube, Tistory, and Brunch search modules.
- `supabase/functions/notion`: Notion API client and result block builder.
- `supabase/functions/_shared`: shared types, validation, errors, env, logging, and DB access.
- `supabase/migrations`: users, search logs, usage quotas, and usage increment RPC.

## Current Implementation Status

- v1 Flutter app is preserved by the `v1.0` tag and `archive/v1.0` branch.
- v2 branch removes Flutter client code and starts from a Supabase backend-only structure.
- Search and Notion integrations are scaffolded for real API calls.
- Deployment scripts are present under `scripts/`.

## Known Follow-Ups Before Beta

- Encrypt Notion API keys before storing them in `users.notion_api_key_encrypted`.
- Create the Notion template and button automation.
- Run live API verification with real credentials in `.env.local`.
- Add integration tests once the Supabase project is linked.
- Decide whether free tier should remain enabled during beta or map beta users to `light`.
