const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'tokaido.proxy.rlwy.net',
  port: parseInt(process.env.MYSQL_PORT || '46214'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'railway',
  connectTimeout: 15000,
  ssl: { rejectUnauthorized: false }
};

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let playerName;
  if (event.httpMethod === 'GET') {
    playerName = event.queryStringParameters?.name;
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      playerName = body.name;
    } catch (e) { playerName = null; }
  }

  if (!playerName) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: true, message: 'Se requiere el parámetro "name"' }),
    };
  }

  if (!/^[a-zA-Z0-9_]{3,16}$/.test(playerName)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: true, message: 'Nombre de usuario inválido' }),
    };
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // 1. Obtener jugador
    const [userRows] = await connection.execute(
      `SELECT id, uuid, name, registered FROM plan_users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [playerName]
    );

    if (userRows.length === 0) {
      await connection.end();
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: true, message: 'Jugador no encontrado en el servidor' }),
      };
    }

    const user = userRows[0];
    const playerUuid = user.uuid;

    // 2. Obtener TODOS los valores de extensiones del jugador
    const [extRows] = await connection.execute(
      `SELECT 
        euv.string_value,
        euv.double_value,
        euv.long_value,
        euv.group_value,
        ep.provider_name,
        ep.text,
        epl.name as plugin_name
       FROM plan_extension_user_values euv
       JOIN plan_extension_providers ep ON ep.id = euv.provider_id
       JOIN plan_extension_plugins epl ON epl.id = ep.plugin_id
       WHERE euv.uuid = ?`,
      [playerUuid]
    );

    // 3. Parsear valores buscando los placeholders del scoreboard
    let rank = null;
    let money = null;
    let points = null;
    let kills = 0;
    let deaths = 0;
    let daysPlayed = 0;
    let hoursPlayed = 0;
    let playtimeFormatted = null;

    for (const row of extRows) {
      const provName = (row.provider_name || '').toLowerCase();
      const text    = (row.text || '').toLowerCase();
      const plugin  = (row.plugin_name || '').toLowerCase();

      // RANK - LuckPerms prefix/group
      if (
        plugin.includes('luckperms') ||
        provName.includes('luckperms') ||
        provName.includes('prefix') ||
        provName.includes('luckperms_prefix')
      ) {
        if (row.string_value || row.group_value) {
          rank = row.string_value || row.group_value;
        }
      }

      // MONEY - Vault / Essentials balance
      if (
        plugin.includes('vault') ||
        plugin.includes('essentials') ||
        provName.includes('balance') ||
        provName.includes('vault_eco') ||
        provName.includes('money') ||
        text.includes('balance') ||
        text.includes('money')
      ) {
        if (row.double_value !== null && row.double_value !== undefined) {
          money = row.double_value;
        } else if (row.string_value) {
          money = row.string_value;
        }
      }

      // POINTS - PlayerPoints
      if (
        plugin.includes('playerpoints') ||
        provName.includes('playerpoints') ||
        provName.includes('points') ||
        text.includes('points') ||
        text.includes('puntos')
      ) {
        if (row.long_value !== null && row.long_value !== undefined) {
          points = row.long_value;
        } else if (row.double_value !== null && row.double_value !== undefined) {
          points = row.double_value;
        } else if (row.string_value) {
          points = parseInt(row.string_value) || row.string_value;
        }
      }

      // KILLS - statistic_player_kills
      if (
        provName.includes('player_kill') ||
        provName.includes('playerkill') ||
        text.includes('player kill') ||
        text.includes('kills')
      ) {
        if (row.long_value !== null && row.long_value !== undefined) kills = row.long_value;
        else if (row.double_value !== null) kills = row.double_value;
      }

      // DEATHS - statistic_deaths
      if (
        provName.includes('death') ||
        text.includes('death') ||
        text.includes('muerte')
      ) {
        if (row.long_value !== null && row.long_value !== undefined) deaths = row.long_value;
        else if (row.double_value !== null) deaths = row.double_value;
      }

      // DAYS PLAYED - statistic_days_played
      if (provName.includes('days_played') || text.includes('days played')) {
        if (row.long_value !== null && row.long_value !== undefined) daysPlayed = row.long_value;
        else if (row.double_value !== null) daysPlayed = row.double_value;
      }

      // HOURS PLAYED - statistic_hours_played
      if (provName.includes('hours_played') || text.includes('hours played')) {
        if (row.long_value !== null && row.long_value !== undefined) hoursPlayed = row.long_value;
        else if (row.double_value !== null) hoursPlayed = row.double_value;
      }
    }

    // 4. Calcular playtime total
    // Primero intentamos con los placeholders de estadísticas
    let finalHours = (daysPlayed * 24) + hoursPlayed;
    let finalMinutes = 0;

    // Si no hay datos de placeholders, usamos plan_sessions como respaldo
    if (finalHours === 0) {
      const [sessionRows] = await connection.execute(
        `SELECT COALESCE(SUM(session_end - session_start), 0) as total_ms
         FROM plan_sessions WHERE user_id = ?`,
        [user.id]
      );
      const playtimeMs = parseInt(sessionRows[0]?.total_ms || 0);
      finalHours   = Math.floor(playtimeMs / (1000 * 60 * 60));
      finalMinutes = Math.floor((playtimeMs % (1000 * 60 * 60)) / (1000 * 60));
    }

    playtimeFormatted = finalHours > 0
      ? `${finalHours}h ${finalMinutes}m`
      : `${finalMinutes}m`;

    await connection.end();

    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toString();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        player: {
          name: user.name,
          uuid: playerUuid,
          registered: user.registered,
          playtime: {
            hours: finalHours,
            minutes: finalMinutes,
            formatted: playtimeFormatted,
          },
          deaths:  deaths,
          kills:   kills,
          kd:      kd,
          rank:    rank,
          money:   money,
          points:  points,
          headUrl:   `https://crafthead.net/helm/${playerUuid}/120`,
          avatarUrl: `https://crafthead.net/avatar/${playerUuid}/64`,
          _debug: {
            totalExtRows: extRows.length,
            providers: extRows.map(r =>
              `[${r.plugin_name}] ${r.provider_name} | text: ${r.text} | str: ${r.string_value} | dbl: ${r.double_value} | lng: ${r.long_value} | grp: ${r.group_value}`
            )
          }
        },
      }),
    };

  } catch (error) {
    console.error('DB Error:', error);
    if (connection) { try { await connection.end(); } catch(e) {} }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: true,
        message: 'Error de base de datos',
        debug: {
          code: error.code,
          message: error.message,
          sqlMessage: error.sqlMessage || null,
        }
      }),
    };
  }
};
