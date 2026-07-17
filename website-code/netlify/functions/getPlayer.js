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

// Limpia códigos de color de Minecraft (&6&l etc)
function cleanMinecraftColors(str) {
  if (!str) return str;
  return str
    .replace(/&[0-9a-fklmnorA-FKLMNOR]/g, '')
    .replace(/§[0-9a-fklmnorA-FKLMNOR]/g, '')
    .trim();
}

// Obtiene el mejor valor numérico o string de una fila
function getValue(val) {
  if (val.long_value !== null && val.long_value !== undefined) return val.long_value;
  if (val.double_value !== null && val.double_value !== undefined) return val.double_value;
  if (val.string_value !== null && val.string_value !== undefined) return val.string_value;
  if (val.group_value !== null && val.group_value !== undefined) return val.group_value;
  return null;
}

// Convierte cualquier valor a número
function toNumber(val) {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

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

    // 2. Obtener providers
    let allProviders = [];
    try {
      const [provRows] = await connection.execute(
        `SELECT id, name, text, plugin_id FROM plan_extension_providers`
      );
      allProviders = provRows;
    } catch(e) { console.log('providers error:', e.message); }

    // 3. Obtener plugins
    let allPlugins = [];
    try {
      const [plugRows] = await connection.execute(
        `SELECT id, name FROM plan_extension_plugins`
      );
      allPlugins = plugRows;
    } catch(e) { console.log('plugins error:', e.message); }

    // 4. Obtener valores del jugador
    let allValues = [];
    try {
      const [valRows] = await connection.execute(
        `SELECT provider_id, string_value, double_value, long_value, group_value
         FROM plan_extension_user_values WHERE uuid = ?`,
        [uuid]
      );
      allValues = valRows;
    } catch(e) { console.log('user_values error:', e.message); }

    // 5. Parsear valores
    let rank = null;
    let money = null;
    let points = null;
    let kills = 0;
    let deaths = 0;
    let hoursPlayed = 0;
    let daysPlayed = 0;

    for (const val of allValues) {
      const provider = allProviders.find(p => p.id === val.provider_id);
      if (!provider) continue;

      const plugin   = allPlugins.find(pl => pl.id === provider.plugin_id);
      const provName = (provider.name || '').toLowerCase();
      const plugName = (plugin?.name || '').toLowerCase();
      const rawValue = getValue(val);

      // ── RANK (usar luckperms_prefix de PlaceholderAPI, es el más limpio) ──
      if (provName === 'luckperms_prefix') {
        rank = cleanMinecraftColors(val.string_value);
      }
      // Fallback: prefix directo de LuckPerms
      if (!rank && plugName.includes('luckperms') && provName === 'prefix') {
        rank = cleanMinecraftColors(val.string_value || val.group_value);
      }

      // ── MONEY (usar vault_eco_balance_formatted, ya viene formateado "8.1k") ──
      if (provName === 'vault_eco_balance_formatted') {
        money = val.string_value;
      }
      // Fallback: balance numérico
      if (!money && (provName === 'balance') && val.double_value !== null) {
        money = val.double_value;
      }

      // ── POINTS (playerpoints_points) ──
      if (provName === 'playerpoints_points') {
        points = toNumber(rawValue);
      }

      // ── KILLS (statistic_player_kills) ──
      if (provName === 'statistic_player_kills') {
        kills = toNumber(rawValue);
      }

      // ── DEATHS (statistic_deaths) ──
      if (provName === 'statistic_deaths') {
        deaths = toNumber(rawValue);
      }

      // ── HOURS PLAYED (statistic_hours_played) ──
      if (provName === 'statistic_hours_played') {
        hoursPlayed = toNumber(rawValue);
      }

      // ── DAYS PLAYED (statistic_days_played) ──
      if (provName === 'statistic_days_played') {
        daysPlayed = toNumber(rawValue);
      }
    }

    // 6. Calcular playtime total
    let finalHours = (daysPlayed * 24) + hoursPlayed;
    let finalMinutes = 0;

    // Si statistic no tiene datos, usar plan_sessions como respaldo
    if (finalHours === 0) {
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
    }

    await connection.end();

    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toString();
    const playtimeFormatted = daysPlayed > 0
      ? `${daysPlayed}d ${hoursPlayed}h`
      : finalHours > 0
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
            days: daysPlayed,
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
          sqlMessage: error.sqlMessage || null,
        }
      }),
    };
  }
};
