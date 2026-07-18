import { useState, useRef, useEffect, createContext, useContext } from 'react';

/* ═══════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════ */
const CONFIG = {
  API_URL: '/api/getPlayer',
  DISCORD_URL: 'https://discord.gg/gVdsUQKMZ',
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
  playtime: { ms: number; hours: number; minutes: number; formatted: string };
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
   API SERVICE
   ═══════════════════════════════════════════════════════════════ */
async function fetchPlayerData(username: string): Promise<{ success: boolean; player?: PlayerStats; error?: string }> {
  try {
    const response = await fetch(`${CONFIG.API_URL}?name=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) return { success: false, error: data.message || 'Error al obtener datos del jugador' };
    if (data.success && data.player) return { success: true, player: data.player };
    return { success: false, error: 'Respuesta inesperada del servidor' };
  } catch (error) {
    console.error('API error:', error);
    return { success: false, error: 'Error de conexión. Verifica tu conexión a internet.' };
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTH PROVIDER
   ═══════════════════════════════════════════════════════════════ */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('vortex_player');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPlayer({ username: parsed.username, stats: parsed.stats || null, isLoading: false, error: null });
        if (parsed.username) refreshStatsForUser(parsed.username);
      } catch { localStorage.removeItem('vortex_player'); }
    }
    setIsLoading(false);
  }, []);

  const refreshStatsForUser = async (username: string) => {
    setPlayer(prev => prev ? { ...prev, isLoading: true, error: null } : null);
    const result = await fetchPlayerData(username);
    setPlayer(prev => {
      if (!prev) return null;
      const updated: PlayerData = { ...prev, stats: result.success ? result.player! : prev.stats, isLoading: false, error: result.success ? null : result.error || null };
      localStorage.setItem('vortex_player', JSON.stringify(updated));
      return updated;
    });
  };

  const refreshStats = async () => { if (player?.username) await refreshStatsForUser(player.username); };

  const login = async (username: string): Promise<{ success: boolean; error?: string }> => {
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) return { success: false, error: 'Nombre inválido (3-16 caracteres, solo letras, números y _)' };
    setPlayer({ username, stats: null, isLoading: true, error: null });
    const result = await fetchPlayerData(username);
    if (result.success && result.player) {
      const playerData: PlayerData = { username: result.player.name, stats: result.player, isLoading: false, error: null };
      setPlayer(playerData);
      localStorage.setItem('vortex_player', JSON.stringify(playerData));
      return { success: true };
    }
    const fallbackData: PlayerData = { username, stats: null, isLoading: false, error: result.error || 'No se encontraron datos' };
    setPlayer(fallbackData);
    localStorage.setItem('vortex_player', JSON.stringify(fallbackData));
    return { success: true };
  };

  const logout = () => { setPlayer(null); localStorage.removeItem('vortex_player'); };

  return <AuthContext.Provider value={{ player, isLoading, login, logout, refreshStats }}>{children}</AuthContext.Provider>;
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION SECTIONS
   ═══════════════════════════════════════════════════════════════ */
const NAV_SECTIONS = [
  { id: 'hero', label: 'Inicio', icon: '🏠' },
  { id: 'info', label: 'Información', icon: '📖' },
  { id: 'rules', label: 'Reglas', icon: '📜' },
  { id: 'commands', label: 'Comandos', icon: '📋' },
  { id: 'crates', label: 'Crates', icon: '🎁' },
  { id: 'artifacts', label: 'Artifacts', icon: '⚔️' },
  { id: 'points', label: 'Sistema de Puntos', icon: '⭐' },
];

/* ═══════════════════════════════════════════════════════════════
   RARITY & CRATE DATA
   ═══════════════════════════════════════════════════════════════ */
const RARITY_COLORS = { comun: '#9CA3AF', pocoComun: '#22C55E', raro: '#3B82F6', legendario: '#F59E0B' };

const CRATES_DATA = {
  vote: {
    name: 'Vote Crate', emoji: '🟡', color: '#F59E0B',
    description: 'Crate para jugadores nuevos y casuales. La más fácil de conseguir con recompensas básicas pero útiles.',
    howToGet: [
      { icon: '🗳️', text: 'Votando en las páginas del servidor (recompensa diaria)' },
      { icon: '⭐', text: '250 puntos por 1 llave' },
      { icon: '📦', text: 'Pack de 12 llaves: 2,500 puntos (ahorras 500)' },
    ],
    rewards: {
      comun: ['Armadura Chainmail completa', 'Herramientas de hierro (sword, axe, shovel, hoe)', 'Water bucket', 'Flint and steel', 'Brush', 'Spyglass', 'Ender pearl', 'Music discs (Cat, Mellohi)', '8x Cooked beef', '16x Torch', '1x Experience bottle', '1x Saddle', '1x Name tag', '2x Iron ingot', '$100 dinero'],
      pocoComun: ['$200 dinero', '3x Ender pearl'],
      raro: ['Diamond pickaxe', '5x Diamond'],
      legendario: [],
    },
  },
  wild: {
    name: 'Wild Crate', emoji: '⚪', color: '#9CA3AF',
    description: 'Crate para jugadores intermedios. Recompensas de nivel diamante con items de combate avanzados.',
    howToGet: [
      { icon: '⭐', text: '1,000 puntos por 1 llave' },
      { icon: '📦', text: 'Pack de 12 llaves: 10,000 puntos (ahorras 2,000)' },
      { icon: '🎁', text: 'Se puede obtener dentro del Insane Crate' },
    ],
    rewards: {
      comun: ['Set completo de diamante (casco, pechera, pantalón, botas)', 'Herramientas de diamante (sword, pickaxe, axe, shovel, hoe)', 'Shield', 'Bow', 'Crossbow', '16x Spectral arrow', '16x Tipped arrow', '1x TNT', 'Golden apple', '8x Golden carrot'],
      pocoComun: ['$300 dinero', 'End crystal', 'Diamond horse armor', '16x Experience bottle', 'Libro: Sharpness IV', 'Libro: Efficiency IV', 'Libro: Protection III', '1x Vote Key'],
      raro: ['$750 dinero', '8x Diamond', '32x Experience bottle', 'Trident', 'Wither skeleton skull', 'Notch Apple (Enchanted Golden Apple)'],
      legendario: ['Totem of Undying', 'Elytra (~0.5%)', 'Beacon (~0.5%)'],
    },
  },
  insane: {
    name: 'Insane Crate', emoji: '🟠', color: '#F97316',
    description: 'Crate premium para veteranos. Recompensas de nivel netherita con items legendarios y encantamientos top. Requiere dedicación (~1 semana para obtener 1 llave).',
    howToGet: [
      { icon: '⭐', text: '3,500 puntos por 1 llave' },
      { icon: '📦', text: 'Pack de 12 llaves: 35,000 puntos (ahorras 7,000)' },
    ],
    rewards: {
      comun: ['16x Golden carrot'],
      pocoComun: ['Netherite hoe', 'Totem of Undying', '$1,000 dinero', '1x Netherite upgrade smithing template', 'Libros encantados aleatorios (7 tipos)', '1x Vote Key', '1x Wild Key'],
      raro: ['Netherite sword ⚔️', 'Netherite pickaxe ⛏️', 'Netherite axe 🪓', 'Netherite shovel', 'Netherite helmet 🪖', 'Netherite leggings', 'Netherite boots 👢', '$3,000 dinero', '2x Netherite ingot', '64x Experience bottle', 'Nether star ⭐', '3x Wild Key'],
      legendario: ['Netherite chestplate 🛡️', '4x Netherite ingot', 'Enchanted Golden Apple (God Apple) 🍎', 'Elytra (~0.7%) 🪽', 'Beacon (~0.7%) 🔦', '3x Netherite upgrade template', 'Libro: Mending 📖', 'Libro: Efficiency V 📖', 'Libro: Sharpness V 📖', 'Libro: Protection IV 📖', 'Libro: Fortune III 📖'],
    },
  },
};

/* ═══════════════════════════════════════════════════════════════
   ARTIFACTS DATA
   ═══════════════════════════════════════════════════════════════ */
const ARTIFACTS_SLOTS = [
  {
    id: 'head', name: 'HEAD', nameEs: 'Cabeza', icon: '🎩', color: '#A78BFA', count: 8,
    items: [
      { name: 'Snorkel', effect: 'Respirar bajo el agua' },
      { name: 'Villager Hat', effect: 'Mejores precios con aldeanos' },
      { name: 'Superstitious Hat', effect: '+1 Looting al matar mobs' },
      { name: 'Cowboy Hat', effect: 'Monturas más rápidas' },
      { name: 'Plastic Drinking Hat', effect: 'Comer y beber más rápido' },
      { name: 'Novelty Drinking Hat', effect: 'Comer y beber AÚN más rápido' },
      { name: 'Night Vision Goggles', effect: 'Visión nocturna permanente' },
      { name: "Angler's Hat", effect: 'Mejor suerte y velocidad de pesca' },
    ],
  },
  {
    id: 'necklace', name: 'NECKLACE', nameEs: 'Collar', icon: '📿', color: '#F472B6', count: 9,
    items: [
      { name: 'Lucky Scarf', effect: '+1 Fortune al minar bloques' },
      { name: 'Cross Necklace', effect: 'Más tiempo de invencibilidad tras recibir daño' },
      { name: 'Panic Necklace', effect: 'Boost de velocidad al ser golpeado' },
      { name: 'Shock Pendant', effect: 'Probabilidad de lanzar rayo a los atacantes' },
      { name: 'Flame Pendant', effect: 'Probabilidad de prender fuego a los atacantes' },
      { name: 'Scarf of Invisibility', effect: 'Te vuelves invisible' },
      { name: 'Thorn Pendant', effect: 'Refleja daño a los atacantes' },
      { name: 'Charm of Sinking', effect: 'Caminar libremente bajo el agua' },
      { name: 'Charm of Shrinking', effect: 'Encoge al jugador (1.20.5+)' },
    ],
  },
  {
    id: 'belt', name: 'BELT', nameEs: 'Cinturón', icon: '🔋', color: '#34D399', count: 8,
    items: [
      { name: 'Cloud in a Bottle', effect: 'Doble salto' },
      { name: 'Obsidian Skull', effect: 'Resistencia al fuego al recibir daño de fuego' },
      { name: 'Antidote Vessel', effect: 'Reduce duración de efectos negativos' },
      { name: 'Universal Attractor', effect: 'Atrae items cercanos hacia ti' },
      { name: 'Crystal Heart', effect: '+5 corazones extra de vida' },
      { name: 'Helium Flamingo', effect: 'Nada a través del aire' },
      { name: 'Chorus Totem', effect: 'Te teletransporta a un lugar seguro al morir (se consume)' },
      { name: 'Warp Drive', effect: 'Ender Pearls gastan hambre en vez del item' },
    ],
  },
  {
    id: 'hands', name: 'HANDS', nameEs: 'Manos', icon: '🧤', color: '#FB923C', count: 10,
    items: [
      { name: 'Digging Claws', effect: 'Minar piedra a mano + haste' },
      { name: 'Feral Claws', effect: 'Mayor velocidad de ataque' },
      { name: 'Power Glove', effect: 'Más daño cuerpo a cuerpo' },
      { name: 'Fire Gauntlet', effect: 'Ataques cuerpo a cuerpo prenden fuego' },
      { name: 'Pocket Piston', effect: 'Más knockback en ataques' },
      { name: 'Vampiric Glove', effect: 'Robo de vida en ataques cuerpo a cuerpo' },
      { name: 'Golden Hook', effect: 'Más XP por matar mobs' },
      { name: 'Onion Ring', effect: 'Haste después de comer' },
      { name: 'Pickaxe Heater', effect: 'Auto-fundición de minerales al minar' },
      { name: 'Withered Bracelet', effect: 'Probabilidad de infligir Wither al golpear' },
    ],
  },
  {
    id: 'feet', name: 'FEET', nameEs: 'Pies', icon: '👟', color: '#60A5FA', count: 9,
    items: [
      { name: 'Aqua-Dashers', effect: 'Caminar sobre el agua al correr' },
      { name: 'Bunny Hoppers', effect: 'Salto alto + sin daño de caída' },
      { name: 'Kitty Slippers', effect: 'Los creepers huyen de ti' },
      { name: 'Running Shoes', effect: 'Más velocidad y step height al correr' },
      { name: 'Snowshoes', effect: 'Caminar sobre Powder Snow + hielo menos resbaloso' },
      { name: 'Steadfast Spikes', effect: 'Inmunidad al knockback' },
      { name: 'Flippers', effect: "Nadar más rápido (Dolphin's Grace)" },
      { name: 'Rooted Boots', effect: 'Regenerar hambre en hierba' },
      { name: 'Strider Shoes', effect: 'Caminar sobre lava al agacharse' },
    ],
  },
  {
    id: 'held', name: 'HELD ITEMS', nameEs: 'Items de mano', icon: '🍖', color: '#F87171', count: 3,
    items: [
      { name: 'Umbrella', effect: 'Caída lenta + funciona como escudo' },
      { name: 'Everlasting Beef', effect: 'Carne cruda infinita' },
      { name: 'Eternal Steak', effect: 'Carne cocida infinita (¡cocina la Everlasting Beef!)' },
    ],
  },
];

const ARTIFACT_BUILDS = [
  {
    name: 'PVP', emoji: '⚔️', color: '#EF4444', tag: 'Combate',
    items: [
      { slot: '🎩', name: 'Superstitious Hat', effect: '+1 Looting' },
      { slot: '📿', name: 'Cross Necklace', effect: 'más invencibilidad' },
      { slot: '🔋', name: 'Crystal Heart', effect: '+5 corazones' },
      { slot: '🧤', name: 'Power Glove', effect: 'más daño' },
      { slot: '👟', name: 'Steadfast Spikes', effect: 'inmune a knockback' },
    ],
  },
  {
    name: 'Minero', emoji: '⛏️', color: '#3B82F6', tag: 'Minería',
    items: [
      { slot: '🎩', name: 'Night Vision Goggles', effect: 'visión nocturna' },
      { slot: '📿', name: 'Lucky Scarf', effect: '+1 Fortune' },
      { slot: '🔋', name: 'Universal Attractor', effect: 'atrae items' },
      { slot: '🧤', name: 'Pickaxe Heater', effect: 'auto-fundición' },
      { slot: '👟', name: 'Running Shoes', effect: 'velocidad' },
    ],
  },
  {
    name: 'Explorador', emoji: '🌊', color: '#06B6D4', tag: 'Exploración',
    items: [
      { slot: '🎩', name: 'Snorkel', effect: 'respirar bajo agua' },
      { slot: '📿', name: 'Panic Necklace', effect: 'velocidad al huir' },
      { slot: '🔋', name: 'Cloud in a Bottle', effect: 'doble salto' },
      { slot: '🧤', name: 'Digging Claws', effect: 'minar rápido' },
      { slot: '👟', name: 'Aqua-Dashers', effect: 'caminar sobre agua' },
    ],
  },
  {
    name: 'Supervivencia', emoji: '🏹', color: '#22C55E', tag: 'Supervivencia',
    items: [
      { slot: '🎩', name: "Angler's Hat", effect: 'mejor pesca' },
      { slot: '📿', name: 'Flame Pendant', effect: 'prender fuego' },
      { slot: '🔋', name: 'Obsidian Skull', effect: 'resistencia al fuego' },
      { slot: '🧤', name: 'Vampiric Glove', effect: 'robo de vida' },
      { slot: '👟', name: 'Bunny Hoppers', effect: 'sin daño de caída' },
    ],
  },
  {
    name: 'Diversión', emoji: '🎭', color: '#A855F7', tag: 'Fun',
    items: [
      { slot: '🎩', name: 'Novelty Drinking Hat', effect: 'comer ultra rápido' },
      { slot: '📿', name: 'Scarf of Invisibility', effect: 'invisible' },
      { slot: '🔋', name: 'Helium Flamingo', effect: 'volar nadando' },
      { slot: '🧤', name: 'Onion Ring', effect: 'haste al comer' },
      { slot: '👟', name: 'Kitty Slippers', effect: 'creepers huyen' },
    ],
  },
];

const TOP_ARTIFACTS = [
  { name: 'Crystal Heart', effect: '+5 corazones', reason: 'El mejor para PVP' },
  { name: 'Lucky Scarf', effect: '+1 Fortune', reason: 'El mejor para minería' },
  { name: 'Cloud in a Bottle', effect: 'Doble salto', reason: 'El más divertido' },
  { name: 'Night Vision Goggles', effect: 'Visión nocturna', reason: 'El más útil' },
  { name: 'Vampiric Glove', effect: 'Lifesteal', reason: 'El mejor para combate' },
  { name: 'Steadfast Spikes', effect: 'Anti-knockback', reason: 'Esencial para PVP' },
  { name: 'Bunny Hoppers', effect: 'Sin fall damage', reason: 'Esencial para explorar' },
  { name: 'Pickaxe Heater', effect: 'Auto-smelt', reason: 'Ahorra mucho tiempo' },
  { name: 'Eternal Steak', effect: 'Comida infinita', reason: 'Nunca más tendrás hambre' },
];

const ARTIFACT_FAQ = [
  { q: '¿Necesito instalar algún mod?', a: 'No. Todo funciona desde el servidor. Los modelos 3D se descargan automáticamente via resource pack.' },
  { q: '¿Funciona en Bedrock Edition?', a: 'Sí. Si entras con GeyserMC, los artifacts se ven correctamente con texturas y modelos adaptados.' },
  { q: '¿Puedo equipar varios artifacts a la vez?', a: 'Sí, uno por cada tipo de slot (head, necklace, belt, hands, feet). Puedes tener 5 artifacts equipados simultáneamente.' },
  { q: '¿Los artifacts se pierden al morir?', a: 'Depende de la configuración del servidor. Consulta con los admins o prueba en el servidor.' },
  { q: '¿Los artifacts tienen durabilidad?', a: 'No. Son permanentes (excepto el Chorus Totem que se consume al salvarte de la muerte).' },
  { q: '¿Dónde encuentro artifacts más fácilmente?', a: 'Explora cuevas buscando campamentos abandonados. Los Mimics garantizan un artifact al matarlos.' },
  { q: '¿Puedo intercambiar artifacts con otros jugadores?', a: 'Sí, son items normales que puedes dar, intercambiar o guardar en cofres.' },
  { q: '¿Los efectos se acumulan entre artifacts?', a: 'Sí. Por ejemplo, Crystal Heart (+5 corazones) + Vampiric Glove (lifesteal) = tank con regeneración.' },
  { q: '¿Qué pasa si encuentro un Mimic?', a: 'Se transforma en un mob hostil. Mátalo para obtener un artifact garantizado. Si no estás preparado, ¡huye!' },
  { q: '¿Los campamentos siempre tienen Mimics?', a: 'No siempre. Algunos cofres son normales, otros son Mimics, y otros tienen TNT debajo. Cada campamento es diferente.' },
];

/* ═══════════════════════════════════════════════════════════════
   CRATE CARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function CrateCard({ crateKey }: { crateKey: 'vote' | 'wild' | 'insane' }) {
  const [isOpen, setIsOpen] = useState(false);
  const crate = CRATES_DATA[crateKey];
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => { if (contentRef.current) setHeight(isOpen ? contentRef.current.scrollHeight : 0); }, [isOpen]);

  const hasRewards = (rarity: keyof typeof crate.rewards) => crate.rewards[rarity].length > 0;

  return (
    <div className="rounded-2xl border-2 overflow-hidden transition-all duration-300 hover:shadow-lg" style={{ borderColor: crate.color, boxShadow: isOpen ? `0 0 30px ${crate.color}30` : 'none', background: 'linear-gradient(180deg, #12141a 0%, #0b0c10 100%)' }}>
      <div className="p-5 text-center" style={{ background: `linear-gradient(135deg, ${crate.color}15 0%, transparent 100%)` }}>
        <div className="text-4xl mb-2">{crate.emoji}</div>
        <h3 className="text-2xl font-bold mb-2" style={{ color: crate.color }}>{crate.name}</h3>
        <p className="text-sm text-[#aaa] leading-relaxed">{crate.description}</p>
      </div>
      <div className="px-5 py-4 border-t border-b border-[#1f2833]">
        <h4 className="text-sm font-bold text-[#888] uppercase tracking-wider mb-3">🔑 Cómo conseguir la llave</h4>
        <div className="space-y-2">
          {crate.howToGet.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[#ccc]">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={() => setIsOpen(!isOpen)} className="w-full py-4 flex items-center justify-center gap-2 text-sm font-bold transition-all duration-300 hover:bg-[#1f2833]" style={{ color: crate.color }}>
        <span>{isOpen ? '▲ Ocultar' : '▼ Ver'} recompensas</span>
        <span className="text-xs opacity-60">({Object.values(crate.rewards).flat().length} items)</span>
      </button>
      <div style={{ maxHeight: height }} className="overflow-hidden transition-all duration-500 ease-out">
        <div ref={contentRef} className="px-5 pb-5 space-y-4">
          {hasRewards('comun') && <RaritySection title="Común" color={RARITY_COLORS.comun} items={crate.rewards.comun} />}
          {hasRewards('pocoComun') && <RaritySection title="Poco común" color={RARITY_COLORS.pocoComun} items={crate.rewards.pocoComun} />}
          {hasRewards('raro') && <RaritySection title="Raro" color={RARITY_COLORS.raro} items={crate.rewards.raro} announced={crateKey === 'insane'} />}
          {hasRewards('legendario') && <RaritySection title="✨ JACKPOT - Legendario" color={RARITY_COLORS.legendario} items={crate.rewards.legendario} isLegendary />}
        </div>
      </div>
    </div>
  );
}

function RaritySection({ title, color, items, isLegendary = false, announced = false }: { title: string; color: string; items: string[]; isLegendary?: boolean; announced?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${isLegendary ? 'animate-pulse-subtle' : ''}`} style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold uppercase px-2 py-0.5 rounded" style={{ background: color, color: '#0b0c10' }}>{title}</span>
        {announced && <span className="text-[10px] text-[#888]">📢 Se anuncia al servidor</span>}
        {isLegendary && <span className="text-[10px] text-[#F59E0B]">📢 Se anuncia al servidor</span>}
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className={`text-sm flex items-center gap-1.5 ${isLegendary ? 'font-medium' : ''}`} style={{ color: isLegendary ? color : '#ccc' }}>
            <span style={{ color }} className="text-xs">•</span>
            <span className={isLegendary ? 'animate-shimmer' : ''}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ARTIFACT SLOT CARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function ArtifactSlotCard({ slot }: { slot: typeof ARTIFACTS_SLOTS[0] }) {
  const [isOpen, setIsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => { if (contentRef.current) setHeight(isOpen ? contentRef.current.scrollHeight : 0); }, [isOpen]);

  return (
    <div className="rounded-xl border overflow-hidden transition-all duration-300" style={{ borderColor: `${slot.color}50`, background: 'linear-gradient(180deg, #12141a 0%, #0b0c10 100%)' }}>
      <button onClick={() => setIsOpen(!isOpen)} className="w-full p-4 flex items-center justify-between hover:bg-[#1f2833]/50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{slot.icon}</span>
          <div className="text-left">
            <h4 className="font-bold" style={{ color: slot.color }}>{slot.name}</h4>
            <p className="text-xs text-[#888]">{slot.nameEs} • {slot.count} artifacts</p>
          </div>
        </div>
        <span className={`text-sm transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} style={{ color: slot.color }}>▼</span>
      </button>
      <div style={{ maxHeight: height }} className="overflow-hidden transition-all duration-300">
        <div ref={contentRef} className="px-4 pb-4">
          <div className="rounded-lg overflow-hidden border" style={{ borderColor: `${slot.color}30` }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: `${slot.color}20` }}>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: slot.color }}>Artifact</th>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: slot.color }}>Efecto</th>
                </tr>
              </thead>
              <tbody>
                {slot.items.map((item, i) => (
                  <tr key={i} className={`border-t ${i % 2 === 0 ? 'bg-[#0b0c10]' : 'bg-[#12141a]'}`} style={{ borderColor: `${slot.color}20` }}>
                    <td className="px-3 py-2 text-white font-medium">{item.name}</td>
                    <td className="px-3 py-2 text-[#aaa]">{item.effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HAMBURGER MENU
   ═══════════════════════════════════════════════════════════════ */
function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { player, logout, refreshStats } = useAuth();

  const scrollToSection = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); setIsOpen(false); };
  const stats = player?.stats;
  const hasStats = !!stats;

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-[#0b0c10]/95 backdrop-blur-sm px-4 py-3 border-b border-[#1f2833]">
        <span className="text-xl font-bold bg-gradient-to-r from-[#00ffff] to-[#8a2be2] bg-clip-text text-transparent">VORTEX</span>
        <div className="flex items-center gap-3">
          {player && (
            <div className="hidden sm:flex items-center gap-2 bg-[#1f2833] rounded-lg px-3 py-1.5">
              <img src={stats?.avatarUrl || `https://crafthead.net/avatar/${player.username}/64`} alt={player.username} className="w-7 h-7 rounded" onError={(e) => { (e.target as HTMLImageElement).src = 'https://crafthead.net/avatar/MHF_Steve/64'; }} />
              <span className="text-sm font-medium text-[#00ffff]">{stats?.name || player.username}</span>
              {stats?.rank && <span className="text-[10px] bg-[#8a2be2]/30 text-[#8a2be2] px-1.5 py-0.5 rounded font-medium">{stats.rank}</span>}
            </div>
          )}
          <button onClick={() => setIsOpen(!isOpen)} className="relative z-50 flex flex-col justify-center items-center w-10 h-10 rounded-lg bg-[#1f2833] hover:bg-[#2a3544] transition-colors" aria-label="Menú">
            <span className={`block w-5 h-0.5 bg-[#00ffff] transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-1.5' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#00ffff] mt-1 transition-all duration-300 ${isOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#00ffff] mt-1 transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-1.5' : ''}`} />
          </button>
        </div>
      </header>
      <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsOpen(false)} />
      <nav className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-[#0b0c10] border-l border-[#8a2be2] z-40 transform transition-transform duration-300 ease-out overflow-hidden ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full pt-16 overflow-y-auto">
          <div className="p-5 border-b border-[#1f2833]">
            {player ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <img src={stats?.headUrl || `https://crafthead.net/helm/${player.username}/120`} alt={player.username} className="w-16 h-16 rounded-lg border-2 border-[#8a2be2] shadow-lg shadow-[#8a2be2]/20" onError={(e) => { (e.target as HTMLImageElement).src = 'https://crafthead.net/helm/MHF_Steve/120'; }} />
                    {player.isLoading && <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center"><div className="w-6 h-6 border-2 border-[#00ffff] border-t-transparent rounded-full animate-spin" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold text-white truncate">{stats?.name || player.username}</p>
                    {stats?.rank ? <span className="inline-block mt-1 text-sm bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white px-2 py-0.5 rounded font-medium">{stats.rank}</span> : <p className="text-sm text-[#666]">{hasStats ? 'Sin rango' : 'Datos no disponibles'}</p>}
                  </div>
                </div>
                {hasStats ? (
                  <div className="grid grid-cols-2 gap-2">
                    <StatBox label="Dinero" value={stats.money !== null ? `$${stats.money.toLocaleString()}` : undefined} icon="💰" color="#00ff88" />
                    <StatBox label="Puntos" value={stats.points !== null ? stats.points.toLocaleString() : undefined} icon="⭐" color="#ffcf00" />
                    <StatBox label="Tiempo" value={stats.playtime.formatted} icon="⏱️" color="#00ffff" />
                    <StatBox label="K/D" value={`${stats.kills}/${stats.deaths}`} icon="⚔️" color="#ff6b6b" />
                  </div>
                ) : (
                  <div className="bg-[#1a1a2e] rounded-lg p-4 text-center">
                    {player.error ? <p className="text-sm text-[#ff6b6b]">❌ {player.error}</p> : <p className="text-sm text-[#888]">Cargando estadísticas...</p>}
                  </div>
                )}
                {hasStats && (
                  <div className="bg-[#12141a] rounded-lg p-3 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-[#888]">Kills:</span><span className="text-[#00ff88] font-medium">{stats.kills}</span></div>
                    <div className="flex justify-between"><span className="text-[#888]">Muertes:</span><span className="text-[#ff6b6b] font-medium">{stats.deaths}</span></div>
                    <div className="flex justify-between"><span className="text-[#888]">Ratio K/D:</span><span className="text-[#ffcf00] font-medium">{stats.kd}</span></div>
                    <div className="flex justify-between"><span className="text-[#888]">Horas jugadas:</span><span className="text-[#00ffff] font-medium">{stats.playtime.hours}h {stats.playtime.minutes}m</span></div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={refreshStats} disabled={player.isLoading} className="flex-1 py-2 rounded-lg border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/10 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {player.isLoading ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span>Actualizando</span></> : <>🔄 Actualizar</>}
                  </button>
                  <button onClick={() => { logout(); setIsOpen(false); }} className="px-4 py-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors text-sm">Salir</button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-3">
                <div className="w-16 h-16 mx-auto rounded-lg bg-[#1f2833] flex items-center justify-center border-2 border-dashed border-[#333]"><span className="text-3xl">👤</span></div>
                <div><p className="text-white font-medium">¿Juegas en Vortex?</p><p className="text-[#888] text-sm mt-1">Ingresa tu nombre para ver tus estadísticas</p></div>
                <button onClick={() => { setShowLoginModal(true); setIsOpen(false); }} className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white font-bold hover:opacity-90 transition-opacity">Ver mis Stats</button>
                <p className="text-[10px] text-[#555]">Opcional - El menú funciona sin iniciar sesión</p>
              </div>
            )}
          </div>
          <div className="flex-1 p-5">
            <p className="text-xs uppercase tracking-wider text-[#666] mb-3">Navegación</p>
            <div className="space-y-1">
              {NAV_SECTIONS.map((section) => (
                <button key={section.id} onClick={() => scrollToSection(section.id)} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-[#cccccc] hover:bg-[#1f2833] hover:text-[#00ffff] transition-colors">
                  <span className="text-lg">{section.icon}</span><span>{section.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs uppercase tracking-wider text-[#666] mt-6 mb-3">Enlaces Rápidos</p>
            <a href={CONFIG.DISCORD_URL} target="_blank" rel="noopener noreferrer" className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-[#cccccc] hover:bg-[#5865F2]/20 hover:text-[#5865F2] transition-colors" onClick={() => setIsOpen(false)}>
              <span className="text-lg">💬</span><span>Discord</span><span className="ml-auto text-xs text-[#666]">↗</span>
            </a>
          </div>
          <div className="p-4 border-t border-[#1f2833] text-center"><p className="text-xs text-[#666]">IP: <span className="text-[#00ffff]">{CONFIG.SERVER_IP}</span></p></div>
        </div>
      </nav>
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: string | number | undefined; icon: string; color: string }) {
  const hasValue = value !== undefined && value !== null;
  return (
    <div className="bg-[#1f2833] rounded-lg p-2.5 text-center">
      <p className="text-lg">{icon}</p>
      <p className="text-sm font-bold truncate" style={{ color: hasValue ? color : '#666' }}>{hasValue ? value : '—'}</p>
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
    if (result.success) onClose();
    else { setError(result.error || 'Error desconocido'); setIsLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#12141a] rounded-2xl border border-[#8a2be2] shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-[#8a2be2]/20 to-[#00ffff]/20 px-6 py-4 border-b border-[#1f2833]">
          <h3 className="text-xl font-bold text-white flex items-center gap-2"><span>📊</span> Ver mis Estadísticas</h3>
          <p className="text-sm text-[#888] mt-1">Ingresa tu nombre de Minecraft del servidor</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[#888] mb-2">Nombre de Usuario</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tu nombre en el servidor" className="w-full px-4 py-3 rounded-lg bg-[#0b0c10] border border-[#1f2833] text-white placeholder-[#555] focus:border-[#00ffff] focus:outline-none focus:ring-1 focus:ring-[#00ffff] transition-colors" autoFocus disabled={isLoading} maxLength={16} />
          </div>
          {error && <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2"><span>❌</span><span>{error}</span></div>}
          <div className="bg-[#1a1a2e] rounded-lg p-3 text-xs text-[#888] space-y-1">
            <p className="flex items-center gap-2"><span className="text-[#00ffff]">ℹ️</span><span>Usa el mismo nombre con el que juegas en Vortex Network</span></p>
            <p className="flex items-center gap-2"><span className="text-green-400">✓</span><span>Funciona con cuentas Premium y No-Premium</span></p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-lg border border-[#1f2833] text-[#888] hover:bg-[#1f2833] transition-colors" disabled={isLoading}>Cancelar</button>
            <button type="submit" disabled={isLoading || !username.trim()} className="flex-1 py-3 rounded-lg bg-gradient-to-r from-[#8a2be2] to-[#00ffff] text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
              {isLoading ? <span className="flex items-center justify-center gap-2"><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Buscando...</span> : 'Ver Stats'}
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
  useEffect(() => { if (contentRef.current) setHeight(open ? contentRef.current.scrollHeight : 0); }, [open]);

  return (
    <div className={`mb-3 rounded-lg border transition-all duration-300 ${open ? 'border-[#00ffff] shadow-[0_0_10px_rgba(0,255,255,0.1)]' : 'border-[#1f2833]'} bg-[#12141a]`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-4 text-left text-lg font-bold text-[#ffcf00] cursor-pointer">
        <span>{title}</span>
        <span className={`text-[#00ffff] text-sm transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      <div style={{ maxHeight: height }} className="overflow-hidden transition-all duration-300">
        <div ref={contentRef} className="border-t border-dashed border-[#1f2833] px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function Cmd({ name, desc }: { name: string; desc: string }) {
  return <div className="mb-2.5 text-[1.05rem]"><span className="rounded bg-[#050505] px-2 py-0.5 font-mono font-bold text-[#00ffff]">{name}</span><span className="ml-2.5 text-[#cccccc]">{desc}</span></div>;
}
function CmdNote({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-sm italic text-[#8a2be2]">{children}</span>;
}
function PointsTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#1f2833]">
      <table className="w-full text-left text-sm">
        <thead><tr className="bg-[#1a1a2e]">{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold text-[#00ffff]">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, ri) => <tr key={ri} className={`border-t border-[#1f2833] ${ri % 2 === 0 ? 'bg-[#12141a]' : 'bg-[#0e1015]'} transition-colors hover:bg-[#1f2833]`}>{row.map((cell, ci) => <td key={ci} className={`whitespace-nowrap px-4 py-2.5 ${ci === row.length - 1 ? 'font-bold text-[#ffcf00]' : 'text-[#cccccc]'}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   FAQ ACCORDION FOR ARTIFACTS
   ═══════════════════════════════════════════════════════════════ */
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#1f2833]">
      <button onClick={() => setOpen(!open)} className="w-full py-4 flex items-center justify-between text-left hover:bg-[#1f2833]/30 transition-colors px-4">
        <span className="font-medium text-white">{q}</span>
        <span className={`text-[#8B5CF6] transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      <div className={`overflow-hidden transition-all duration-300 ${open ? 'max-h-40 pb-4 px-4' : 'max-h-0'}`}>
        <p className="text-[#aaa] text-sm">{a}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════ */
function MainContent() {
  const [copied, setCopied] = useState(false);
  const copyIP = () => { navigator.clipboard.writeText(CONFIG.SERVER_IP).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); }); };

  return (
    <div className="min-h-screen bg-[#0b0c10] font-sans text-white pt-14">
      <HamburgerMenu />

      {/* Hero */}
      <section id="hero" className="border-b-2 border-[#8a2be2] bg-[radial-gradient(circle_at_center,#1a1a2e_0%,#0b0c10_100%)] px-5 py-24 text-center">
        <h1 className="mt-5 mb-0 bg-gradient-to-r from-[#00ffff] to-[#8a2be2] bg-clip-text text-5xl md:text-6xl font-extrabold uppercase tracking-wider text-transparent">Vortex Network</h1>
        <h2 className="mt-1 text-2xl font-light tracking-[3px] text-[#ffcf00]">Survival Remastered</h2>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
          <button onClick={copyIP} className={`flex cursor-pointer items-center justify-center rounded-lg border-2 px-8 py-4 text-lg font-bold transition-all duration-300 ${copied ? 'border-[#ffcf00] bg-[#ffcf00] text-[#0b0c10] shadow-[0_0_15px_#ffcf00]' : 'border-[#00ffff] bg-[#1f2833] text-[#00ffff] hover:bg-[#00ffff] hover:text-[#0b0c10] hover:shadow-[0_0_15px_#00ffff]'}`}>{copied ? '¡IP COPIADA!' : `COPIAR IP: ${CONFIG.SERVER_IP}`}</button>
          <a href={CONFIG.DISCORD_URL} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center rounded-lg border-2 border-[#8a2be2] bg-[#8a2be2] px-8 py-4 text-lg font-bold text-white no-underline transition-all duration-300 hover:bg-transparent hover:text-[#8a2be2] hover:shadow-[0_0_15px_#8a2be2]">ÚNETE A DISCORD</a>
        </div>
      </section>

      {/* Info */}
      <section id="info" className="mx-auto max-w-3xl px-5 py-16 text-center scroll-mt-20">
        <h2 className="mb-5 text-4xl font-bold text-[#00ffff]">Entra en la Espiral</h2>
        <p className="text-lg leading-relaxed text-[#cccccc]">Bienvenido a Vortex Network. Disfruta de una experiencia de supervivencia única con nuestra modalidad <strong className="text-white">Survival Remastered</strong>. Únete a nuestra comunidad, construye tu imperio, comercia con otros jugadores y conquista el mundo.</p>
      </section>

      {/* Rules */}
      <section id="rules" className="mx-auto max-w-3xl px-5 pb-16 scroll-mt-20">
        <div className="rounded-xl border-l-4 border-[#ffcf00] bg-[#12141a] p-8 md:p-10">
          <h2 className="mt-0 mb-6 text-center text-3xl font-bold text-[#ffcf00]">Reglas del Servidor</h2>
          <ul className="list-none space-y-4 p-0">
            {[
              { title: 'Respeto mutuo:', text: 'Trata a todos los jugadores con respeto. No se tolera la toxicidad, los insultos o el acoso de ningún tipo.' },
              { title: 'Prohibido el uso de Hacks:', text: 'Juega limpio. El uso de clientes modificados, rayos X (X-Ray) o cualquier ventaja injusta resultará en ban permanente.' },
              { title: 'Cero grifeo:', text: 'Respeta las construcciones y cofres de los demás. Destruir el trabajo ajeno no está permitido.' },
              { title: 'No hacer SPAM:', text: 'Mantén el chat limpio. Evita el uso excesivo de mayúsculas, flood o la promoción de otros servidores.' },
              { title: 'Diviértete:', text: 'El objetivo principal es pasarla bien. ¡Colabora, explora y disfruta de la supervivencia!' },
            ].map((rule, i) => <li key={i} className="relative pl-5 text-lg leading-relaxed text-[#cccccc]"><span className="absolute left-0 top-0 text-[#8a2be2]">➤</span><strong className="text-white">{rule.title}</strong> {rule.text}</li>)}
          </ul>
        </div>
      </section>

      {/* Commands */}
      <section id="commands" className="mx-auto max-w-3xl px-5 pb-16 scroll-mt-20">
        <h2 className="mb-2 text-center text-4xl font-bold text-[#8a2be2]">📋 Comandos para Jugadores</h2>
        <p className="mb-8 text-center text-lg text-[#cccccc]">Despliega las categorías para ver todos los comandos disponibles en el servidor.</p>

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

        <AccordionItem title="🌍 BetterRTP (Teletransporte Aleatorio)">
          <Cmd name="/rtp" desc="Teletransportarte a ubicación aleatoria" />
          <Cmd name="/rtp <mundo>" desc="RTP en un mundo específico" />
          <CmdNote>Nota: Cooldown de 10 minutos entre usos. Hay un delay de 5 segundos antes del TP (se cancela si te mueves).</CmdNote>
        </AccordionItem>

        <AccordionItem title="⚔️ AuraSkills (Habilidades RPG) & 💼 Jobs">
          <Cmd name="/skills" desc="Ver tus habilidades (AuraSkills)" />
          <Cmd name="/stats" desc="Ver estadísticas RPG" />
          <Cmd name="/skills top" desc="Ranking de habilidades" />
          <Cmd name="/jobs browse" desc="Ver trabajos disponibles" />
          <Cmd name="/jobs join <trabajo>" desc="Unirte a un trabajo" />
          <Cmd name="/jobs leave <trabajo>" desc="Dejar un trabajo" />
          <Cmd name="/jobs quests" desc="Ver misiones de trabajo" />
        </AccordionItem>

        <AccordionItem title="🏪 Economía y Tiendas (EconomyShopGUI, QuickShop, PlayerAuctions, Mochilas)">
          <Cmd name="/shop" desc="Abrir la tienda principal del servidor" />
          <Cmd name="/mochilas (o /bolsas)" desc="Abrir la tienda de mochilas" />
          <Cmd name="/sellall" desc="Vender todos los items vendibles del inventario" />
          <Cmd name="/ah (o /pauction)" desc="Abrir la casa de subastas de jugadores" />
          <Cmd name="/ah sell <precio>" desc="Vender el item que tienes en la mano" />
          <CmdNote>Para QuickShop (Tiendas físicas): Golpea un cofre con un item para crear la tienda.</CmdNote>
          <div className="mt-2" />
          <Cmd name="/qs create <precio>" desc="Crear tienda en el cofre apuntado" />
          <Cmd name="/qs buy / sell" desc="Cambiar tienda a modo compra o venta" />
          <Cmd name="/qs price <precio>" desc="Cambiar precio de tu tienda" />
        </AccordionItem>

        <AccordionItem title="🎒 Mochilas (HavenBags)">
          <Cmd name="/mochilas (o /bolsas)" desc="Abrir la tienda de mochilas" />
          <Cmd name="/havenbags (o /bag)" desc="Comando base" />
          <Cmd name="/bags rename <nombre>" desc="Reclamar y poner nombre a tu mochila (OBLIGATORIO al comprar)" />
          <Cmd name="/havenbags gui" desc="Abrir GUI para restaurar o eliminar tus propias mochilas" />
          <Cmd name="/havenbags empty" desc="Vaciar el contenido de tu mochila al suelo" />
          <Cmd name="/havenbags autopickup <categoría>" desc="Configurar auto-recolección de items" />
          <Cmd name="/havenbags trust <jugador>" desc="Dar confianza a otro jugador para abrir tu mochila" />
          <Cmd name="/havenbags untrust <jugador>" desc="Quitar esa confianza" />
          <Cmd name="/havenbags autosort <on/off>" desc="Activar o desactivar orden automático del contenido" />
          <Cmd name="/havenbags magnet <on/off>" desc="Activar imán que succiona items cercanos" />
          <Cmd name="/havenbags refill <on/off>" desc="Reponer automáticamente el último bloque desde la mochila" />
          <Cmd name="/havenbags help" desc="Ver ayuda de comandos según tus permisos" />
        </AccordionItem>

        <AccordionItem title="🔄 Intercambios, Puntos y Extras">
          <Cmd name="/trade <jugador>" desc="Solicitud de intercambio (Shift + Click derecho también funciona)" />
          <Cmd name="/points" desc="Ver tus PlayerPoints" />
          <Cmd name="/puntoss" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/ptshop" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/puntoshop" desc="Abrir la tienda de canje de puntos" />
          <Cmd name="/baubles" desc="Abre tu inventario de accesorios mágicos (PaperArtifacts). Equipa artifacts como anillos, amuletos, cinturones, guantes y botas con efectos pasivos únicos." />
          <Cmd name="/dailyreward (o /dr)" desc="Reclamar recompensa diaria" />
          <Cmd name="/sit / lay / crawl" desc="Sentarse, acostarse o gatear (GSit)" />
          <Cmd name="/em" desc="Menú principal de EliteMobs" />
          <Cmd name="/crates" desc="Ver cajas disponibles (Click derecho a una caja física con la llave para abrirla)" />
          <CmdNote>Los comandos /puntoss, /ptshop y /puntoshop abren la misma tienda de puntos — ¡usa el que prefieras!</CmdNote>
        </AccordionItem>

        <p className="mt-5 text-center text-lg text-[#cccccc]">💡 <strong className="text-white">Tip:</strong> Puedes usar <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">/help</code> en el juego para ver una lista general, o presionar <strong className="text-white">TAB</strong> después de escribir <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">/</code> para autocompletar comandos.</p>
      </section>

      {/* Crates */}
      <section id="crates" className="mx-auto max-w-6xl px-5 pb-20 scroll-mt-20">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-3"><span className="bg-gradient-to-r from-[#F59E0B] via-[#F97316] to-[#EF4444] bg-clip-text text-transparent">🎁 Crates</span></h2>
          <p className="text-lg text-[#888]">Todas las crates están en el <code className="bg-[#1f2833] px-2 py-1 rounded text-[#00ffff]">/spawn</code> del servidor</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <CrateCard crateKey="vote" />
          <CrateCard crateKey="wild" />
          <CrateCard crateKey="insane" />
        </div>
        <div className="mt-10 p-5 rounded-xl bg-[#12141a] border border-[#1f2833]">
          <h4 className="text-sm font-bold text-[#888] uppercase tracking-wider mb-4 text-center">🎨 Leyenda de Rarezas</h4>
          <div className="flex flex-wrap justify-center gap-4">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: RARITY_COLORS.comun }}></span><span className="text-sm text-[#ccc]">Común</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: RARITY_COLORS.pocoComun }}></span><span className="text-sm text-[#ccc]">Poco común</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: RARITY_COLORS.raro }}></span><span className="text-sm text-[#ccc]">Raro</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full animate-pulse" style={{ background: RARITY_COLORS.legendario }}></span><span className="text-sm text-[#F59E0B]">✨ Legendario (JACKPOT)</span></div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          ARTIFACTS SECTION
          ═══════════════════════════════════════════════════════════════ */}
      <section id="artifacts" className="mx-auto max-w-6xl px-5 pb-20 scroll-mt-20">
        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-3">
            <span className="bg-gradient-to-r from-[#8B5CF6] via-[#A78BFA] to-[#C4B5FD] bg-clip-text text-transparent">⚔️ Sistema de Artifacts</span>
          </h2>
          <p className="text-lg text-[#888] mb-4">47 accesorios mágicos con modelos 3D personalizados</p>
          <p className="text-[#aaa] max-w-3xl mx-auto leading-relaxed">
            Vortex Network cuenta con un sistema de accesorios mágicos basado en el mod "Artifacts" de Minecraft. 
            Más de 45 items únicos con modelos 3D personalizados que puedes encontrar explorando, matando mobs, 
            saqueando mazmorras y derrotando Mimics.
          </p>
          <div className="mt-6 inline-flex items-center gap-3 bg-[#8B5CF6]/20 border border-[#8B5CF6]/50 rounded-lg px-6 py-3">
            <span className="text-2xl">🎒</span>
            <div className="text-left">
              <p className="text-xs text-[#888] uppercase tracking-wider">Comando</p>
              <code className="text-[#A78BFA] font-bold text-lg">/baubles</code>
            </div>
          </div>
        </div>

        {/* What are artifacts */}
        <div className="bg-gradient-to-r from-[#8B5CF6]/10 to-[#A78BFA]/5 border border-[#8B5CF6]/30 rounded-2xl p-6 md:p-8 mb-10">
          <h3 className="text-2xl font-bold text-[#A78BFA] mb-4">🔮 ¿Qué son los Artifacts?</h3>
          <div className="space-y-3 text-[#ccc]">
            <p>Los Artifacts son accesorios mágicos con texturas y modelos 3D personalizados que se equipan en un <strong className="text-white">inventario especial</strong> separado del inventario normal.</p>
            <p><strong className="text-[#22C55E]">NO necesitas ningún mod del lado del cliente</strong> — todo funciona automáticamente desde el servidor.</p>
            <p>Cada artifact tiene un <strong className="text-white">efecto pasivo único</strong> que se activa automáticamente al equiparlo. Puedes combinar varios artifacts en diferentes slots para crear builds personalizados.</p>
          </div>
        </div>

        {/* Slots Grid */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-center text-white mb-6">📦 Slots de Equipamiento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ARTIFACTS_SLOTS.map((slot) => <ArtifactSlotCard key={slot.id} slot={slot} />)}
          </div>
          <p className="text-center text-[#888] mt-4 text-sm">Total: <span className="text-[#A78BFA] font-bold">47 artifacts</span> únicos con modelos 3D personalizados</p>
        </div>

        {/* Campamentos y Mimics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-[#12141a] border border-[#1f2833] rounded-xl p-6">
            <h4 className="text-xl font-bold text-[#34D399] mb-4">🏕️ Campamentos Abandonados</h4>
            <p className="text-[#aaa] mb-4">El plugin genera estructuras subterráneas naturales llamadas "Abandoned Campsites" dentro de las cuevas del mundo.</p>
            <p className="text-[#888] text-sm mb-2">Contienen:</p>
            <ul className="space-y-1 text-sm text-[#ccc]">
              <li>• Camas, mesas de crafteo, hornos</li>
              <li>• Barriles y cofres con loot</li>
              <li>• Pueden contener artifacts</li>
            </ul>
          </div>
          <div className="bg-[#12141a] border border-[#EF4444]/30 rounded-xl p-6">
            <h4 className="text-xl font-bold text-[#EF4444] mb-4">👹 ¡Cuidado con los Mimics!</h4>
            <p className="text-[#aaa] mb-4">Los Mimics son mobs hostiles disfrazados de cofres normales. Se encuentran SOLO dentro de los campamentos abandonados.</p>
            <ul className="space-y-1 text-sm text-[#ccc]">
              <li>• Se ven exactamente como cofres normales</li>
              <li>• Al abrirlos, se transforman en mob hostil</li>
              <li>• <span className="text-[#F59E0B] font-medium">Dropean artifact GARANTIZADO</span></li>
              <li>• ⚠️ Algunos cofres tienen TNT debajo</li>
            </ul>
          </div>
        </div>

        {/* How to find */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-center text-white mb-6">📍 Cómo Encontrar Artifacts</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { icon: '🗺️', title: 'Cofres de Loot', desc: 'Mazmorras, templos, bastiones, ciudades del End, mineshafts, strongholds' },
              { icon: '🧟', title: 'Drops de Mobs', desc: 'Mobs específicos dropean artifacts temáticos (ej: Drowned → Flippers)' },
              { icon: '🏕️', title: 'Campamentos', desc: 'Estructuras subterráneas con cofres de loot en cuevas' },
              { icon: '👹', title: 'Mimics', desc: 'Cofres falsos que dropean artifact GARANTIZADO al matarlos' },
              { icon: '📋', title: 'Comandos Admin', desc: '/artifacts give, /artifacts list' },
            ].map((method, i) => (
              <div key={i} className="bg-[#12141a] border border-[#1f2833] rounded-lg p-4 text-center hover:border-[#8B5CF6]/50 transition-colors">
                <span className="text-3xl mb-2 block">{method.icon}</span>
                <h5 className="font-bold text-white text-sm mb-1">{method.title}</h5>
                <p className="text-[#888] text-xs">{method.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Builds Sugeridos */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-center text-white mb-6">🎮 Builds Sugeridos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {ARTIFACT_BUILDS.map((build, i) => (
              <div key={i} className="bg-[#12141a] border rounded-xl overflow-hidden" style={{ borderColor: `${build.color}50` }}>
                <div className="p-4 text-center" style={{ background: `linear-gradient(135deg, ${build.color}20 0%, transparent 100%)` }}>
                  <span className="text-3xl">{build.emoji}</span>
                  <h5 className="font-bold mt-2" style={{ color: build.color }}>{build.name}</h5>
                  <span className="text-[10px] px-2 py-0.5 rounded mt-1 inline-block" style={{ background: `${build.color}30`, color: build.color }}>{build.tag}</span>
                </div>
                <div className="p-3 space-y-1.5">
                  {build.items.map((item, j) => (
                    <div key={j} className="flex items-center gap-2 text-xs">
                      <span>{item.slot}</span>
                      <span className="text-white font-medium truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Artifacts */}
        <div className="mb-12">
          <h3 className="text-2xl font-bold text-center text-white mb-2">🌟 Artifacts más Codiciados</h3>
          <p className="text-center text-[#888] mb-6 text-sm">Los favoritos de la comunidad</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TOP_ARTIFACTS.map((artifact, i) => (
              <div key={i} className="bg-gradient-to-r from-[#F59E0B]/10 to-transparent border border-[#F59E0B]/30 rounded-lg p-4 flex items-center gap-4">
                <span className="text-2xl">✨</span>
                <div className="flex-1 min-w-0">
                  <h5 className="font-bold text-[#F59E0B] truncate">{artifact.name}</h5>
                  <p className="text-xs text-[#888]">{artifact.effect}</p>
                  <p className="text-xs text-[#666] italic">{artifact.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Easter Egg */}
        <div className="bg-gradient-to-r from-[#F59E0B]/20 to-[#EF4444]/10 border border-[#F59E0B]/40 rounded-xl p-6 mb-12 text-center">
          <span className="text-4xl mb-3 block">🥩</span>
          <h4 className="text-xl font-bold text-[#F59E0B] mb-2">💡 ¿Sabías que...?</h4>
          <p className="text-[#ccc]">
            El <strong className="text-white">Eternal Steak</strong> (carne cocida infinita) se consigue <strong className="text-[#F59E0B]">cocinando la Everlasting Beef</strong> (carne cruda infinita) en un horno. 
            ¡Es un easter egg del plugin que muchos jugadores no conocen!
          </p>
        </div>

        {/* FAQ */}
        <div className="bg-[#12141a] border border-[#1f2833] rounded-xl overflow-hidden mb-12">
          <div className="bg-[#8B5CF6]/10 border-b border-[#1f2833] px-6 py-4">
            <h3 className="text-xl font-bold text-[#A78BFA]">❓ Preguntas Frecuentes</h3>
          </div>
          <div>
            {ARTIFACT_FAQ.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gradient-to-r from-[#8B5CF6]/20 via-[#A78BFA]/10 to-[#8B5CF6]/20 border border-[#8B5CF6]/30 rounded-2xl p-8">
          <h3 className="text-2xl font-bold text-white mb-2">¡Sal a explorar y encuentra tu primer artifact!</h3>
          <p className="text-[#aaa] mb-6">Explora cuevas, derrota Mimics y crea tu build perfecto</p>
          <div className="inline-flex items-center gap-2 bg-[#8B5CF6] text-white px-6 py-3 rounded-lg font-bold">
            <span>🎒</span>
            <code>/baubles</code>
          </div>
        </div>
      </section>

      {/* Points Section */}
      <section id="points" className="mx-auto max-w-4xl px-5 pb-20 scroll-mt-20">
        <h2 className="mb-2 text-center text-4xl font-bold"><span className="bg-gradient-to-r from-[#ffcf00] to-[#ff8c00] bg-clip-text text-transparent">Formas de Ganar Puntos</span></h2>
        <p className="mb-10 text-center text-lg text-[#cccccc]">Acumula puntos con cada acción que realices en el servidor y canjéalos en la tienda con <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">/puntoss</code>, <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">/ptshop</code> o <code className="rounded bg-[#050505] px-1.5 py-0.5 text-[#00ffff]">/puntoshop</code>.</p>

        <div className="space-y-10">
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">🎮 Por Jugar / Conectarse</h3><PointsTable headers={['Acción', 'Puntos']} rows={[['Primera vez que entras al servidor', '+100'], ['Login diario', '+25'], ['Racha día 1', '+10'], ['Racha día 2', '+20'], ['Racha día 3', '+30'], ['Racha máxima (día 10+)', '+100'], ['Bonus semanal (7 días seguidos)', '+200'], ['Cada 30 minutos jugando', '+15']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">⚔️ Por Matar Mobs</h3><PointsTable headers={['Mob', 'Puntos']} rows={[['Zombie / Skeleton / Spider', '+2'], ['Creeper / Drowned / Husk / Stray', '+3'], ['Enderman / Witch / Guardian', '+5'], ['Blaze', '+6'], ['Ghast / Shulker', '+8'], ['Wither Skeleton / Iron Golem', '+10'], ['Ravager', '+15'], ['Elder Guardian', '+150'], ['Wither', '+300'], ['Ender Dragon', '+500']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">🗡️ Por PVP</h3><PointsTable headers={['Acción', 'Puntos']} rows={[['Matar a un jugador', '+20'], ['Ser eliminado por un jugador', '-10']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">⛏️ Por Minar</h3><PointsTable headers={['Mineral', 'Puntos']} rows={[['Cobre', '+2'], ['Hierro', '+3'], ['Redstone', '+4'], ['Oro / Nether Gold', '+4 a +8'], ['Lapislázuli', '+5'], ['Esmeralda', '+12'], ['Diamante', '+15'], ['Ancient Debris', '+25']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">🔨 Por Craftear</h3><PointsTable headers={['Item', 'Puntos']} rows={[['Armadura Diamante (pieza)', '+15 a +20'], ['Espada / Pico / Hacha Diamante', '+20'], ['Yunque / Mesa Encantamiento', '+20 a +30'], ['Armadura Netherita (pieza)', '+60 a +80'], ['Espada / Pico / Hacha Netherita', '+50'], ['Beacon', '+200']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">💼 Por Jobs</h3><PointsTable headers={['Acción', 'Puntos']} rows={[['Unirse a cualquier Job', '+10'], ['Subir de nivel en cualquier Job', '+50'], ['Completar Quest de cualquier Job', '+75']]} /></div>
          <div><h3 className="mb-4 text-2xl font-bold text-[#00ffff]">🎣 Por Pescar</h3><PointsTable headers={['Acción', 'Puntos']} rows={[['Pescar cualquier pez', '+3'], ['Pescar entidad especial', '+5']]} /></div>
          <div className="rounded-xl border border-[#8a2be2] bg-[#12141a] p-6 md:p-8">
            <h3 className="mb-6 text-center text-2xl font-bold text-[#ffcf00]">🏆 Resumen Visual</h3>
            <div className="space-y-3 font-mono text-base md:text-lg">
              {[{ medal: '🥇', action: 'Matar Ender Dragon', pts: '+500 pts', note: '(el mayor)' }, { medal: '🥈', action: 'Matar Wither', pts: '+300 pts', note: '' }, { medal: '🥉', action: 'Craftear Beacon', pts: '+200 pts', note: '' }, { medal: '4️⃣', action: 'Bonus Semanal', pts: '+200 pts', note: '' }, { medal: '5️⃣', action: 'Matar Elder Guardian', pts: '+150 pts', note: '' }, { medal: '...', action: '', pts: '', note: '' }, { medal: '⬇️', action: 'Pescar un pez', pts: '+3 pts', note: '(el menor)' }].map((item, i) => item.action === '' ? <div key={i} className="text-center text-[#666666]">•••</div> : <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#0b0c10] px-4 py-3"><span className="mr-1 text-xl">{item.medal}</span><span className="text-[#cccccc]">{item.action}</span><span className="text-[#00ffff]">→</span><span className="font-bold text-[#ffcf00]">{item.pts}</span>{item.note && <span className="text-sm text-[#8a2be2]">{item.note}</span>}</div>)}
            </div>
            <div className="mt-8 rounded-lg border border-dashed border-[#00ffff] bg-[#0b0c10] p-5 text-center">
              <p className="text-lg leading-relaxed text-[#cccccc]">💡 <strong className="text-white">La forma más rápida de acumular puntos</strong> es subir niveles en <span className="font-bold text-[#00ffff]">Jobs</span> + jugar tiempo seguido + matar <span className="font-bold text-[#8a2be2]">bosses</span></p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1f2833] bg-[#050505] py-5 text-center text-sm text-[#666666]">
        <p>&copy; 2026 Vortex Network. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
}

export default function App() {
  return <AuthProvider><MainContent /></AuthProvider>;
}
