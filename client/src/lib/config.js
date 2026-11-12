import { createContext, useContext, useEffect, useState } from 'react';

export const ConfigContext = createContext(null);
export const useConfig = () => useContext(ConfigContext);

export function useDarkMode() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}
