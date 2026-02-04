// src/commands/parser.js
const logger = require('../utils/logger');

class CommandParser {
    constructor(db) {
        this.db = db;
        // Register parsers for different tracker types
        this.parsers = {
            'steam': this.parseSteamInput.bind(this)
        };
        
        // Future: Add more parsers here
        // this.parsers['stock'] = this.parseStockInput.bind(this);
    }

    async parse(input, trackerType = 'steam') {
        const parser = this.parsers[trackerType];
        
        if (!parser) {
            return {
                success: false,
                error: `No parser available for tracker type: ${trackerType}`
            };
        }

        try {
            return await parser(input);
        } catch (error) {
            logger.error('Parse error:', error);
            return {
                success: false,
                error: `Failed to parse input: ${error.message}`
            };
        }
    }

    async parseSteamInput(input) {
        // Clean input
        const cleanInput = input.trim();
        
        // Extract app ID
        const SteamTracker = require('../modules/steamTracker');
        const appId = SteamTracker.extractAppId(cleanInput);
        
        if (!appId) {
            return {
                success: false,
                error: 'Could not extract Steam App ID from input. Please provide a valid Steam store URL or App ID.'
            };
        }

        // Validate the app ID
        const validation = SteamTracker.validateIdentifier(appId);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error
            };
        }

        // Optional: Fetch game name for display
        let displayName = null;
        try {
            const gameInfo = await SteamTracker.fetch({ identifier: appId });
            displayName = gameInfo.name;
        } catch (error) {
            // If we can't fetch the name, we'll use the app ID as display
            logger.warn(`Could not fetch game name for app ID ${appId}:`, error.message);
        }

        return {
            success: true,
            trackerType: 'steam',
            identifier: appId,
            displayName: displayName,
            metadata: validation.metadata
        };
    }

    // Future: Add more parser methods for other tracker types
    // async parseStockInput(input) { ... }
    // async parseProductInput(input) { ... }
}

module.exports = CommandParser;