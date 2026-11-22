export const THEMES = [
  { id: 'purple', name: 'Pimpin Purple', desc: 'Deep purple, neon magenta', bg: '#1E0636', fg: '#F7EEFF', neon: '#FF2BD6' },
  { id: 'emerald', name: 'Emerald Green', desc: 'Forest green, neon mint', bg: '#03261B', fg: '#EAFBF3', neon: '#39FF88' },
  { id: 'sapphire', name: 'Sapphire Blue', desc: 'Navy blue, neon cyan', bg: '#0A1A44', fg: '#EEF3FF', neon: '#00E5FF' },
  { id: 'ruby', name: 'Ruby Red', desc: 'Dark ruby, neon pink', bg: '#33050F', fg: '#FFEFF2', neon: '#FF2E97' },
  { id: 'midnight', name: 'Midnight Black', desc: 'True black, neon lime', bg: '#06060A', fg: '#F2F2F7', neon: '#C6FF00' },
  { id: 'ivory', name: 'Ivory White', desc: 'Warm ivory, neon orange', bg: '#FBF7EC', fg: '#1F1B14', neon: '#FF5F1F' },
  { id: 'panda', name: 'Panda', desc: 'Black and white, neon bamboo green', bg: '#FFFFFF', fg: '#000000', neon: '#39FF14' },
];

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t.bg;
  try { localStorage.setItem('clipema-theme', t.id); } catch {}
  return t.id;
}

export const CATEGORIES = ['Reactions', 'Sports', 'TV and film', 'Music', 'Gaming', 'Animals', 'Group lore', 'Other'];
