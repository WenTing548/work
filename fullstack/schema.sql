CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(32) PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password VARCHAR(100) NOT NULL,
  name VARCHAR(40) NOT NULL,
  college VARCHAR(60) NOT NULL DEFAULT '',
  role VARCHAR(16) NOT NULL DEFAULT 'student',
  verified TINYINT NOT NULL DEFAULT 1,
  credit INT NOT NULL DEFAULT 80,
  balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  id VARCHAR(32) PRIMARY KEY,
  owner_id VARCHAR(32) NOT NULL,
  title VARCHAR(100) NOT NULL,
  category VARCHAR(20) NOT NULL,
  category_id VARCHAR(32) NULL,
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2) NOT NULL,
  condition_level VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  delivery VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  views INT NOT NULL DEFAULT 0,
  reject_reason VARCHAR(200) NULL,
  KEY idx_items_status (status),
  KEY idx_items_owner (owner_id),
  CONSTRAINT fk_items_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(32) PRIMARY KEY,
  item_id VARCHAR(32) NOT NULL,
  buyer_id VARCHAR(32) NOT NULL,
  seller_id VARCHAR(32) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  order_type VARCHAR(16) NOT NULL DEFAULT 'normal',
  plan_id VARCHAR(32) NULL,
  delivery VARCHAR(20) NOT NULL,
  pickup_point_id VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  deadline BIGINT NOT NULL,
  paid_at BIGINT NULL,
  delivered_at BIGINT NULL,
  completed_at BIGINT NULL,
  cancelled_at BIGINT NULL,
  reviewed TINYINT NOT NULL DEFAULT 0,
  KEY idx_orders_buyer (buyer_id),
  KEY idx_orders_seller (seller_id),
  CONSTRAINT fk_orders_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NULL,
  order_id VARCHAR(32) NULL,
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note VARCHAR(160) NOT NULL DEFAULT '',
  at BIGINT NOT NULL,
  KEY idx_payments_user (user_id),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL UNIQUE,
  buyer_id VARCHAR(32) NOT NULL,
  seller_id VARCHAR(32) NOT NULL,
  rating INT NOT NULL,
  text VARCHAR(500) NOT NULL DEFAULT '',
  at BIGINT NOT NULL,
  CONSTRAINT fk_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_reviews_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_reviews_seller FOREIGN KEY (seller_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audits (
  id VARCHAR(32) PRIMARY KEY,
  item_id VARCHAR(32) NOT NULL,
  result VARCHAR(10) NOT NULL,
  reason VARCHAR(200) NOT NULL DEFAULT '',
  operator_id VARCHAR(32) NOT NULL,
  at BIGINT NOT NULL,
  CONSTRAINT fk_audits_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_audits_operator FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 物品履历：只追加不覆盖，详情页按时间正序展示。
CREATE TABLE IF NOT EXISTS item_history (
  id VARCHAR(32) PRIMARY KEY,
  item_id VARCHAR(32) NOT NULL,
  action VARCHAR(32) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  actor_id VARCHAR(32) NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  KEY idx_item_history_item_time (item_id, created_at),
  CONSTRAINT fk_item_history_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 两人置换：意向只表达“我的某件物品想换对方的某件物品”；
-- 双方意向互相指向时才生成方案，方案确认后生成两张 0 元置换单。
CREATE TABLE IF NOT EXISTS swap_intents (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  my_item_id VARCHAR(32) NOT NULL,
  target_item_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  KEY idx_swap_intents_user (user_id),
  KEY idx_swap_intents_target (target_item_id, status),
  CONSTRAINT fk_swap_intents_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_swap_intents_my_item FOREIGN KEY (my_item_id) REFERENCES items(id),
  CONSTRAINT fk_swap_intents_target_item FOREIGN KEY (target_item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS swap_plans (
  id VARCHAR(32) PRIMARY KEY,
  intent_a_id VARCHAR(32) NOT NULL,
  intent_b_id VARCHAR(32) NOT NULL,
  item_a_id VARCHAR(32) NOT NULL,
  item_b_id VARCHAR(32) NOT NULL,
  user_a_id VARCHAR(32) NOT NULL,
  user_b_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  confirm_deadline BIGINT NOT NULL,
  a_confirmed_at BIGINT NULL,
  b_confirmed_at BIGINT NULL,
  completed_at BIGINT NULL,
  cancelled_at BIGINT NULL,
  UNIQUE KEY uk_swap_plan_pair (intent_a_id, intent_b_id),
  KEY idx_swap_plans_user_a (user_a_id),
  KEY idx_swap_plans_user_b (user_b_id),
  CONSTRAINT fk_swap_plans_intent_a FOREIGN KEY (intent_a_id) REFERENCES swap_intents(id),
  CONSTRAINT fk_swap_plans_intent_b FOREIGN KEY (intent_b_id) REFERENCES swap_intents(id),
  CONSTRAINT fk_swap_plans_item_a FOREIGN KEY (item_a_id) REFERENCES items(id),
  CONSTRAINT fk_swap_plans_item_b FOREIGN KEY (item_b_id) REFERENCES items(id),
  CONSTRAINT fk_swap_plans_user_a FOREIGN KEY (user_a_id) REFERENCES users(id),
  CONSTRAINT fk_swap_plans_user_b FOREIGN KEY (user_b_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== 21 表补齐：内容、身份、交易、互动、治理 =====
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  parent_id VARCHAR(32) NULL,
  sort INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_categories_name (name),
  KEY idx_categories_parent (parent_id),
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_roster (
  student_no VARCHAR(32) PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  college VARCHAR(60) NOT NULL DEFAULT '',
  major VARCHAR(60) NOT NULL DEFAULT '',
  grade VARCHAR(20) NOT NULL DEFAULT '',
  class_name VARCHAR(40) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  imported_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS verification_records (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  student_no VARCHAR(32) NOT NULL,
  real_name VARCHAR(40) NOT NULL,
  college VARCHAR(60) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'approved',
  reason VARCHAR(200) NOT NULL DEFAULT '',
  reviewed_by VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT NULL,
  KEY idx_verification_user (user_id, created_at),
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_verification_roster FOREIGN KEY (student_no) REFERENCES student_roster(student_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS item_images (
  id VARCHAR(32) PRIMARY KEY,
  item_id VARCHAR(32) NOT NULL,
  url VARCHAR(500) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  is_primary TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  KEY idx_item_images_item (item_id, status, sort),
  CONSTRAINT fk_item_images_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS platform_accounts (
  id VARCHAR(32) PRIMARY KEY,
  account_type VARCHAR(20) NOT NULL,
  escrow_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_in DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_out DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uk_platform_account_type (account_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pickup_points (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  address VARCHAR(160) NOT NULL,
  contact VARCHAR(60) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_records (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL,
  method VARCHAR(20) NOT NULL DEFAULT 'face',
  pickup_point_id VARCHAR(32) NULL,
  pickup_code VARCHAR(20) NULL,
  delivered_at BIGINT NOT NULL,
  confirmed_at BIGINT NULL,
  operator_id VARCHAR(32) NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  UNIQUE KEY uk_delivery_order (order_id),
  KEY idx_delivery_pickup (pickup_point_id),
  CONSTRAINT fk_delivery_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_delivery_pickup FOREIGN KEY (pickup_point_id) REFERENCES pickup_points(id),
  CONSTRAINT fk_delivery_operator FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS credit_records (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  change_value INT NOT NULL,
  reason VARCHAR(120) NOT NULL,
  ref_type VARCHAR(20) NULL,
  ref_id VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  KEY idx_credit_user (user_id, created_at),
  CONSTRAINT fk_credit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  title VARCHAR(80) NOT NULL,
  body VARCHAR(300) NOT NULL DEFAULT '',
  read_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS favorites (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_favorite_user_item (user_id, item_id),
  KEY idx_favorites_item (item_id),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_favorites_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wanted_posts (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL,
  title VARCHAR(100) NOT NULL,
  category_id VARCHAR(32) NULL,
  keywords VARCHAR(160) NOT NULL DEFAULT '',
  budget_min DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  budget_max DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  condition_level VARCHAR(10) NOT NULL DEFAULT '90',
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NULL,
  KEY idx_wanted_status (status, created_at),
  KEY idx_wanted_user (user_id),
  CONSTRAINT fk_wanted_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_wanted_category FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS arbitration_requests (
  id VARCHAR(32) PRIMARY KEY,
  order_id VARCHAR(32) NOT NULL,
  applicant_id VARCHAR(32) NOT NULL,
  reason VARCHAR(300) NOT NULL,
  evidence VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  result VARCHAR(300) NOT NULL DEFAULT '',
  operator_id VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  decided_at BIGINT NULL,
  UNIQUE KEY uk_arbitration_order (order_id),
  KEY idx_arbitration_status (status, created_at),
  CONSTRAINT fk_arbitration_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_arbitration_applicant FOREIGN KEY (applicant_id) REFERENCES users(id),
  CONSTRAINT fk_arbitration_operator FOREIGN KEY (operator_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
