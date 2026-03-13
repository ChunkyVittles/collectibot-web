-- Corporate entity model
CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  parent_id INTEGER REFERENCES entities(id),
  active_from INTEGER,
  active_to INTEGER,
  description TEXT,
  notes TEXT,
  gcd_publisher_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Products made by any entity
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER REFERENCES entities(id),
  product_type VARCHAR(100) NOT NULL,
  name VARCHAR(500),
  year INTEGER,
  description TEXT,
  scan_id INTEGER REFERENCES scans(id),
  source_url TEXT,
  contributor_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Link existing publishers to entities
--
-- NOTE: The intended approach was:
--   ALTER TABLE publishers ADD COLUMN entity_id INTEGER REFERENCES entities(id);
-- However, the publishers table is owned by the postgres superuser and the
-- collectibot user lacks ALTER TABLE permission. As a workaround, we created
-- a separate linking table instead:
--
--   CREATE TABLE publisher_entity_map (
--     publisher_id BIGINT PRIMARY KEY REFERENCES publishers(id),
--     entity_id INTEGER NOT NULL REFERENCES entities(id),
--     created_at TIMESTAMP DEFAULT NOW()
--   );
--
-- To clean this up properly, run as postgres superuser:
--   ALTER TABLE publishers OWNER TO collectibot;
--   ALTER TABLE publishers ADD COLUMN entity_id INTEGER REFERENCES entities(id);
--   -- Migrate data from publisher_entity_map into publishers.entity_id
--   UPDATE publishers p SET entity_id = m.entity_id FROM publisher_entity_map m WHERE m.publisher_id = p.id;
--   DROP TABLE publisher_entity_map;

-- This ALTER will fail as collectibot user — left here for documentation.
-- Run as postgres superuser if you want to use it instead of publisher_entity_map.
-- ALTER TABLE publishers
--   ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id);

CREATE TABLE IF NOT EXISTS publisher_entity_map (
  publisher_id BIGINT PRIMARY KEY REFERENCES publishers(id),
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  created_at TIMESTAMP DEFAULT NOW()
);
