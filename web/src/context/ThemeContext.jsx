import { createContext, useContext, useState, useEffect } from 'react';

const ACCENT_KEY = 'eva_accent_color';
const VALID_ACCENTS = ['blue', 'red', 'purple', 'green', 'orange', 'pink'];

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('eva_theme');
    if (saved === 'light' || saved === 'dark') return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
  });

  const [accentColor, setAccentColorState] = useState(() => {
    const saved = localStorage.getItem(ACCENT_KEY);
    return VALID_ACCENTS.includes(saved) ? saved : 'blue';
  });

  useEffect(() => {
    localStorage.setItem('eva_theme', darkMode ? 'dark' : 'light');
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(ACCENT_KEY, accentColor);
    document.documentElement.setAttribute('data-eva-accent', accentColor);
  }, [accentColor]);

  const toggleTheme = () => setDarkMode((p) => !p);
  const setAccentColor = (color) => {
    if (VALID_ACCENTS.includes(color)) setAccentColorState(color);
  };

  return (
    <ThemeContext.Provider value={{ darkMode, toggleTheme, accentColor, setAccentColor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
