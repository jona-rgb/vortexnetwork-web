const mysql = require('mysql2/promise');

// Database configuration - Uses environment variables for security
// Railway requires SSL connection
const dbConfig = {
  host: process.env.MYSQL_HOST || 'tokaido.proxy.rlwy.net',
  port: parseInt(process.env.MYSQL_PORT || '46214'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'railway',
  connectTimeout: 15000,
  // Railway requires SSL
  ssl: {
    rejectUnauthorized: false
  }
};

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Get player name from query string or body
  let playerName;
  
  if (event.httpMethod === 'GET') {
    playerName = event.queryStringParameters?.name;
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      playerName = body.name;
    } catch (e) {
      playerName = null;
    }
  }

  if (!playerName) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: true, 
        message: 'Se requiere el parámetro "name"' 
      }),
    };
  }

  // Validate player name format
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(playerName)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: true, 
        message: 'Nombre de usuario inválido' 
      }),
    };
  }

  let connection;

  try {
    // Connect to MySQL with SSL
    connection = await mysql.createConnection(dbConfig);

    // 1. Get player UUID and basic info from plan_users
    const [userRows] = await connection.execute(
      `SELECT id, uuid, name, registered, times_kicked 
       FROM plan_users 
       WHERE LOWER(name) = LOWER(?)
       LIMIT 1`,
      [playerName]
    );

    if (userRows.length === 0) {
      await connection.end();
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: true, 
          message: 'Jugador no encontrado en el servidor' 
        }),
      };
    }

    const user = userRows[0];
    const playerUuid = user.uuid;
    const odljugadorId = user.id;

    // 2. Get total playtime from plan_sessions
    const [playtimeRows] = await connection.execute(
      `SELECT COALESCE(SUM(session_end - session_start), 0) as total_playtime
       FROM plan_sessions 
       WHERE user_id = ?`,
      [odljugadorId]
    );
    const playtimeMs = parseInt(playtimeRows[0]?.total_playtime || 0);

    // 3. Get deaths - Try plan_user_info first
    let deaths = 0;
    try {
      const [deathRows] = await connection.execute(
        `SELECT COALESCE(SUM(deaths), 0) as total_deaths
         FROM plan_user_info 
         WHERE user_id = ?`,
        [odljugadorId]
      );
      deaths = parseInt(deathRows[0]?.total_deaths || 0);
    } catch (e) {
      console.log('Could not fetch deaths from plan_user_info:', e.message);
    }

    // 4. Get kills from plan_kills
    let kills = 0;
    try {
      const [killRows] = await connection.execute(
        `SELECT COUNT(*) as kill_count
         FROM plan_kills 
         WHERE killer_uuid = ?`,
        [playerUuid]
      );
      kills = parseInt(killRows[0]?.kill_count || 0);
    } catch (e) {
      console.log('Could not fetch kills:', e.message);
    }

    // 5. Get LuckPerms rank from plan_extension_player_values
    let rank = null;
    try {
      // First get the provider ID for LuckPerms
      const [providerRows] = await connection.execute(
        `SELECT id FROM plan_extension_providers 
         WHERE provider_name = 'LuckPerms' OR plugin_name = 'LuckPerms'
         LIMIT 1`
      );
      
      if (providerRows.length > 0) {
        const [rankRows] = await connection.execute(
          `SELECT string_value, group_value
           FROM plan_extension_player_values 
           WHERE user_id = ? AND provider_id = ?
           LIMIT 1`,
          [odljugadorId, providerRows[0].id]
        );
        
        if (rankRows.length > 0) {
          rank = rankRows[0].string_value || rankRows[0].group_value;
        }
      }
      
      // Alternative: Try to find any LuckPerms related data
      if (!rank) {
        const [altRankRows] = await connection.execute(
          `SELECT epv.string_value, epv.group_value, ep.text 
           FROM plan_extension_player_values epv
           JOIN plan_extension_providers ep ON epv.provider_id = ep.id
           WHERE epv.user_id = ? 
           AND (ep.provider_name LIKE '%LuckPerms%' OR ep.plugin_name LIKE '%LuckPerms%' OR ep.text LIKE '%rank%' OR ep.text LIKE '%group%')
           LIMIT 1`,
          [odljugadorId]
        );
        
        if (altRankRows.length > 0) {
          rank = altRankRows[0].string_value || altRankRows[0].group_value;
        }
      }
    } catch (e) {
      console.log('Could not fetch rank:', e.message);
    }

    // 6. Get money from Essentials/Vault
    let money = null;
    try {
      const [moneyRows] = await connection.execute(
        `SELECT epv.double_value, epv.string_value, ep.provider_name, ep.text
         FROM plan_extension_player_values epv
         JOIN plan_extension_providers ep ON epv.provider_id = ep.id
         WHERE epv.user_id = ? 
         AND (ep.provider_name IN ('Essentials', 'Vault', 'Economy') 
              OR ep.text LIKE '%balance%' 
              OR ep.text LIKE '%money%'
              OR ep.text LIKE '%dinero%')
         LIMIT 1`,
        [odljugadorId]
      );
      
      if (moneyRows.length > 0) {
        money = moneyRows[0].double_value || parseFloat(moneyRows[0].string_value) || null;
      }
    } catch (e) {
      console.log('Could not fetch money:', e.message);
    }

    // 7. Try to get PlayerPoints
    let points = null;
    try {
      const [pointsRows] = await connection.execute(
        `SELECT epv.long_value, epv.double_value, epv.string_value
         FROM plan_extension_player_values epv
         JOIN plan_extension_providers ep ON epv.provider_id = ep.id
         WHERE epv.user_id = ? 
         AND (ep.provider_name = 'PlayerPoints' 
              OR ep.plugin_name = 'PlayerPoints'
              OR ep.text LIKE '%points%'
              OR ep.text LIKE '%puntos%')
         LIMIT 1`,
        [odljugadorId]
      );
      
      if (pointsRows.length > 0) {
        points = pointsRows[0].long_value || pointsRows[0].double_value || parseInt(pointsRows[0].string_value) || null;
      }
    } catch (e) {
      console.log('Could not fetch points:', e.message);
    }

    // Close connection
    await connection.end();

    // Format playtime
    const hours = Math.floor(playtimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((playtimeMs % (1000 * 60 * 60)) / (1000 * 60));

    // Return player data
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        player: {
          name: user.name,
          uuid: playerUuid,
          odljugadorDb: odljugadorId,
          registered: user.registered,
          playtime: {
            ms: playtimeMs,
            hours: hours,
            minutes: minutes,
            formatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
          },
          deaths: deaths,
          kills: kills,
          kd: deaths > 0 ? (kills / deaths).toFixed(2) : kills.toString(),
          rank: rank,
          money: money,
          points: points,
          headUrl: `https://crafthead.net/helm/${playerUuid}/120`,
          avatarUrl: `https://crafthead.net/avatar/${playerUuid}/64`,
        },
      }),
    };

  } catch (error) {
    console.error('Database error:', error);
    
    if (connection) {
      try {
        await connection.end();
      } catch (e) {
        // Ignore close errors
      }
    }

    // Return the REAL error for debugging
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: true, 
        message: 'Error de base de datos',
        // Show real error details for debugging
        debug: {
          code: error.code || 'UNKNOWN',
          errno: error.errno || null,
          sqlState: error.sqlState || null,
          sqlMessage: error.sqlMessage || error.message,
          fullError: error.toString(),
        },
        // Also show connection config (without password) for verification
        connectionInfo: {
          host: dbConfig.host,
          port: dbConfig.port,
          user: dbConfig.user,
          database: dbConfig.database,
          hasPassword: !!dbConfig.password,
          passwordLength: dbConfig.password ? dbConfig.password.length : 0,
          ssl: 'enabled (rejectUnauthorized: false)',
        }
      }),
    };
  }
};
