import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Persona context — the active persona (a vendor, or super user) for the Home
// page ONLY. Independent of the global filter context; does not touch filters.
const PersonaCtx = createContext(null);

export function PersonaProvider({ children }) {
  const [personas, setPersonas] = useState([]);
  const [activeId, setActiveId] = useState(() => localStorage.getItem('mm_persona') || 'super');

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((d) => setPersonas(d.personas || []))
      .catch(() => {});
  }, []);

  useEffect(() => { localStorage.setItem('mm_persona', activeId); }, [activeId]);

  const active = useMemo(
    () => personas.find((p) => p.id === activeId) || personas.find((p) => p.id === 'super') || null,
    [personas, activeId]);

  const value = useMemo(() => ({ personas, active, activeId, setActiveId }), [personas, active, activeId]);
  return <PersonaCtx.Provider value={value}>{children}</PersonaCtx.Provider>;
}

export function usePersona() {
  const c = useContext(PersonaCtx);
  if (!c) throw new Error('usePersona must be used within PersonaProvider');
  return c;
}
