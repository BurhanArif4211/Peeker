// src/database/connection.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.db = null;
        this.migrationPath = path.join(__dirname, 'migrations');
        this.schemaVersion = 1;
    }

    async initialize() {
        try {
            // Open database connection
            this.db = await open({
                filename: path.join(process.cwd(), process.env.DATABASE_PATH),
                driver: sqlite3.Database
            });

            // Enable foreign keys and WAL mode for better performance
            await this.db.exec(`
                PRAGMA foreign_keys = ON;
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                PRAGMA busy_timeout = 5000;
            `);

            // Check if schema exists
            await this.checkSchema();
            
            // Run migrations
            await this.runMigrations();
            
            // Seed tracking types
            await this.seedTrackingTypes();

            logger.info('Database initialized successfully');
            return this.db;
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    async checkSchema() {
        const tables = await this.db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='schema_version'
        `);

        if (tables.length === 0) {
            logger.info('Creating initial schema...');
            const schema = await fs.readFile(
                path.join(__dirname, 'schema.sql'), 
                'utf-8'
            );
            
            // Split by semicolon and execute each statement
            const statements = schema.split(';').filter(stmt => stmt.trim());
            
            for (const stmt of statements) {
                await this.db.exec(`${stmt};`);//add mission semi collon??s
            }
            
            await this.db.run(
                'INSERT INTO schema_version (version) VALUES (?)',
                [this.schemaVersion]
            );
        }
    }

    async runMigrations() {
        // Migration system implementation
        const currentVersion = await this.getCurrentVersion();
        
        if (currentVersion < this.schemaVersion) {
            logger.info(`Migrating from version ${currentVersion} to ${this.schemaVersion}`);
            // Run migration scripts
            // ... migration logic here
        }
    }

    async getCurrentVersion() {
        try {
            const result = await this.db.get(
                'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
            );
            return result ? result.version : 0;
        } catch (error) {
            return 0;
        }
    }

    async seedTrackingTypes() {
        const trackingTypes = [
            {
                type_name: 'steam',
                module_name: 'steam-tracker',
                description: 'Track Steam game prices and discounts',
                default_check_interval: 3600, // 1 hour
                max_items_per_guild: 20,
                config_schema: JSON.stringify({
                    type: 'object',
                    required: ['app_id'],
                    properties: {
                        app_id: { type: 'string', pattern: '^\\d+$' },
                        track_discounts: { type: 'boolean', default: true },
                        track_metacritic: { type: 'boolean', default: false },
                        region: { type: 'string', default: 'us' }
                    }
                })
            },
            {
                type_name: 'stock',
                module_name: 'stock-tracker',
                description: 'Track stock market prices',
                default_check_interval: 300, // 5 minutes during market hours
                max_items_per_guild: 15,
                config_schema: JSON.stringify({
                    type: 'object',
                    required: ['symbol'],
                    properties: {
                        symbol: { type: 'string', pattern: '^[A-Z]{1,5}$' },
                        exchange: { type: 'string', enum: ['NYSE', 'NASDAQ', 'OTC'] },
                        track_after_hours: { type: 'boolean', default: false }
                    }
                })
            },
            {
                type_name: 'product',
                module_name: 'product-tracker',
                description: 'Track product prices from various retailers',
                default_check_interval: 1800, // 30 minutes
                max_items_per_guild: 25,
                config_schema: JSON.stringify({
                    type: 'object',
                    required: ['url'],
                    properties: {
                        url: { type: 'string', format: 'uri' },
                        retailer: { type: 'string', enum: ['amazon', 'bestbuy', 'newegg'] },
                        selector: { type: 'string' } // CSS selector for price
                    }
                })
            }
        ];

        for (const type of trackingTypes) {
            await this.db.run(`
                INSERT OR IGNORE INTO tracking_types 
                (type_name, module_name, description, default_check_interval, max_items_per_guild, config_schema)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                type.type_name,
                type.module_name,
                type.description,
                type.default_check_interval,
                type.max_items_per_guild,
                type.config_schema
            ]);
        }
    }

    // Singleton pattern
    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }
}

module.exports = Database;
