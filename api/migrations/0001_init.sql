-- Homes table
CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT homes_name_not_empty CHECK (length(trim(name)) > 0)
);

-- Members table
CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  member_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT members_home_fk
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,

  CONSTRAINT members_name_not_empty
    CHECK (length(trim(name)) > 0),

  CONSTRAINT members_home_order_unique
    UNIQUE (home_id, member_order),

  CONSTRAINT members_order_positive
    CHECK (member_order > 0)
);

-- Bills table
CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT bills_home_fk
    FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,

  CONSTRAINT bills_title_not_empty
    CHECK (length(trim(title)) > 0),

  CONSTRAINT bills_total_positive
    CHECK (total_cents > 0)
);

-- Shares table
CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,

  CONSTRAINT shares_bill_fk
    FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,

  CONSTRAINT shares_member_fk
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,

  CONSTRAINT shares_bill_member_unique
    UNIQUE (bill_id, member_id),

  CONSTRAINT shares_amount_non_negative
    CHECK (amount_cents >= 0),

  CONSTRAINT shares_payment_state
    CHECK (
      (paid_at IS NULL AND idempotency_key IS NULL)
      OR
      (paid_at IS NOT NULL AND idempotency_key IS NOT NULL)
    )
);