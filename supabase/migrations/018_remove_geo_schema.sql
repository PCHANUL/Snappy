-- GEO feature was removed from the app, but migrations 016/017 were already
-- applied remotely. Keep that history and drop the now-unused schema here.

DROP TABLE IF EXISTS geo_noise_floors CASCADE;
DROP TABLE IF EXISTS geo_seo_snapshots CASCADE;
DROP TABLE IF EXISTS geo_citations CASCADE;
DROP TABLE IF EXISTS geo_runs CASCADE;
DROP TABLE IF EXISTS geo_tracked_keywords CASCADE;
DROP TABLE IF EXISTS geo_entities CASCADE;
