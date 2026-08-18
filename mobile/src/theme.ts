import { StyleSheet } from 'react-native';

export const colors = {
  background: '#0b0f14',
  panel: '#151c24',
  panelEdge: '#243240',
  text: '#e6edf3',
  dim: '#8b9bad',
  accent: '#5eb0ef',
  good: '#4cc38a',
  warn: '#e5a03d',
  bad: '#f26d6d',
} as const;

/** Colour for a verdict-shaped value: pass, caution, failure, unknown. */
export function verdictColor(state: 'good' | 'warn' | 'bad' | 'unknown'): string {
  if (state === 'good') return colors.good;
  if (state === 'warn') return colors.warn;
  if (state === 'bad') return colors.bad;
  return colors.dim;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { padding: 16, gap: 12 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 16, fontWeight: '600' },
  p: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  mono: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.panelEdge,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.panelEdge,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#04121f', fontWeight: '700', fontSize: 14 },
  buttonGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  tabBar: {
    flexDirection: 'row',
    borderTopColor: colors.panelEdge,
    borderTopWidth: 1,
    backgroundColor: colors.panel,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabLabel: { fontSize: 14, fontWeight: '600' },
});
