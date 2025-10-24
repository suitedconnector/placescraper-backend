CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  tier VARCHAR(20) DEFAULT 'free',
  api_key_encrypted TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  search_name VARCHAR(255) NOT NULL,
  state VARCHAR(100),
  city VARCHAR(100),
  zip_codes TEXT,
  keywords TEXT,
  keyword_logic VARCHAR(10) DEFAULT 'OR',
  categories TEXT,
  results_limit INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  api_calls_made INTEGER NOT NULL,
  search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track search executions and outcomes
CREATE TABLE IF NOT EXISTS search_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  search_params JSONB NOT NULL,
  results_count INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Monthly API usage counter per user (resets via new row each month)
CREATE TABLE IF NOT EXISTS api_usage_monthly (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  month_year VARCHAR(7) NOT NULL, -- format YYYY-MM
  calls_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_search_activity_user_id ON search_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_monthly_user_month ON api_usage_monthly(user_id, month_year);

