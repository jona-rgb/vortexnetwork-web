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
  } else {
    try {
      const body = JSON.parse(event.body || '{}');
      playerName = body.name;
    } catch(e) { playerName = null; }
  }

  if (!playerName || !/^[a-zA-Z0-9_]{3,16}$/.test(playerName)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: true, message: 'Nombre inválido' }),
    };
  }

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // 1. Buscar jugador
    const [userRows] = await connection.execute(
      `SELECT id, uuid, name, registered FROM plan_users WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [playerName]
    );

    if (userRows.length === 0) {
      await connection.end();
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: true, message: 'Jugador no encontrado' }),
      };
    }

    const user = userRows[0];
    const uuid = user.uuid;
    const userId = user.id;

    // 2. Playtime desde sessions
    let finalHours = 0, finalMinutes = 0;
    try {
      const [sessionRows] = await connection.execute(
        `SELECT COALESCE(SUM(session_end - session_start), 0) as total_ms
         FROM plan_sessions WHERE user_id = ?`,
        [userId]
      );
      const ms = parseInt(sessionRows[0]?.total_ms || 0);
      finalHours   = Math.floor(ms / (1000 * 60 * 60));
      finalMinutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    } catch(e) { console.log('sessions error:', e.message); }

    // 3. Obtener todos los providers disponibles (para debug)
    let allProviders = [];
    try {
      const [provRows] = await connection.execute(
        `SELECT ep.id, ep.provider_name, ep.text, ep.plugin_id
         FROM plan_extension_providers ep`
      );
      allProviders = provRows;
    } catch(e) { console.log('providers error:', e.message); }

    // 4. Obtener todos los valores del jugador desde plan_extension_user_values
    let allValues = [];
    try {
      const [valRows] = await connection.execute(
        `SELECT provider_id, string_value, double_value, long_value, group_value
         FROM plan_extension_user_values WHERE uuid = ?`,
        [uuid]
      );
      allValues = valRows;
    } catch(e) { console.log('user_values error:', e.message); }

    // 5. Cruzar valores con providers
    let rank = null, money = null, points = null, kills = 0, deaths = 0;

    for (const val of allValues) {
      const provider = allProviders.find(p => p.id === val.provider_id);
      if (!provider) continue;

      const provName = (provider.provider_name || '').toLowerCase();
      const text     = (provider.text || '').toLowerCase();

      // RANK
      if (provName.includes('prefix') || provName.includes('group') || provName.includes('rank')) {
        rank = val.string_value || val.group_value || rank;
      }

      // MONEY
      if (provName.includes('balance') || provName.includes('money') || provName.includes('eco') ||
          text.includes('balance') || text.includes('money')) {
        money = val.double_value ?? val.string_value ?? money;
      }

      // POINTS
      if (provName.includes('point') || text.includes('point')) {
        points = val.long_value ?? val.double_value ?? parseInt(val.string_value) ?? points;
      }

      // KILLS
      if (provName.includes('player_kill') || provName.includes('kills') ||
          text.includes('kill')) {
        kills = val.long_value ?? val.double_value ?? kills;
      }

      // DEATHS
      if (provName.includes('death') || text.includes('death')) {
        deaths = val.long_value ?? val.double_value ?? deaths;
      }
    }

    await connection.end();

    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toString();
    const playtimeFormatted = finalHours > 0
      ? `${finalHours}h ${finalMinutes}m`
      : `${finalMinutes}m`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        player: {
          name: user.name,
          uuid: uuid,
          playtime: {
            hours: finalHours,
            minutes: finalMinutes,
            formatted: playtimeFormatted,
          },
          kills,
          deaths,
          kd,
          rank,
          money,
          points,
          headUrl:   `https://crafthead.net/helm/${uuid}/120`,
          avatarUrl: `https://crafthead.net/avatar/${uuid}/64`,
        },
        // DEBUG: muestra todos los providers y valores encontrados
        _debug: {
          totalProviders: allProviders.length,
          totalValues: allValues.length,
          providers: allProviders.map(p => `[${p.id}] ${p.provider_name} | ${p.text}`),
          values: allValues.map(v => {
            const p = allProviders.find(pr => pr.id === v.provider_id);
            return `provider: ${p?.provider_name || v.provider_id} | str: ${v.string_value} | dbl: ${v.double_value} | lng: ${v.long_value} | grp: ${v.group_value}`;
          })
        }
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
          code: error.code || 'UNKNOWN',
          message: error.message,
          sql: error.sql || null,
          sqlMessage: error.sqlMessage || null,
        }
      }),
    };
  }
};
