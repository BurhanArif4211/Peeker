-- schema.sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- Insert initial version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);

CREATE TABLE IF NOT EXISTS guilds (
    guildId TEXT PRIMARY KEY,
    guildName TEXT NOT NULL,
    ownerId TEXT NOT NULL,
    isActive BOOLEAN DEFAULT TRUE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
    channelId TEXT PRIMARY KEY,
    guildId TEXT NOT NULL,
    channelName TEXT NOT NULL,
    channelType TEXT ,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guildId) REFERENCES guilds(guildId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tracking_types (
    typeId INTEGER PRIMARY KEY AUTOINCREMENT,
    typeName TEXT UNIQUE NOT NULL,
    moduleName TEXT UNIQUE NOT NULL,
    description TEXT,
    defaultCheckInterval INTEGER DEFAULT 3600, -- seconds
    maxItemsPerGuild INTEGER DEFAULT 25,
    isEnabled BOOLEAN DEFAULT TRUE,
    configSchema TEXT, -- JSON schema for validation
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert Steam tracker type
INSERT OR IGNORE INTO tracking_types (typeName, moduleName, description, defaultCheckInterval, maxItemsPerGuild) 
VALUES ('steam', 'steamTracker', 'Track Steam game prices', 3600, 20);

CREATE TABLE IF NOT EXISTS tracked_items (
    itemId INTEGER PRIMARY KEY AUTOINCREMENT,
    trackingTypeId INTEGER NOT NULL,
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    createdByUserId TEXT NOT NULL,
    
    -- Core tracking data
    identifier TEXT NOT NULL, -- Steam app ID
    displayName TEXT, -- Friendly name
    customCheckInterval INTEGER, -- Override default (seconds)
    lastChecked TIMESTAMP,
    nextCheck TIMESTAMP, -- Will be calculated in JS
    lastValue TEXT, -- Last price JSON
    lastChangePercentage REAL DEFAULT 0,
    
    -- State management
    isActive BOOLEAN DEFAULT TRUE,
    isPaused BOOLEAN DEFAULT FALSE,
    errorCount INTEGER DEFAULT 0,
    lastError TEXT,
    
    -- Notifications settings
    notifyOnChange BOOLEAN DEFAULT TRUE,
    notifyOnDiscount BOOLEAN DEFAULT TRUE,
    minChangePercentage REAL DEFAULT 1.0,
    
    -- Metadata
    metadata TEXT, -- JSON for game metadata
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (trackingTypeId) REFERENCES tracking_types(typeId),
    FOREIGN KEY (guildId) REFERENCES guilds(guildId) ON DELETE CASCADE,
    FOREIGN KEY (channelId) REFERENCES channels(channelId),
    
    -- Unique constraint per guild per game
    UNIQUE(guildId, trackingTypeId, identifier)
);

CREATE TABLE IF NOT EXISTS tracking_history (
    historyId INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL,
    value TEXT NOT NULL,
    price REAL,
    discountPercent INTEGER,
    detectedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (itemId) REFERENCES tracked_items(itemId) ON DELETE CASCADE
);