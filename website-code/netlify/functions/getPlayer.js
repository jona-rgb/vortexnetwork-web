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

    // 3. Obtener columnas reales de plan_extension_providers
    // La columna correcta es "name" NO "provider_name"
    let allProviders = [];
    try {
      const [provRows] = await connection.execute(
        `SELECT id, name, text, plugin_id FROM plan_extension_providers`
      );
      allProviders = provRows;
    } catch(e) { console.log('providers error:', e.message); }

    // 4. Obtener plugins para saber a qué plugin pertenece cada provider
    let allPlugins = [];
    try {
      const [plugRows] = await connection.execute(
        `SELECT id, name FROM plan_extension_plugins`
      );
      allPlugins = plugRows;
    } catch(e) { console.log('plugins error:', e.message); }

    // 5. Obtener valores del jugador
    let allValues = [];
    try {
      const [valRows] = await connection.execute(
        `SELECT provider_id, string_value, double_value, long_value, group_value
         FROM plan_extension_user_values WHERE uuid = ?`,
        [uuid]
      );
      allValues = valRows;
    } catch(e) { console.log('user_values error:', e.message); }

    // 6. Cruzar valores con providers y plugins
    let rank = null, money = null, points = null, kills = 0, deaths = 0;

    for (const val of allValues) {
      const provider = allProviders.find(p => p.id === val.provider_id);
      if (!provider) continue;

      const plugin   = allPlugins.find(pl => pl.id === provider.plugin_id);
      const provName = (provider.name || '').toLowerCase();
      const text     = (provider.text || '').toLowerCase();
      const plugName = (plugin?.name || '').toLowerCase();

      // RANK - LuckPerms
      if (plugName.includes('luckperms') || provName.includes('prefix') ||
          provName.includes('group') || provName.includes('rank')) {
        if (val.string_value || val.group_value) {
          rank = val.string_value || val.group_value;
        }
      }

      // MONEY - Vault / Essentials
      if (plugName.includes('vault') || plugName.includes('essentials') ||
          provName.includes('balance') || provName.includes('money') ||
          provName.includes('eco') || text.includes('balance') ||
          text.includes('money') || text.includes('dinero')) {
        if (val.double_value !== null && val.double_value !== undefined) {
          money = val.double_value;
        } else if (val.string_value) {
          money = val.string_value;
        }
      }

      // POINTS - PlayerPoints
      if (plugName.includes('playerpoints') || provName.includes('point') ||
          text.includes('point') || text.includes('punto')) {
        points = val.long_value ?? val.double_value ?? parseInt(val.string_value) ?? points;
      }

      // KILLS
      if (provName.includes('kill') || text.includes('kill') ||
          text.includes('mata')) {
        kills = val.long_value ?? val.double_value ?? kills;
      }

      // DEATHS
      if (provName.includes('death') || text.includes('death') ||
          text.includes('muerte')) {
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
        _debug: {
          totalProviders: allProviders.length,
          totalValues: allValues.length,
          allProviders: allProviders.map(p => {
            const pl = allPlugins.find(pl => pl.id === p.plugin_id);
            return `[plugin: ${pl?.name}] provider: ${p.name} | text: ${p.text}`;
          }),
          allValues: allValues.map(v => {
            const p = allProviders.find(pr => pr.id === v.provider_id);
            return `provider: ${p?.name} | str: ${v.string_value} | dbl: ${v.double_value} | lng: ${v.long_value} | grp: ${v.group_value}`;
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
