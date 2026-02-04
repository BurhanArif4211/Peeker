// src/modules/steam-tracker/index.js
const axios = require('axios');
const rateLimit = require('../../utils/rate-limiter');

class SteamTracker {
    static getType() {
        return 'steam';
    }

    static async fetch(params) {
        const { app_id, region = 'us' } = params;
        
        // Use rate limiter to respect API limits
        await rateLimit.wait('steam-api');
        
        try {
            const response = await axios.get(
                `https://store.steampowered.com/api/appdetails`,
                {
                    params: {
                        appids: app_id,
                        cc: region,
                        l: 'en'
                    },
                    headers: {
                        'User-Agent': 'Android 5.0 Kitkat; IPhone 17'
                    }
                }
            );

            const data = response.data[app_id];
            
            if (!data || !data.success) {
                throw new Error('Game not found or API error');
            }

            const game = data.data;
            
            return {
                price: game.price_overview?.final_formatted || 'N/A or 0',
                original_price: game.price_overview?.initial_formatted,
                discount_percent: game.price_overview?.discount_percent || 0,
                is_free: game.is_free || false,
                title: game.name,
                store_url: `https://store.steampowered.com/app/${app_id}`,
                metadata: {
                    release_date: game.release_date?.date,
                    metacritic_score: game.metacritic?.score,
                    categories: game.categories?.map(c => c.description),
                    genres: game.genres?.map(g => g.description)
                },
                fetched_at: new Date().toISOString()
            };
            
        } catch (error) {
            if (error.response?.status === 429) {
                rateLimit.penalize('steam-api');
                throw new Error('Rate limited by Steam API');
            }
            throw error;
        }
    }

    static getConfigSchema() {
        return {
            type: 'object',
            required: ['app_id'],
            properties: {
                app_id: {
                    type: 'string',
                    pattern: '^\\d+$',
                    description: 'Steam App ID'
                },
                region: {
                    type: 'string',
                    enum: ['us', 'eu', 'uk', 'ru', 'br', 'jp', 'kr', 'cn'],
                    default: 'us'
                },
                track_discounts: {
                    type: 'boolean',
                    default: true
                },
                track_metacritic: {
                    type: 'boolean',
                    default: false
                }
            }
        };
    }
}

module.exports = SteamTracker;
