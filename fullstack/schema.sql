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
