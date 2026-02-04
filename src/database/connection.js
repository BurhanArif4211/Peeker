// src/database/connection.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.db = null;
    }

    async initialize() {
        try {
            // Ensure data directory exists
            const dataDir = path.join(process.cwd(), 'data');
            try {
                await fs.access(dataDir);
            } catch {
                await fs.mkdir(dataDir, { recursive: true });
            }

            // Open database connection
            this.db = await open({
                filename: path.join(dataDir, 'tracker.db'),
                driver: sqlite3.Database
            });

            // Enable foreign keys and WAL mode
            await this.db.exec(`
                PRAGMA foreign_keys = ON;
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
            `);

            // Create schema if it doesn't exist
            await this.createSchema();
            
            logger.info('Database initialized successfully');
            return this.db;
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    async createSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = await fs.readFile(schemaPath, 'utf-8');
        
        // Execute schema
        await this.db.exec(schema);
        logger.info('Database schema created/verified');
    }

    // Singleton instance
    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }
}

module.exports = Database;