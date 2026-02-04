CREATE TABLE IF NOT EXISTS schema_version(
    version INT
);
CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    guild_name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    member_count INTEGER DEFAULT 0,
    icon_hash TEXT,
    locale TEXT DEFAULT 'en-US',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK(
        channel_type IN ('text', 'voice', 'category', 'news', 'forum')
    ),
    is_nsfw BOOLEAN DEFAULT FALSE,
    position INTEGER DEFAULT 0,
    parent_id TEXT,
    topic TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tracking_types (
    type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name TEXT UNIQUE NOT NULL,
    module_name TEXT UNIQUE NOT NULL,
    description TEXT,
    default_check_interval INTEGER DEFAULT 3600,
    max_items_per_guild INTEGER DEFAULT 25,
    is_enabled BOOLEAN DEFAULT TRUE,
    config_schema TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tracked_items (
    item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_type_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    identifier TEXT NOT NULL,
    display_name TEXT,
    custom_check_interval INTEGER,
    last_checked TIMESTAMP,
    next_check TIMESTAMP,
    last_value TEXT,
    last_change_percentage REAL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_paused BOOLEAN DEFAULT FALSE,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    notify_on_change BOOLEAN DEFAULT TRUE,
    notify_on_discount BOOLEAN DEFAULT TRUE,
    min_change_percentage REAL DEFAULT 1.0,
    custom_message_template TEXT,
    metadata TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracking_type_id) REFERENCES tracking_types(type_id),
    FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id),
    UNIQUE(guild_id, tracking_type_id, identifier),
    CHECK(custom_check_interval >= 300)
);
CREATE TABLE IF NOT EXISTS tracking_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    value TEXT NOT NULL,
    change_percentage REAL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES tracked_items(item_id) ON DELETE CASCADE
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 1,
    reset_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);