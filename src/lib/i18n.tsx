"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Locale = "en" | "es";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key: string) => key,
});

export function useI18n() {
  return useContext(I18nContext);
}

// Translation dictionary — English keys map to Spanish values
// English strings are the keys themselves (no lookup needed for EN)
const ES: Record<string, string> = {
  // Nav
  "Dashboard": "Panel",
  "Settings": "Configuración",
  "Sign Out": "Cerrar Sesión",
  "Admin": "Administración",
  "My Dashboard": "Mi Panel",

  // Claim status
  "Ready": "Listo",
  "Processing": "Procesando",
  "Uploaded": "Subido",
  "Error": "Error",
  "Queued for Processing": "En Cola",

  // Phases
  "Pre-Scope": "Pre-Alcance",
  "Supplement": "Suplemento",
  "Post-Scope": "Post-Alcance",

  // Dashboard
  "Total Claims": "Total de Reclamos",
  "Users": "Usuarios",
  "Contractor RCV": "RCV Contratista",
  "Carrier RCV": "RCV Aseguradora",
  "Variance": "Variación",
  "Wins": "Ganados",
  "New Claim": "Nuevo Reclamo",

  // Claim detail
  "Generated Documents": "Documentos Generados",
  "Uploaded Documents": "Documentos Subidos",
  "Add Documents": "Agregar Documentos",
  "Reprocess Claim": "Reprocesar Reclamo",
  "Review Photos": "Revisar Fotos",
  "Review Scope": "Revisar Alcance",
  "Admin Actions": "Acciones de Admin",
  "+ Upload Files": "+ Subir Archivos",
  "Cancel": "Cancelar",

  // Scope comparison
  "Scope Comparison": "Comparación de Alcance",
  "Roofing": "Techado",
  "Exterior": "Exterior",
  "Missing Items": "Elementos Faltantes",
  "Financial Summary": "Resumen Financiero",
  "Supplement Opportunity": "Oportunidad de Suplemento",
  "Deductible": "Deducible",
  "Items": "Elementos",
  "match": "coincide",
  "missing": "faltante",
  "under": "insuficiente",

  // Estimate & Damage
  "Estimate & Damage Assessment": "Estimado y Evaluación de Daños",
  "Line Items": "Elementos de Línea",
  "Damage Assessment": "Evaluación de Daños",
  "Code Compliance": "Cumplimiento de Código",
  "damage findings": "hallazgos de daño",
  "code citations": "citas de código",

  // Supplement Composer
  "Supplement Composer": "Compositor de Suplemento",
  "Select items to include in your supplement email": "Seleccione elementos para incluir en su correo de suplemento",
  "Select All": "Seleccionar Todo",
  "Clear": "Limpiar",
  "Under-Scoped Items": "Elementos con Alcance Insuficiente",
  "Code Citations": "Citas de Código",
  "Compose Supplement Email": "Componer Correo de Suplemento",
  "Supplement Email": "Correo de Suplemento",
  "Send To (adjuster email)": "Enviar A (correo del ajustador)",
  "Claim Number (subject line)": "Número de Reclamo (línea de asunto)",
  "Copy to Clipboard": "Copiar al Portapapeles",
  "Copied!": "¡Copiado!",
  "Send via Gmail": "Enviar por Gmail",
  "Sending...": "Enviando...",
  "Close": "Cerrar",
  "items selected": "elementos seleccionados",
  "supplement value": "valor del suplemento",

  // Communication Log
  "Communication Log": "Registro de Comunicaciones",
  "sent": "enviados",

  // Photos
  "Photos": "Fotos",
  "Measurements": "Mediciones",
  "Carrier Scope": "Alcance de Aseguradora",
  "Weather Data": "Datos Climáticos",
  "Other": "Otro",

  // Claim Brain
  "Ask your claim anything...": "Pregunta cualquier cosa sobre tu reclamo...",
  "Reset conversation": "Reiniciar conversación",

  // Settings
  "Company Profile": "Perfil de Empresa",
  "Save Profile": "Guardar Perfil",
  "Connect Gmail": "Conectar Gmail",
  "Gmail Connected": "Gmail Conectado",
  "Disconnect": "Desconectar",

  // Homepage
  "Try Free": "Prueba Gratis",
  "Try 3 Free Claims": "Prueba 3 Reclamos Gratis",
  "Get Started": "Comenzar",
  "Pricing": "Precios",
  "Log In": "Iniciar Sesión",
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Persist language preference
  useEffect(() => {
    const saved = localStorage.getItem("dumbroof_locale") as Locale;
    if (saved === "es" || saved === "en") setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("dumbroof_locale", l);
  };

  const t = (key: string): string => {
    if (locale === "en") return key;
    return ES[key] || key; // Fallback to English if no translation
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Language toggle component — small flag/text toggle for the nav bar
 */
export function LanguageToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      onClick={() => setLocale(locale === "en" ? "es" : "en")}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-white/[0.06] transition-colors border border-[var(--border-glass)]"
      title={locale === "en" ? "Cambiar a Español" : "Switch to English"}
    >
      <span className="text-sm">{locale === "en" ? "🇺🇸" : "🇲🇽"}</span>
      <span className="text-[var(--gray)]">{locale === "en" ? "EN" : "ES"}</span>
    </button>
  );
}
