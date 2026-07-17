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
    let playtimeMs = 0;
    try {
      const [playtimeRows] = await connection.execute(
        `SELECT COALESCE(SUM(session_end - session_start), 0) as total_playtime
         FROM plan_sessions 
         WHERE user_id = ?`,
        [odljugadorId]
      );
      playtimeMs = parseInt(playtimeRows[0]?.total_playtime || 0);
    } catch (e) {
      console.log('Could not fetch playtime:', e.message);
    }

    // 3. Get kills and deaths from plan_user_info (primary source)
    let deaths = 0;
    let playerKills = 0;
    let mobKills = 0;
    
    try {
      const [userInfoRows] = await connection.execute(
        `SELECT 
          COALESCE(SUM(deaths), 0) as total_deaths,
          COALESCE(SUM(death_count), 0) as death_count,
          COALESCE(SUM(mob_kill_count), 0) as mob_kills,
          COALESCE(SUM(player_kill_count), 0) as player_kills
         FROM plan_user_info 
         WHERE user_id = ?`,
        [odljugadorId]
      );
      
      if (userInfoRows.length > 0) {
        const info = userInfoRows[0];
        deaths = parseInt(info.total_deaths || info.death_count || 0);
        mobKills = parseInt(info.mob_kills || 0);
        playerKills = parseInt(info.player_kills || 0);
      }
    } catch (e) {
      console.log('Could not fetch from plan_user_info:', e.message);
      
      // Fallback: try alternative column names
      try {
        const [altRows] = await connection.execute(
          `SELECT 
            COALESCE(SUM(deathCount), 0) as deaths,
            COALESCE(SUM(mobKillCount), 0) as mob_kills,
            COALESCE(SUM(playerKillCount), 0) as player_kills
           FROM plan_user_info 
           WHERE user_id = ?`,
          [odljugadorId]
        );
        
        if (altRows.length > 0) {
          deaths = parseInt(altRows[0].deaths || 0);
          mobKills = parseInt(altRows[0].mob_kills || 0);
          playerKills = parseInt(altRows[0].player_kills || 0);
        }
      } catch (e2) {
        console.log('Alternative column names also failed:', e2.message);
      }
    }

    // 4. Fallback: Get kills from plan_kills table if plan_user_info didn't have player kills
    if (playerKills === 0) {
      try {
        const [killRows] = await connection.execute(
          `SELECT COUNT(*) as kill_count
           FROM plan_kills 
           WHERE killer_uuid = ?`,
          [playerUuid]
        );
        playerKills = parseInt(killRows[0]?.kill_count || 0);
      } catch (e) {
        console.log('Could not fetch kills from plan_kills:', e.message);
      }
    }

    // Total kills (player + mob)
    const totalKills = playerKills + mobKills;

    // 5. Get ALL extension data for this player with correct JOIN structure
    // plan_extension_plugins -> plan_extension_providers -> plan_extension_player_values
    let rank = null;
    let money = null;
    let points = null;
    
    try {
      const [extensionRows] = await connection.execute(
        `SELECT 
          epv.string_value, 
          epv.double_value, 
          epv.long_value,
          ep.provider_name, 
          ep.text,
          epl.name as plugin_name
         FROM plan_extension_player_values epv
         JOIN plan_extension_providers ep ON epv.provider_id = ep.id
         JOIN plan_extension_plugins epl ON ep.plugin_id = epl.id
         WHERE epv.user_id = ?
         AND epl.name IN ('LuckPerms', 'Essentials', 'PlayerPoints', 'Vault', 'EssentialsX')`,
        [odljugadorId]
      );
      
      // Process each extension value
      for (const row of extensionRows) {
        const pluginName = row.plugin_name?.toLowerCase() || '';
        const providerName = row.provider_name?.toLowerCase() || '';
        const text = row.text?.toLowerCase() || '';
        
        // LuckPerms - Rank/Group
        if (pluginName === 'luckperms' || pluginName.includes('luckperms')) {
          if (providerName.includes('group') || providerName.includes('rank') || 
              text.includes('group') || text.includes('rank') || text.includes('primary')) {
            if (row.string_value && !rank) {
              rank = row.string_value;
            }
          }
        }
        
        // Essentials/Vault - Money/Balance
        if (pluginName === 'essentials' || pluginName === 'essentialsx' || 
            pluginName === 'vault' || pluginName.includes('economy')) {
          if (providerName.includes('balance') || providerName.includes('money') || 
              text.includes('balance') || text.includes('money') || text.includes('dinero')) {
            if (row.double_value !== null && money === null) {
              money = row.double_value;
            } else if (row.string_value && money === null) {
              money = parseFloat(row.string_value) || null;
            }
          }
        }
        
        // PlayerPoints - Points
        if (pluginName === 'playerpoints' || pluginName.includes('points')) {
          if (row.long_value !== null && points === null) {
            points = parseInt(row.long_value);
          } else if (row.double_value !== null && points === null) {
            points = parseInt(row.double_value);
          } else if (row.string_value && points === null) {
            points = parseInt(row.string_value) || null;
          }
        }
      }
      
      // Debug: Log what we found
      console.log(`Found ${extensionRows.length} extension rows for player ${playerName}`);
      console.log('Extension data:', JSON.stringify(extensionRows.slice(0, 5))); // Log first 5
      
    } catch (e) {
      console.log('Could not fetch extension data:', e.message);
    }

    // 6. If we still don't have rank, try a broader search
    if (!rank) {
      try {
        const [rankRows] = await connection.execute(
          `SELECT 
            epv.string_value, 
            ep.provider_name, 
            ep.text,
            epl.name as plugin_name
           FROM plan_extension_player_values epv
           JOIN plan_extension_providers ep ON epv.provider_id = ep.id
           JOIN plan_extension_plugins epl ON ep.plugin_id = epl.id
           WHERE epv.user_id = ?
           AND epv.string_value IS NOT NULL
           AND epv.string_value != ''
           AND (
             ep.text LIKE '%rank%' OR 
             ep.text LIKE '%group%' OR 
             ep.text LIKE '%prefix%' OR
             ep.provider_name LIKE '%rank%' OR 
             ep.provider_name LIKE '%group%'
           )
           LIMIT 1`,
          [odljugadorId]
        );
        
        if (rankRows.length > 0 && rankRows[0].string_value) {
          rank = rankRows[0].string_value;
        }
      } catch (e) {
        console.log('Broader rank search failed:', e.message);
      }
    }

    // 7. If we still don't have money, try a broader search
    if (money === null) {
      try {
        const [moneyRows] = await connection.execute(
          `SELECT 
            epv.double_value,
            epv.string_value,
            ep.provider_name, 
            ep.text,
            epl.name as plugin_name
           FROM plan_extension_player_values epv
           JOIN plan_extension_providers ep ON epv.provider_id = ep.id
           JOIN plan_extension_plugins epl ON ep.plugin_id = epl.id
           WHERE epv.user_id = ?
           AND (epv.double_value IS NOT NULL OR epv.string_value REGEXP '^[0-9]')
           AND (
             ep.text LIKE '%balance%' OR 
             ep.text LIKE '%money%' OR 
             ep.text LIKE '%dinero%' OR
             ep.provider_name LIKE '%balance%' OR 
             ep.provider_name LIKE '%money%'
           )
           LIMIT 1`,
          [odljugadorId]
        );
        
        if (moneyRows.length > 0) {
          money = moneyRows[0].double_value || parseFloat(moneyRows[0].string_value) || null;
        }
      } catch (e) {
        console.log('Broader money search failed:', e.message);
      }
    }

    // 8. If we still don't have points, try a broader search
    if (points === null) {
      try {
        const [pointsRows] = await connection.execute(
          `SELECT 
            epv.long_value,
            epv.double_value,
            epv.string_value,
            ep.provider_name, 
            ep.text,
            epl.name as plugin_name
           FROM plan_extension_player_values epv
           JOIN plan_extension_providers ep ON epv.provider_id = ep.id
           JOIN plan_extension_plugins epl ON ep.plugin_id = epl.id
           WHERE epv.user_id = ?
           AND (epv.long_value IS NOT NULL OR epv.double_value IS NOT NULL)
           AND (
             ep.text LIKE '%point%' OR 
             ep.text LIKE '%punto%' OR
             ep.provider_name LIKE '%point%'
           )
           LIMIT 1`,
          [odljugadorId]
        );
        
        if (pointsRows.length > 0) {
          points = parseInt(pointsRows[0].long_value || pointsRows[0].double_value) || null;
        }
      } catch (e) {
        console.log('Broader points search failed:', e.message);
      }
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
          kills: totalKills,
          playerKills: playerKills,
          mobKills: mobKills,
          kd: deaths > 0 ? (totalKills / deaths).toFixed(2) : totalKills.toString(),
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
        debug: {
          code: error.code || 'UNKNOWN',
          errno: error.errno || null,
          sqlState: error.sqlState || null,
          sqlMessage: error.sqlMessage || error.message,
          fullError: error.toString(),
        },
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
