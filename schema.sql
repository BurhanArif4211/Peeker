-- schema.sql
-- Version: 1.0.0

-- ==================== CORE TABLES ====================
CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    guild_name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    member_count INTEGER DEFAULT 0,
    icon_hash TEXT,
    locale TEXT DEFAULT 'en-US',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_guilds_active (is_active)
);

CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK(channel_type IN ('text', 'voice', 'category', 'news', 'forum')),
    is_nsfw BOOLEAN DEFAULT FALSE,
    position INTEGER DEFAULT 0,
    parent_id TEXT,
    topic TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    INDEX idx_channels_guild (guild_id, channel_type)
);

-- ==================== TRACKING SYSTEM ====================
CREATE TABLE IF NOT EXISTS tracking_types (
    type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name TEXT UNIQUE NOT NULL,           -- 'steam', 'stock', 'product', 'crypto'
    module_name TEXT UNIQUE NOT NULL,         -- Associated module
    description TEXT,
    default_check_interval INTEGER DEFAULT 3600, -- seconds
    max_items_per_guild INTEGER DEFAULT 25,
    is_enabled BOOLEAN DEFAULT TRUE,
    config_schema TEXT,                       -- JSON schema for validation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracked_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_type_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    
    -- Core tracking data
    identifier TEXT NOT NULL,                 -- Steam app ID, stock symbol, product URL
    display_name TEXT,                        -- Friendly name for display
    custom_check_interval INTEGER,            -- Override default (seconds)
    last_checked TIMESTAMP,
    next_check TIMESTAMP GENERATED ALWAYS AS (
        CASE 
            WHEN last_checked IS NULL THEN CURRENT_TIMESTAMP
            ELSE datetime(last_checked, '+' || COALESCE(custom_check_interval, 
                   (SELECT default_check_interval FROM tracking_types WHERE type_id = tracked_items.tracking_type_id)) || ' seconds')
        END
    ) VIRTUAL,
    last_value TEXT,                          -- Last retrieved value (JSON)
    last_change_percentage REAL DEFAULT 0,
    
    -- State management
    is_active BOOLEAN DEFAULT TRUE,
    is_paused BOOLEAN DEFAULT FALSE,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    
    -- Notifications settings
    notify_on_change BOOLEAN DEFAULT TRUE,
    notify_on_discount BOOLEAN DEFAULT TRUE,
    min_change_percentage REAL DEFAULT 1.0,   -- Minimum % change to notify
    custom_message_template TEXT,
    
    -- Metadata
    metadata TEXT,                            -- JSON for type-specific data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (tracking_type_id) REFERENCES tracking_types(type_id),
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id),
    
    -- Constraints
    UNIQUE(guild_id, tracking_type_id, identifier),
    CHECK(custom_check_interval >= 300),      -- Minimum 5 minutes
    
    -- Indexes for performance
    INDEX idx_tracked_items_active (is_active, is_paused),
    INDEX idx_tracked_items_next_check (next_check),
    INDEX idx_tracked_items_guild (guild_id, tracking_type_id),
    INDEX idx_tracked_items_identifier (tracking_type_id, identifier)
);

CREATE TABLE IF NOT EXISTS tracking_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    value TEXT NOT NULL,                      -- JSON value at time of check
    change_percentage REAL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (item_id) REFERENCES tracked_items(item_id) ON DELETE CASCADE,
    INDEX idx_tracking_history_item (item_id, detected_at DESC),
    INDEX idx_tracking_history_time (detected_at DESC)
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    preference_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (user_id, guild_id, preference_key),
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
);

-- ==================== AUDIT LOG ====================
CREATE TABLE IF NOT EXISTS audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_audit_guild (guild_id, created_at DESC),
    INDEX idx_audit_user (user_id, created_at DESC)
);

-- ==================== RATE LIMITING ====================
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 1,
    reset_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
