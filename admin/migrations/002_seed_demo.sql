-- ============================================================
-- 002_seed_demo.sql — Fake data for UI testing
-- Safe to run multiple times (ON CONFLICT DO NOTHING where applicable)
-- DELETE this data before go-live: run the bottom section marked "CLEANUP"
-- ============================================================

-- ------------------------------------------------------------
-- PRODUCTS (a realistic skate shop + park catalog)
-- ------------------------------------------------------------
INSERT INTO products (sku, name, category_id, price, cost, stock, status) VALUES
  -- Session Passes
  ('DAY-ADULT',  'Day Pass — Adult',          (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 25.00, 0.00,    0, 'active'),
  ('DAY-KID',    'Day Pass — Under 12',       (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 18.00, 0.00,    0, 'active'),
  ('TWO-HOUR',   '2-Hour Session',            (SELECT id FROM categories WHERE name='Session Passes' LIMIT 1), 15.00, 0.00,    0, 'active'),
  -- Memberships
  ('MEM-MONTHLY','Monthly Unlimited',         (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),    89.00, 0.00,    0, 'active'),
  ('MEM-ANNUAL', 'Annual Unlimited',          (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),   899.00, 0.00,    0, 'active'),
  ('PUNCH-10',   '10-Session Punch Card',     (SELECT id FROM categories WHERE name='Memberships' LIMIT 1),   180.00, 0.00,    0, 'active'),
  -- Lessons
  ('LES-30',     'Private Lesson — 30 min',   (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        40.00, 0.00,    0, 'active'),
  ('LES-60',     'Private Lesson — 60 min',   (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        70.00, 0.00,    0, 'active'),
  ('GROUP-LES',  'Group Lesson (4+ kids)',    (SELECT id FROM categories WHERE name='Lessons' LIMIT 1),        25.00, 0.00,    0, 'active'),
  -- Rentals
  ('RENT-BOARD', 'Skateboard Rental',         (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),        10.00, 0.00,   12, 'active'),
  ('RENT-PADS',  'Pad Set Rental',            (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),         8.00, 0.00,   18, 'active'),
  ('RENT-HELM',  'Helmet Rental',             (SELECT id FROM categories WHERE name='Rentals' LIMIT 1),         5.00, 0.00,   20, 'active'),
  -- Decks (sample Etnies/Emerica stock from your order)
  ('ES-ACCEL-OG','éS Accel OG — Brown/Gum',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          90.00, 45.00,   4, 'active'),
  ('ES-ACCEL-SL','éS Accel Slim — Black/Tan', (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          85.00, 42.50,   4, 'active'),
  ('EM-EMERSON', 'Emerica Emerson — Tan/White',(SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         90.00, 45.00,   4, 'active'),
  ('ET-IMPRINT', 'Etnies Imprint KEVLAR',     (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         135.00, 67.50,   4, 'active'),
  ('ES-KSL3',    'éS KSL 3 — Hunter Green',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         100.00, 50.00,   4, 'active'),
  ('EM-MARANA-C','Emerica Marana — Copper',   (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         110.00, 55.00,   4, 'active'),
  ('EM-MARANA-H','Emerica Marana — Charcoal', (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),         110.00, 55.00,   4, 'active'),
  ('ES-MOCA-R',  'éS Moca — Red',             (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          80.00, 40.00,   4, 'active'),
  ('ES-MOCA-W',  'éS Moca — White/Gum',       (SELECT id FROM categories WHERE name='Shoes' LIMIT 1),          80.00, 40.00,   4, 'active'),
  ('EM-TJR',     'Emerica TJ Rodgers — Black/Red',(SELECT id FROM categories WHERE name='Shoes' LIMIT 1),     125.00, 62.50,   4, 'active'),
  -- Grip tape, hardware
  ('GRIP-MOB',   'MOB Grip — Black',          (SELECT id FROM categories WHERE name='Grip Tape' LIMIT 1),       8.00,  3.50,  24, 'active'),
  ('HW-7/8',     '7/8" Hardware Set',         (SELECT id FROM categories WHERE name='Hardware' LIMIT 1),        4.00,  1.80,  30, 'active'),
  ('HW-1',       '1" Hardware Set',           (SELECT id FROM categories WHERE name='Hardware' LIMIT 1),        4.00,  1.80,  30, 'active'),
  -- Food & drink
  ('DRINK-WATER','Bottled Water',             (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    2.00,  0.50,  48, 'active'),
  ('DRINK-GATOR','Gatorade',                  (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    3.50,  1.25,  36, 'active'),
  ('SNACK-BAR',  'Protein Bar',               (SELECT id FROM categories WHERE name='Food & Drink' LIMIT 1),    3.00,  1.20,  24, 'active')
ON CONFLICT (sku) DO NOTHING;

-- ------------------------------------------------------------
-- FAKE CUSTOMERS (6 skaters + 2 guardians — plausible NY names)
-- All emails at @example.com to make obvious these are demo
-- ------------------------------------------------------------
-- Use first_name/last_name (not `name`) — after migration 003, `name` is a
-- GENERATED column and Postgres won't accept inserts to it. The split-name
-- form works both pre- and post-003 (003 backfills first_name/last_name from
-- `name` and only converts `name` to generated if first_name+last_name exist).
-- Wrapped in a guard so we don't even attempt the insert if the seed already
-- ran (avoids any future column-shape mismatch tripping a re-run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE email = 'liam@example.com') THEN
    INSERT INTO customers (first_name, last_name, email, phone, dob, parent_name, parent_phone, parent_email, state, notes) VALUES
      ('Liam',     'Chen',       'liam@example.com',      '914-555-0101', '2012-03-14', 'Wei Chen',        '914-555-0102', 'wei@example.com',    'NY', 'Regular, lesson student'),
      ('Ava',      'Rodriguez',  'ava@example.com',       '914-555-0103', '2011-07-22', 'Maria Rodriguez', '914-555-0104', 'maria@example.com',  'NY', 'Monthly member'),
      ('Noah',     'Patel',      'noah@example.com',      '914-555-0105', '2013-11-02', 'Raj Patel',       '914-555-0106', 'raj@example.com',    'NY', 'Punch card member'),
      ('Emma',     'Johnson',    'emma@example.com',      '914-555-0107', '2005-04-19', NULL,              NULL,           NULL,                 'NY', 'Adult skater'),
      ('Mason',    'Kim',        'mason@example.com',     '914-555-0109', '2010-08-30', 'Sung Kim',        '914-555-0110', 'sung@example.com',   'NY', 'Birthday party Oct 2026'),
      ('Zoey',     'Williams',   'zoey@example.com',      '914-555-0111', '2014-01-05', 'Dan Williams',    '914-555-0112', 'dan@example.com',    'NY', 'New skater, shy'),
      ('Jack',     'O''Brien',   'jack@example.com',      '914-555-0113', '2003-12-11', NULL,              NULL,           NULL,                 'NY', NULL),
      ('Isabella', 'Nguyen',     'isabella@example.com',  '914-555-0115', '2012-06-28', 'Linh Nguyen',     '914-555-0116', 'linh@example.com',   'NY', 'Lesson program')
    ON CONFLICT (email) DO NOTHING;
  END IF;
END $$;

-- ------------------------------------------------------------
-- MEMBERSHIPS (linked to above customers)
-- ------------------------------------------------------------
INSERT INTO subscriptions (customer_id, customer_name, plan_name, plan_type, monthly_rate, start_date, status, auto_renew)
SELECT id, name, 'Monthly Unlimited', 'monthly', 89.00, CURRENT_DATE - INTERVAL '45 days', 'active', true
FROM customers WHERE email = 'ava@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (customer_id, customer_name, plan_name, plan_type, punches_total, punches_used, start_date, status)
SELECT id, name, '10-Session Punch Card', 'punch_card', 10, 3, CURRENT_DATE - INTERVAL '20 days', 'active'
FROM customers WHERE email = 'noah@example.com'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- RECENT SALES (past 7 days, varied)
-- ------------------------------------------------------------
INSERT INTO sales (customer_id, subtotal, tax, total, payment_provider, payment_method, status, created_at)
SELECT
  c.id,
  round((random()*80 + 10)::numeric, 2) AS subtotal,
  round((random()*80 + 10)::numeric * 0.08375, 2) AS tax,
  round((random()*80 + 10)::numeric * 1.08375, 2) AS total,
  CASE WHEN random() < 0.7 THEN 'square' ELSE 'cash' END,
  CASE WHEN random() < 0.7 THEN 'card' ELSE 'cash' END,
  'completed',
  NOW() - (random() * INTERVAL '7 days')
FROM customers c, generate_series(1,3)
WHERE c.email LIKE '%@example.com';

-- ------------------------------------------------------------
-- A FEW CHECK-INS (for the "who's in the park" view)
-- ------------------------------------------------------------
INSERT INTO checkins (customer_id, checked_in_at)
SELECT id, NOW() - (random() * INTERVAL '3 hours')
FROM customers
WHERE email IN ('liam@example.com','ava@example.com','noah@example.com');

-- ------------------------------------------------------------
-- UPCOMING LESSONS (next 2 weeks)
-- ------------------------------------------------------------
INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Ryan', 'private', NOW() + (random()*INTERVAL '14 days'), 60, 70.00, 'scheduled'
FROM customers WHERE email = 'liam@example.com';

INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Sam', 'group', NOW() + INTERVAL '3 days', 90, 25.00, 'scheduled'
FROM customers WHERE email = 'noah@example.com';

INSERT INTO lessons (customer_id, instructor, type, scheduled_at, duration_min, price, status)
SELECT id, 'Coach Ryan', 'birthday', NOW() + INTERVAL '10 days' + INTERVAL '2 hours', 120, 400.00, 'scheduled'
FROM customers WHERE email = 'mason@example.com';

-- ============================================================
-- CLEANUP — run these to wipe demo data before go-live:
--
-- DELETE FROM lessons       WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM checkins      WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM sales         WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM subscriptions WHERE customer_id IN (SELECT id FROM customers WHERE email LIKE '%@example.com');
-- DELETE FROM customers     WHERE email LIKE '%@example.com';
-- DELETE FROM products      WHERE sku IN ('DAY-ADULT','DAY-KID','TWO-HOUR','MEM-MONTHLY','MEM-ANNUAL','PUNCH-10','LES-30','LES-60','GROUP-LES','RENT-BOARD','RENT-PADS','RENT-HELM','ES-ACCEL-OG','ES-ACCEL-SL','EM-EMERSON','ET-IMPRINT','ES-KSL3','EM-MARANA-C','EM-MARANA-H','ES-MOCA-R','ES-MOCA-W','EM-TJR','GRIP-MOB','HW-7/8','HW-1','DRINK-WATER','DRINK-GATOR','SNACK-BAR');
-- ============================================================
