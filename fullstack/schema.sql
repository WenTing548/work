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
