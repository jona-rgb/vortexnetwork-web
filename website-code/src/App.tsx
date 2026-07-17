import { useState, useRef, useEffect, createContext, useContext } from 'react';

/* ═══════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════ */
const CONFIG = {
  // API endpoint for player data (Netlify Function)
  API_URL: '/api/getPlayer',
  
  // Discord invite
  DISCORD_URL: 'https://discord.gg/gVdsUQKMZ',
  
  // Server IP
  SERVER_IP: 'vortex.servegame.net',
};

/* ═══════════════════════════════════════════════════════════════
   TYPES & CONTEXT
   ═══════════════════════════════════════════════════════════════ */
interface PlayerStats {
  name: string;
  uuid: string;
  odljugadorDb: number;
  registered: number;
  playtime: {
    ms: number;
    hours: number;
    minutes: number;
    formatted: string;
  };
  deaths: number;
  kills: number;
  kd: string;
  rank: string | null;
  money: number | null;
  points: number | null;
  headUrl: string;
  avatarUrl: string;
}

interface PlayerData {
  username: string;
  stats: PlayerStats | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextType {
  player: PlayerData | null;
  isLoading: boolean;
  login: (username: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshStats: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/* ═══════════════════════════════════════════════════════════════
   API SERVICE - Fetch player data from Netlify Function
   ═══════════════════════════════════════════════════════════════ */
async function fetchPlayerData(username: string): Promise<{ success: boolean; player?: PlayerStats; error?: string }> {
  try {
    const response = await fetch(`${CONFIG.API_URL}?name=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        success: false, 
        error: data.message || 'Error al obtener datos del jugador' 
      };
    }

    if (data.success && data.player) {
      return { success: true, player: data.player };
    }

    return { success: false, error: 'Respuesta inesperada del servidor' };
  } catch (error) {
    console.error('API error:', error);
    return { 
      success: false, 
      error: 'Error de conexión. Verifica tu conexión a internet.' 
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTH PROVIDER
   ═══════════════════════════════════════════════════════════════ */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem('vortex_player');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPlayer({
          username: parsed.username,
          stats: parsed.stats || null,
          isLoading: false,
          error: null,
        });
        // Refresh stats in background
        if (parsed.username) {
          refreshStatsForUser(parsed.username);
        }
      } catch {
        localStorage.removeItem('vortex_player');
      }
    }
    setIsLoading(false);
  }, []);

  const refreshStatsForUser = async (username: string) => {
    setPlayer(prev => prev ? { ...prev, isLoading: true, error: null } : null);
    
    const result = await fetchPlayerData(username);
    
    setPlayer(prev => {
      if (!prev) return null;
      const updated: PlayerData = {
        ...prev,
        stats: result.success ? result.player! : prev.stats,
        isLoading: false,
        error: result.success ? null : result.error || null,
      };
      localStorage.setItem('vortex_player', JSON.stringify(updated));
      return updated;
    });
  };

  const refreshStats = async () => {
    if (!player?.username) return;
    await refreshStatsForUser(player.username);
  };

  const login = async (username: string): Promise<{ success: boolean; error?: string }> => {
    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
      return { success: false, error: 'Nombre inválido (3-16 caracteres, solo letras, números y _)' };
    }

    setPlayer({
      username,
      stats: null,
      isLoading: true,
      error: null,
    });

    const result = await fetchPlayerData(username);

    if (result.success && result.player) {
      const playerData: PlayerData = {
        username: result.player.name, // Use the correct casing from DB
        stats: result.player,
        isLoading: false,
        error: null,
      };
      setPlayer(playerData);
      localStorage.setItem('vortex_player', JSON.stringify(playerData));
      return { success: true };
    }

    // Even if not found in DB, allow login (for visual purposes)
    const fallbackData: PlayerData = {
      username,
      stats: null,
      isLoading: false,
      error: result.error || 'No se encontraron datos',
    };
    setPlayer(fallbackData);
    localStorage.setItem('vortex_player', JSON.stringify(fallbackData));
    
    return { success: true }; // Still "successful" login, just no stats
  };

  const logout = () => {
    setPlayer(null);
    localStorage.removeItem('vortex_player');
  };

  return (
    <AuthContext.Provider value={{ player, isLoading, login, logout, refreshStats }}>
      {children}
    </AuthContext.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION SECTIONS
   ═══════════════════════════════════════════════════════════════ */
const NAV_SECTIONS = [
  { id: 'hero', label: 'Inicio', icon: '🏠' },
  { id: 'info', label: 'Información', icon: '📖' },
  { id: 'rules', label: 'Reglas', icon: '📜' },
  { id: 'commands', label: 'Comandos', icon: '📋' },
  { id: 'points', label: 'Sistema de Puntos', icon: '⭐' },
];

/* ═══════════════════════════════════════════════════════════════
   HAMBURGER MENU COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { player, logout, refreshStats } = useAuth();

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setIsOpen(false);
  };

  const stats = player?.stats;
  const hasStats = !!stats;

  return (
    <>
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-[#0b0c10]/95 backdrop-blur-sm px-4 py-3 border-b border-[#1f2833]">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold bg-gradient-to-r from-[#00ffff] to-[#8a2be2] bg-clip-text text-transparent">
            VORTEX
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Player Info (if logged in) */}
          {player && (
            <div className="hidden sm:flex items-center gap-2 bg-[#1f2833] rounded-lg px-3 py-1.5">
              <img
                src={stats?.avatarUrl || `https://crafthead.net/avatar/${player.username}/64`}
                alt={player.username}
                className="w-7 h-7 rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://crafthead.net/avatar/MHF_Steve/64';
                }}
              />
              <span className="text-sm font-medium text-[#00ffff]">
                {stats?.name || player.username}
              </span>
              {stats?.rank && (
                <span className="text-[10px] bg-[#8a2be2]/30 text-[#8a2be2] px-1.5 py-0.5 rounded font-medium">
                  {stats.rank}
                </span>
              )}
            </div>
          )}

          {/* Hamburger Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="relative z-50 flex flex-col justify-center items-center w-10 h-10 rounded-lg bg-[#1f2833] hover:bg-[#2a3544] transition-colors"
            aria-label="Menú"
          >
            <span
              className={`block w-5 h-0.5 bg-[#00ffff] transition-all duration-300 ${
                isOpen ? 'rotate-45 translate-y-1.5' : ''
              }`}
            />
            <span
              className={`block w-5 h-0.5 bg-[#00ffff] mt-1 transition-all duration-300 ${
                isOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`block w-5 h-0.5 bg-[#00ffff] mt-1 transition-all duration-300 ${
                isOpen ? '-rotate-45 -translate-y-1.5' : ''
              }`}
            />
          </button>
        </div>
      </header>

      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsOpen(false)}
      />

      {/* Slide-out Menu */}
      <nav
        className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-[#0b0c10] border-l border-[#8a2be2] z-40 transform transition-transform duration-300 ease-out overflow-hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full pt-16 overflow-y-auto">
          {/* Player Section */}
          <div className="p-5 border-b border-[#1f2833]">
            {player ? (
              <div className="space-y-4">
                {/* Player Header */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img
                      src={stats?.headUrl || `https://crafthead.net/helm/${player.username}/120`}
                      alt={player.username}
                      className="w-16 h-16 rounded-lg border-2 border-[#8a2be2] shadow-lg shadow-[#8a2be2]/20"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://crafthead.net/helm/MHF_Steve/120';
                      }}
                    />
                    {player.isLoading && (
                      <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-[#00ffff] border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold text-white truncate">
                      {stats?.name || player.username}
                    </p>
                    {stats?.rank ? (
                      <span className="inline-block mt-1 text-sm bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white px-2 py-0.5 rounded font-medium">
                        {stats.rank}
                      </span>
                    ) : (
                      <p className="text-sm text-[#666]">
                        {hasStats ? 'Sin rango' : 'Datos no disponibles'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                {hasStats ? (
                  <div className="grid grid-cols-2 gap-2">
                    <StatBox
                      label="Dinero"
                      value={stats.money !== null ? `$${stats.money.toLocaleString()}` : undefined}
                      icon="💰"
                      color="#00ff88"
                    />
                    <StatBox
                      label="Puntos"
                      value={stats.points !== null ? stats.points.toLocaleString() : undefined}
                      icon="⭐"
                      color="#ffcf00"
                    />
                    <StatBox
                      label="Tiempo"
                      value={stats.playtime.formatted}
                      icon="⏱️"
                      color="#00ffff"
                    />
                    <StatBox
                      label="K/D"
                      value={`${stats.kills}/${stats.deaths}`}
                      icon="⚔️"
                      color="#ff6b6b"
                    />
                  </div>
                ) : (
                  <div className="bg-[#1a1a2e] rounded-lg p-4 text-center">
                    {player.error ? (
                      <p className="text-sm text-[#ff6b6b]">
                        ❌ {player.error}
                      </p>
                    ) : (
                      <p className="text-sm text-[#888]">
                        Cargando estadísticas...
                      </p>
                    )}
                  </div>
                )}

                {/* Extended Stats (if available) */}
                {hasStats && (
                  <div className="bg-[#12141a] rounded-lg p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#888]">Kills:</span>
                      <span className="text-[#00ff88] font-medium">{stats.kills}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888]">Muertes:</span>
                      <span className="text-[#ff6b6b] font-medium">{stats.deaths}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888]">Ratio K/D:</span>
                      <span className="text-[#ffcf00] font-medium">{stats.kd}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#888]">Horas jugadas:</span>
                      <span className="text-[#00ffff] font-medium">
                        {stats.playtime.hours}h {stats.playtime.minutes}m
                      </span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={refreshStats}
                    disabled={player.isLoading}
                    className="flex-1 py-2 rounded-lg border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/10 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {player.isLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Actualizando</span>
                      </>
                    ) : (
                      <>🔄 Actualizar</>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      setIsOpen(false);
                    }}
                    className="px-4 py-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                  >
                    Salir
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-lg bg-[#1f2833] flex items-center justify-center border-2 border-dashed border-[#333]">
                  <span className="text-3xl">👤</span>
                </div>
                <div>
                  <p className="text-white font-medium">¿Juegas en Vortex?</p>
                  <p className="text-[#888] text-sm mt-1">
                    Ingresa tu nombre para ver tus estadísticas
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowLoginModal(true);
                    setIsOpen(false);
                  }}
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white font-bold hover:opacity-90 transition-opacity"
                >
                  Ver mis Stats
                </button>
                <p className="text-[10px] text-[#555]">
                  Opcional - El menú funciona sin iniciar sesión
                </p>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <div className="flex-1 p-5">
            <p className="text-xs uppercase tracking-wider text-[#666] mb-3">
              Navegación
            </p>
            <div className="space-y-1">
              {NAV_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-[#cccccc] hover:bg-[#1f2833] hover:text-[#00ffff] transition-colors"
                >
                  <span className="text-lg">{section.icon}</span>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>

            {/* Quick Links */}
            <p className="text-xs uppercase tracking-wider text-[#666] mt-6 mb-3">
              Enlaces Rápidos
            </p>
            <div className="space-y-1">
              <a
                href={CONFIG.DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-[#cccccc] hover:bg-[#5865F2]/20 hover:text-[#5865F2] transition-colors"
                onClick={() => setIsOpen(false)}
              >
                <span className="text-lg">💬</span>
                <span>Discord</span>
                <span className="ml-auto text-xs text-[#666]">↗</span>
              </a>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#1f2833] text-center">
            <p className="text-xs text-[#666]">
              IP: <span className="text-[#00ffff]">{CONFIG.SERVER_IP}</span>
            </p>
          </div>
        </div>
      </nav>

      {/* Login Modal */}
      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} />
      )}
    </>
  );
}

/* ───── Stat Box Component ───── */
function StatBox({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number | undefined;
  icon: string;
  color: string;
}) {
  const hasValue = value !== undefined && value !== null;
  
  return (
    <div className="bg-[#1f2833] rounded-lg p-2.5 text-center">
      <p className="text-lg">{icon}</p>
      <p
        className="text-sm font-bold truncate"
        style={{ color: hasValue ? color : '#666' }}
      >
        {hasValue ? value : '—'}
      </p>
      <p className="text-[10px] text-[#888] uppercase">{label}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LOGIN MODAL
   ═══════════════════════════════════════════════════════════════ */
function LoginModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(username.trim());
    
    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Error desconocido');
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#12141a] rounded-2xl border border-[#8a2be2] shadow-2xl shadow-[#8a2be2]/20 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#8a2be2]/20 to-[#00ffff]/20 px-6 py-4 border-b border-[#1f2833]">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📊</span> Ver mis Estadísticas
          </h3>
          <p className="text-sm text-[#888] mt-1">
            Ingresa tu nombre de Minecraft del servidor
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#888] mb-2">
              Nombre de Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Tu nombre en el servidor"
              className="w-full px-4 py-3 rounded-lg bg-[#0b0c10] border border-[#1f2833] text-white placeholder-[#555] focus:border-[#00ffff] focus:outline-none focus:ring-1 focus:ring-[#00ffff] transition-colors"
              autoFocus
              disabled={isLoading}
              maxLength={16}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">
              <span>❌</span>
              <span>{error}</span>
            </div>
          )}

          <div className="bg-[#1a1a2e] rounded-lg p-3 text-xs text-[#888] space-y-1">
            <p className="flex items-center gap-2">
              <span className="text-[#00ffff]">ℹ️</span>
              <span>Usa el mismo nombre con el que juegas en Vortex Network</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-green-400">✓</span>
              <span>Funciona con cuentas Premium y No-Premium</span>
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-lg border border-[#1f2833] text-[#888] hover:bg-[#1f2833] transition-colors"
              disabled={isLoading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || !username.trim()}
              className="flex-1 py-3 rounded-lg bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Buscando...
                </span>
              ) : (
                'Ver Stats'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ACCORDION & COMMAND COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
function AccordionItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(open ? contentRef.current.scrollHeight : 0);
    }
  }, [open]);

  return (
    <div
      className={`mb-3 rounded-lg border transition-all duration-300 ${
        open
          ? 'border-[#00ffff] shadow-[0_0_10px_rgba(0,255,255,0.1)]'
          : 'border-[#1f2833]'
      } bg-[#12141a]`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-4 text-left text-lg font-bold text-[#ffcf00] cursor-pointer"
      >
        <span>{title}</span>
        <span
          className={`text-[#00ffff] text-sm transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▼
        </span>
      </button>
      <div
        style={{ maxHeight: height }}
        className="overflow-hidden transition-all duration-300"
      >
        <div ref={contentRef} className="border-t border-dashed border-[#1f2833] px-4 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function Cmd({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="mb-2.5 text-[1.05rem]">
      <span className="rounded bg-[#050505] px-2 py-0.5 font-mono font-bold text-[#00ffff]">
        {name}
      </span>
      <span className="ml-2.5 text-[#cccccc]">{desc}</span>
    </div>
  );
}

function CmdNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 block text-sm italic text-[#8a2be2]">{children}</span>
  );
}

/* ───── Points Table Component ───── */
function PointsTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1f2833]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-[#1a1a2e]">
            {headers.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap px-4 py-3 font-semibold text-[#00ffff]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className={`border-t border-[#1f2833] ${
                ri % 2 === 0 ? 'bg-[#12141a]' : 'bg-[#0e1015]'
              } transition-colors hover:bg-[#1f2833]`}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`whitespace-nowrap px-4 py-2.5 ${
                    ci === row.length - 1
                      ? 'font-bold text-[#ffcf00]'
                      : 'text-[#cccccc]'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN CONTENT COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function MainContent() {
  const [copied, setCopied] = useState(false);

  const copyIP = () => {
    navigator.clipboard.writeText(CONFIG.SERVER_IP).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] font-sans text-white pt-14">
      {/* Hamburger Menu */}
      <HamburgerMenu />

      {/* ───── Hero ───── */}
      <section
        id="hero"
        className="border-b-2 border-[#8a2be2] bg-[radial-gradient(circle_at_center,#1a1a2e_0%,#0b0c10_100%)] px-5 py-24 text-center"
      >
        <h1 className="mt-5 mb-0 bg-gradient-to-r from-[#00ffff] to-[#8a2be2] bg-clip-text text-5xl md:text-6xl font-extrabold uppercase tracking-wider text-transparent">
          Vortex Network
        </h1>
        <h2 className="mt-1 text-2xl font-light tracking-[3px] text-[#ffcf00]">
          Survival Remastered
        </h2>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
          <button
            onClick={copyIP}
            className={`flex cursor-pointer items-center justify-center rounded-lg border-2 px-8 py-4 text-lg font-bold transition-all duration-300 ${
              copied
                ? 'border-[#ffcf00] bg-[#ffcf00] text-[#0b0c10] shadow-[0_0_15px_#ffcf00]'
                : 'border-[#00ffff] bg-[#1f2833] text-[#00ffff] hover:bg-[#00ffff] hover:text-[#0b0c10] hover:shadow-[0_0_15px_#00ffff]'
            }`}
          >
            {copied ? '¡IP COPIADA!' : `COPIAR IP: ${CONFIG.SERVER_IP}`}
          </button>

          <a
            href={CONFIG.DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded-lg border-2 border-[#8a2be2] bg-[#8a2be2] px-8 py-4 text-lg font-bold text-white no-underline transition-all duration-300 hover:bg-transparent hover:text-[#8a2be2] hover:shadow-[0_0_15px_#8a2be2]"
          >
            ÚNETE A DISCORD
          </a>
        </div>
      </section>

      {/* ───── Info Section ───── */}
      <section id="info" className="mx-auto max-w-3xl px-5 py-16 text-center scroll-mt-20">
        <h2 className="mb-5 text-4xl font-bold text-[#00ffff]">
          Entra en la Espiral
        </h2>
        <p className="text-lg leading-relaxed text-[#cccccc]">
          Bienvenido a Vortex Network. Disfruta de una experiencia de
          supervivencia única con nuestra modalidad{' '}
          <strong className="text-white">Survival Remastered</strong>. Únete a
          nuestra comunidad, construye tu imperio, comercia con otros jugadores
          y conquista el mundo.
        </p>
      </section>

      {/* ───── Rules Section ───── */}
      <section id="rules" className="mx-auto max-w-3xl px-5 pb-16 scroll-mt-20">
        <div className="rounded-xl border-l-4 border-[#ffcf00] bg-[#12141a] p-8 md:p-10">
          <h2 className="mt-0 mb-6 text-center text-3xl font-bold text-[#ffcf00]">
            Reglas del Servidor
          </h2>
          <ul className="list-none space-y-4 p-0">
            {[
              {
                title: 'Respeto mutuo:',
                text: 'Trata a todos los jugadores con respeto. No se tolera la toxicidad, los insultos o el acoso de ningún tipo.',
              },
              {
                title: 'Prohibido el uso de Hacks:',
                text: 'Juega limpio. El uso de clientes modificados, rayos X (X-Ray) o cualquier ventaja injusta resultará en ban permanente.',
              },
              {
                title: 'Cero grifeo:',
                text: 'Respeta las construcciones y cofres de los demás. Destruir el trabajo ajeno no está permitido.',
              },
              {
                title: 'No hacer SPAM:',
                text: 'Mantén el chat limpio. Evita el uso excesivo de mayúsculas, flood o la promoción de otros servidores.',
              },
              {
                title: 'Diviértete:',
                text: 'El objetivo principal es pasarla bien. ¡Colabora, explora y disfruta de la supervivencia!',
              },
            ].map((rule, i) => (
              <li key={i} className="relative pl-5 text-lg leading-relaxed text-[#cccccc]">
                <span className="absolute left-0 top-0 text-[#8a2be2]">➤</span>
                <strong className="text-white">{rule.title}</strong> {rule.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───── Commands Section ───── */}
      <section id="commands" className="mx-auto max-w-3xl px-5 pb-16 scroll-mt-20">
        <h2 className="mb-2 text-center text-4xl font-bold text-[#8a2be2]">
          📋 Comandos para Jugadores
        </h2>
        <p className="mb-8 text-center text-lg text-[#cccccc]">
          Despliega las categorías para ver todos los comandos disponibles en el
          servidor.
        </p>

        {/* EssentialsX */}
        <AccordionItem title="🏠 EssentialsX (Sistema Básico)">
          <Cmd name="/home [nombre]" desc="Ir a tu casa" />
          <Cmd name="/sethome [nombre]" desc="Guardar ubicación como casa" />
          <Cmd name="/delhome [nombre]" desc="Eliminar casa" />
          <Cmd name="/homes" desc="Ver lista de tus casas" />
          <Cmd name="/spawn" desc="Ir al spawn" />
          <Cmd name="/tpa <jugador>" desc="Pedir TP a jugador" />
          <Cmd name="/tpahere <jugador>" desc="Pedir que jugador venga a ti" />
          <Cmd name="/tpaccept" desc="Aceptar solicitud de TP" />
          <Cmd name="/tpdeny" desc="Rechazar solicitud de TP" />
          <Cmd name="/back" desc="Volver a la ubicación anterior" />
          <Cmd name="/warp <nombre>" desc="Ir a un warp" />
          <Cmd name="/warps" desc="Ver warps disponibles" />
          <Cmd name="/bal (o /money)" desc="Ver tu dinero" />
          <Cmd name="/baltop" desc="Ranking de dinero" />
          <Cmd name="/pay <jugador> <cantidad>" desc="Enviar dinero" />
          <Cmd name="/msg <jugador> <mensaje>" desc="Mensaje privado" />
          <Cmd name="/r <mensaje>" desc="Responder último mensaje" />
          <Cmd name="/mail send <jugador> <mensaje>" desc="Enviar correo" />
          <Cmd name="/mail read" desc="Leer correos" />
          <Cmd name="/kit <nombre>" desc="Obtener kit" />
          <Cmd name="/kits" desc="Ver kits disponibles" />
          <Cmd name="/suicide" desc="Suicidarse" />
          <Cmd name="/afk" desc="Marcar como ausente" />
          <Cmd name="/ignore <jugador>" desc="Ignorar jugador" />
          <Cmd name="/near" desc="Ver jugadores cercanos" />
          <Cmd name="/compass" desc="Ver dirección" />
          <Cmd name="/depth" desc="Ver profundidad (coordenada Y)" />
          <Cmd name="/getpos" desc="Ver tu posición exacta" />
          <Cmd name="/time" desc="Ver hora del mundo" />
          <Cmd name="/list" desc="Ver jugadores online" />
        </AccordionItem>

        {/* BetterRTP */}
        <AccordionItem title="🌍 BetterRTP (Teletransporte Aleatorio)">
          <Cmd name="/rtp" desc="Teletransportarte a ubicación aleatoria" />
          <Cmd name="/rtp <mundo>" desc="RTP en un mundo específico" />
          <CmdNote>
            Nota: Cooldown de 10 minutos entre usos. Hay un delay de 5 segundos
            antes del TP (se cancela si te mueves).
          </CmdNote>
        </AccordionItem>

        {/* AuraSkills & Jobs */}
        <AccordionItem title="⚔️ AuraSkills (Habilidades RPG) & 💼 Jobs">
          <Cmd name="/skills" desc="Ver tus habilidades (AuraSkills)" />
          <Cmd name="/stats" desc="Ver estadísticas RPG" />
          <Cmd name="/skills top" desc="Ranking de habilidades" />
          <Cmd name="/jobs browse" desc="Ver trabajos disponibles" />
          <Cmd name="/jobs join <trabajo>" desc="Unirte a un trabajo" />
          <Cmd name="/jobs leave <trabajo>" desc="Dejar un trabajo" />
          <Cmd name="/jobs quests" desc="Ver misiones de trabajo" />
        </AccordionItem>

        {/* Economía y Tiendas */}
        <AccordionItem title="🏪 Economía y Tiendas (EconomyShopGUI, QuickShop, PlayerAuctions, Mochilas)">
          <Cmd name="/shop" desc="Abrir la tienda principal del servidor" />
          <Cmd name="/mochilas (o /bolsas)" desc="Abrir la tienda de mochilas" />
          <Cmd
            name="/sellall"
            desc="Vender todos los items vendibles del inventario"
          />
          <Cmd
            name="/ah (o /pauction)"
            desc="Abrir la casa de subastas de jugadores"
          />
          <Cmd
            name="/ah sell <precio>"
            desc="Vender el item que tienes en la mano"
          />
          <CmdNote>
            Para QuickShop (Tiendas físicas): Golpea un cofre con un item para
            crear la tienda.
          </CmdNote>
          <div className="mt-2" />
          <Cmd name="/qs create <precio>" desc="Crear tienda en el cofre apuntado" />
          <Cmd name="/qs buy / sell" desc="Cambiar tienda a modo compra o venta" />
          <Cmd name="/qs price <precio>" desc="Cambiar precio de tu tienda" />
        </AccordionItem>

        {/* Mochilas */}
        <AccordionItem title="🎒 Mochilas (HavenBags)">
          <Cmd name="/mochilas (o /bolsas)" desc="Abrir la tienda de mochilas" />
          <Cmd name="/havenbags (o /bag)" desc="Comando base" />
          <Cmd
            name="/bags rename <nombre>"
            desc="Reclamar y poner nombre a tu mochila (OBLIGATORIO al comprar)"
          />
          <Cmd
            name="/havenbags gui"
            desc="Abrir GUI para restaurar o eliminar tus propias mochilas"
          />
          <Cmd
            name="/havenbags empty"
            desc="Vaciar el contenido de tu mochila al suelo"
          />
          <Cmd
            name="/havenbags autopickup <categoría>"
            desc="Configurar auto-recolección de items"
          />
          <Cmd
            name="/havenbags trust <jugador>"
            desc="Dar confianza a otro jugador para abrir tu mochila"
          />
          <Cmd name="/havenbags untrust <jugador>" desc="Quitar esa confianza" />
          <Cmd
            name="/havenbags autosort <on/off>"
            desc="Activar o desactivar orden automático del contenido"
          />
          <Cmd
            name="/havenbags magnet <on/off>"
            desc="Activar imán que succiona items cercanos"
          />
          <Cmd
            name="/havenbags refill <on/off>"
            desc="Reponer automáticamente el último bloque desde la mochila"
          />
          <Cmd name="/havenbags help" desc="Ver ayuda de comandos según tus permisos" />
        </AccordionItem>

        {/* Intercambios, Puntos y Extras */}
        <AccordionItem title="🔄 Intercambios, Puntos y Extras">
          <Cmd
            name="/trade <jugador>"
            desc="Solicitud de intercambio (Shift + Click derecho también funciona)"
          />
          <Cmd name="/points" desc="Ver tus PlayerPoints" />
          <Cmd name="/puntoss" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/ptshop" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/puntoshop" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/dailyreward (o /dr)" desc="Reclamar recompensa diaria" />
          <Cmd name="/sit / lay / crawl" desc="Sentarse, acostarse o gatear (GSit)" />
          <Cmd name="/em" desc="Menú principal de EliteMobs" />
          <Cmd
            name="/crates"
            desc="Ver cajas disponibles (Click derecho a una caja física con la llave para abrirla)"
          />
          <CmdNote>
            Los comandos /puntoss, /ptshop y /puntoshop abren la misma tienda de puntos — ¡usa el que prefieras!
          </CmdNote>
        </AccordionItem>

        <p className="mt-5 text-center text-lg text-[#cccccc]">
          💡 <strong className="text-white">Tip:</strong> Puedes usar{' '}
          <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">
            /help
          </code>{' '}
          en el juego para ver una lista general, o presionar{' '}
          <strong className="text-white">TAB</strong> después de escribir{' '}
          <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">
            /
          </code>{' '}
          para autocompletar comandos.
        </p>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          ───── Formas de Ganar Puntos Section ─────
          ═══════════════════════════════════════════════════════════════ */}
      <section id="points" className="mx-auto max-w-4xl px-5 pb-20 scroll-mt-20">
        <h2 className="mb-2 text-center text-4xl font-bold">
          <span className="bg-gradient-to-r from-[#ffcf00] to-[#ff8c00] bg-clip-text text-transparent">
            Formas de Ganar Puntos
          </span>
        </h2>
        <p className="mb-10 text-center text-lg text-[#cccccc]">
          Acumula puntos con cada acción que realices en el servidor y canjéalos
          en la tienda con{' '}
          <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">
            /puntoss
          </code>
          ,{' '}
          <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">
            /ptshop
          </code>{' '}
          o{' '}
          <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">
            /puntoshop
          </code>
          .
        </p>

        <div className="space-y-10">
          {/* 🎮 Por Jugar / Conectarse */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              🎮 Por Jugar / Conectarse
            </h3>
            <PointsTable
              headers={['Acción', 'Puntos']}
              rows={[
                ['Primera vez que entras al servidor', '+100'],
                ['Login diario', '+25'],
                ['Racha día 1', '+10'],
                ['Racha día 2', '+20'],
                ['Racha día 3', '+30'],
                ['Racha máxima (día 10+)', '+100'],
                ['Bonus semanal (7 días seguidos)', '+200'],
                ['Cada 30 minutos jugando', '+15'],
              ]}
            />
          </div>

          {/* ⚔️ Por Matar Mobs */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              ⚔️ Por Matar Mobs
            </h3>
            <PointsTable
              headers={['Mob', 'Puntos']}
              rows={[
                ['Zombie / Skeleton / Spider', '+2'],
                ['Creeper / Drowned / Husk / Stray', '+3'],
                ['Enderman / Witch / Guardian', '+5'],
                ['Blaze', '+6'],
                ['Ghast / Shulker', '+8'],
                ['Wither Skeleton / Iron Golem', '+10'],
                ['Ravager', '+15'],
                ['Elder Guardian', '+150'],
                ['Wither', '+300'],
                ['Ender Dragon', '+500'],
              ]}
            />
          </div>

          {/* 🗡️ Por PVP */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              🗡️ Por PVP
            </h3>
            <PointsTable
              headers={['Acción', 'Puntos']}
              rows={[
                ['Matar a un jugador', '+20'],
                ['Ser eliminado por un jugador', '-10'],
              ]}
            />
          </div>

          {/* ⛏️ Por Minar */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              ⛏️ Por Minar
            </h3>
            <PointsTable
              headers={['Mineral', 'Puntos']}
              rows={[
                ['Cobre', '+2'],
                ['Hierro', '+3'],
                ['Redstone', '+4'],
                ['Oro / Nether Gold', '+4 a +8'],
                ['Lapislázuli', '+5'],
                ['Esmeralda', '+12'],
                ['Diamante', '+15'],
                ['Ancient Debris', '+25'],
              ]}
            />
          </div>

          {/* 🔨 Por Craftear */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              🔨 Por Craftear
            </h3>
            <PointsTable
              headers={['Item', 'Puntos']}
              rows={[
                ['Armadura Diamante (pieza)', '+15 a +20'],
                ['Espada / Pico / Hacha Diamante', '+20'],
                ['Yunque / Mesa Encantamiento', '+20 a +30'],
                ['Armadura Netherita (pieza)', '+60 a +80'],
                ['Espada / Pico / Hacha Netherita', '+50'],
                ['Beacon', '+200'],
              ]}
            />
          </div>

          {/* 💼 Por Jobs */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              💼 Por Jobs
            </h3>
            <PointsTable
              headers={['Acción', 'Puntos']}
              rows={[
                ['Unirse a cualquier Job', '+10'],
                ['Subir de nivel en cualquier Job', '+50'],
                ['Completar Quest de cualquier Job', '+75'],
              ]}
            />
          </div>

          {/* 🎣 Por Pescar */}
          <div>
            <h3 className="mb-4 text-2xl font-bold text-[#00ffff]">
              🎣 Por Pescar
            </h3>
            <PointsTable
              headers={['Acción', 'Puntos']}
              rows={[
                ['Pescar cualquier pez', '+3'],
                ['Pescar entidad especial', '+5'],
              ]}
            />
          </div>

          {/* 🏆 Resumen Visual */}
          <div className="rounded-xl border border-[#8a2be2] bg-[#12141a] p-6 md:p-8">
            <h3 className="mb-6 text-center text-2xl font-bold text-[#ffcf00]">
              🏆 Resumen Visual
            </h3>
            <div className="space-y-3 font-mono text-base md:text-lg">
              {[
                { medal: '🥇', action: 'Matar Ender Dragon', pts: '+500 pts', note: '(el mayor)' },
                { medal: '🥈', action: 'Matar Wither', pts: '+300 pts', note: '' },
                { medal: '🥉', action: 'Craftear Beacon', pts: '+200 pts', note: '' },
                { medal: '4️⃣', action: 'Bonus Semanal', pts: '+200 pts', note: '' },
                { medal: '5️⃣', action: 'Matar Elder Guardian', pts: '+150 pts', note: '' },
                { medal: '...', action: '', pts: '', note: '' },
                { medal: '⬇️', action: 'Pescar un pez', pts: '+3 pts', note: '(el menor)' },
              ].map((item, i) =>
                item.action === '' ? (
                  <div key={i} className="text-center text-[#666666]">
                    •••
                  </div>
                ) : (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0b0c10] px-4 py-3"
                  >
                    <span className="mr-1 text-xl">{item.medal}</span>
                    <span className="text-[#cccccc]">{item.action}</span>
                    <span className="text-[#00ffff]">→</span>
                    <span className="font-bold text-[#ffcf00]">{item.pts}</span>
                    {item.note && (
                      <span className="text-sm text-[#8a2be2]">{item.note}</span>
                    )}
                  </div>
                )
              )}
            </div>

            <div className="mt-8 rounded-lg border border-dashed border-[#00ffff] bg-[#0b0c10] p-5 text-center">
              <p className="text-lg leading-relaxed text-[#cccccc]">
                💡{' '}
                <strong className="text-white">
                  La forma más rápida de acumular puntos
                </strong>{' '}
                es subir niveles en{' '}
                <span className="font-bold text-[#00ffff]">Jobs</span> + jugar
                tiempo seguido + matar{' '}
                <span className="font-bold text-[#8a2be2]">bosses</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="border-t border-[#1f2833] bg-[#050505] py-5 text-center text-sm text-[#666666]">
        <p>&copy; 2026 Vortex Network. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   APP WRAPPER WITH AUTH PROVIDER
   ═══════════════════════════════════════════════════════════════ */
export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
