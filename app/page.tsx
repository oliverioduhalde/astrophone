"use client"

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { calculateCustomHoroscope, type HoroscopeData } from "@/lib/astrology"
import { GlyphAnimationManager } from "@/lib/glyph-animation"
import { usePlanetAudio, type OfflineMp3AspectEvent, type OfflineMp3PlanetEvent } from "@/lib/use-planet-audio"

const PLANET_GLYPH_SVGS: Record<string, string> = {
  sun: "/planet-glyphs/sun.svg",
  moon: "/planet-glyphs/moon.svg",
  mercury: "/planet-glyphs/mercury.svg",
  venus: "/planet-glyphs/venus.svg",
  mars: "/planet-glyphs/mars.svg",
  jupiter: "/planet-glyphs/jupiter.svg",
  saturn: "/planet-glyphs/saturn.svg",
  uranus: "/planet-glyphs/uranus.svg",
  neptune: "/planet-glyphs/neptune.svg",
  pluto: "/planet-glyphs/pluto.svg",
}

const PLANET_GLYPH_FALLBACK_LABELS: Record<string, string> = {
  asc: "ASC",
  mc: "MC",
}

type SubjectFormData = {
  datetime: string
  location: string
  latitude: string
  longitude: string
}

type GeoSuggestion = {
  name: string
  country: string
  admin1?: string
  latitude: number
  longitude: number
  display: string
}

const PRESET_BA_FORM: SubjectFormData = {
  datetime: "1974-09-16T12:05",
  location: "Buenos Aires, Argentina",
  latitude: "-34.6037",
  longitude: "-58.3816",
}

const PRESET_CAIRO_FORM: SubjectFormData = {
  datetime: "1970-01-01T00:00",
  location: "El Cairo, Egipto",
  latitude: "30.0444",
  longitude: "31.2357",
}

const PRESET_BA77_FORM: SubjectFormData = {
  datetime: "1977-09-28T05:35",
  location: "Buenos Aires, Argentina",
  latitude: "-34.6037",
  longitude: "-58.3816",
}

const EMPTY_SUBJECT_FORM: SubjectFormData = {
  datetime: "",
  location: "",
  latitude: "",
  longitude: "",
}

const MODE_NAME_BY_SIGN_INDEX_BY_LANGUAGE: Record<Language, Record<number, string>> = {
  en: {
    0: "Phrygian Dominant",
    1: "Dorian",
    2: "Lydian",
    3: "Aeolian",
    4: "Ionian",
    5: "Aeolian",
    6: "Ionian",
    7: "Phrygian",
    8: "Mixolydian",
    9: "Harmonic Minor",
    10: "Lydian Dominant",
    11: "Locrian",
  },
  es: {
    0: "Frigio Dominante",
    1: "Dorico",
    2: "Lidio",
    3: "Eolico",
    4: "Jonico",
    5: "Eolico",
    6: "Jonico",
    7: "Frigio",
    8: "Mixolidio",
    9: "Menor Armonico",
    10: "Lidio Dominante",
    11: "Locrio",
  },
}

type AudioEngineMode = "samples" | "fm_pad" | "tibetan_samples"
type InterfaceTheme =
  | "white"
  | "neon_blue"
  | "phosphor_green"
  | "amber_phosphor"
  | "mystical_purpura"
  | "inverted"
type NavigationMode = "astral_chord" | "radial" | "sequential"
type SubjectPreset = "manual" | "here_now" | "ba" | "cairo" | "ba77"
type MajorAspectKey = "conjunction" | "opposition" | "trine" | "square" | "sextile"
type Language = "en" | "es"

// [T-30] User-toggleable phases of the audio render pipeline.
// Exposed via Advanced → Render phases in the burger menu.
// fmPad defaults OFF even in fm_pad/hybrid modes — explicit opt-in.
// finalCompression is a live-playback stage; toggling it does NOT
// invalidate the offline-render cache. All other toggles DO.
type RenderPhases = {
  planets: boolean
  background: boolean
  element: boolean
  fmPad: boolean
  normalizePerLayer: boolean
  renormalizeMix: boolean
  finalCompression: boolean
}
const DEFAULT_RENDER_PHASES: RenderPhases = {
  planets: true,
  background: true,
  element: true,
  fmPad: false,
  normalizePerLayer: true,
  renormalizeMix: false,
  finalCompression: false,
}
const RENDER_PHASES_STORAGE_KEY = "astrophone:render-phases-v1"
const RENDER_PHASE_CACHE_INVALIDATING_KEYS: ReadonlyArray<keyof RenderPhases> = [
  "planets",
  "background",
  "element",
  "fmPad",
  "normalizePerLayer",
  "renormalizeMix",
]

type NavigationPlaybackTimelineItem = {
  name: string
  angle: number
  startSec: number
}

type NavigationPlaybackPlan = {
  audioOptions: {
    events: OfflineMp3PlanetEvent[]
    durationSec: number
    masterVolumePercent: number
    tuningCents?: number
    modalEnabled?: boolean
    modalSunSignIndex?: number | null
    includeBackground?: boolean
    backgroundVolumePercent?: number
    includeElement?: boolean
    elementName?: "fire" | "earth" | "air" | "water"
    elementVolumePercent?: number
    isChordMode?: boolean
    reverbMixPercent?: number
  }
  durationSec: number
  timeline: NavigationPlaybackTimelineItem[]
}

const SEQUENTIAL_PLANET_ORDER = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "sun",
]

const NAVIGATION_TRANSITION_MS = 5000
const CHART_PLANET_HOLD_MS = 15000
const NON_RADIAL_CROSSFADE_MS = 4000
const NON_RADIAL_JITTER_MS = 2000
const NON_RADIAL_INFRACTION_JITTER_MS = 2800
const NON_RADIAL_INFRACTION_PROBABILITY = 0.2
const NON_RADIAL_FADE_SLOWDOWN_MULTIPLIER = 3
const CHORD_POINTER_RADIUS = 16
const CHORD_ASPECTS_FADE_IN_MS = 14000
const CHORD_ASPECTS_HOLD_MS = 5000
const CHORD_ASPECTS_FADE_OUT_MS = 10000
const PLAYBACK_UI_INITIAL_HIDE_DELAY_MS = 1200
const PLAYBACK_UI_AUTO_HIDE_DELAY_MS = 2200
const TOP_PANEL_HINT_MS = 4000
const BUILD_MARK = "V11"

const NAV_MODE_HINT_LABEL_BY_LANGUAGE: Record<Language, Record<NavigationMode, string>> = {
  en: {
    astral_chord: "CHORD",
    radial: "ORBITAL",
    sequential: "CHART",
  },
  es: {
    astral_chord: "ACORDE",
    radial: "ORBITAL",
    sequential: "CARTA",
  },
}
const NAV_MODE_ACTION_LABEL_BY_LANGUAGE: Record<Language, Record<NavigationMode, string>> = {
  en: {
    astral_chord: "Play Chord",
    radial: "Play Orbital",
    sequential: "Play Chart",
  },
  es: {
    astral_chord: "Repro Acorde",
    radial: "Repro Orbital",
    sequential: "Repro Carta",
  },
}
const NAVIGATION_MODES: NavigationMode[] = ["astral_chord", "radial", "sequential"]
const TOP_PANEL_MODE_ORDER: NavigationMode[] = ["radial", "sequential", "astral_chord"]
const TOP_PANEL_DOWNLOAD_TOOLTIP_TEXT = "DOWNLOAD"
const TOP_PANEL_MENU_TOOLTIP_TEXT = "EXTENDED MENU"
const EXPORT_MODE_SUFFIX: Record<NavigationMode, string> = {
  astral_chord: "CHORD",
  radial: "ORBITAL",
  sequential: "CHART",
}
const PHOTO_TOOLTIP_TEXT_BY_LANGUAGE: Record<Language, string> = {
  en: "PHOTO",
  es: "FOTO",
}
const SNAPSHOT_EXPORT_DIMENSION = 1600
const SNAPSHOT_EXPORT_VIEWBOX = {
  x: 0,
  y: 0,
  size: 400,
}
const DOWNLOAD_TOOLTIP_TEXT_BY_LANGUAGE: Record<Language, string> = {
  en: "download audio file (tap twice on mobile)",
  es: "descargar archivo de audio (doble toque en movil)",
}
const ENGINE_OPTIONS_BY_LANGUAGE: Record<Language, Array<{ value: AudioEngineMode; label: string }>> = {
  en: [
    { value: "samples", label: "ASTROLOG SOUNDS" },
    { value: "tibetan_samples", label: "TIBETAN BOWLS" },
    { value: "fm_pad", label: "SYNTH" },
  ],
  es: [
    { value: "samples", label: "SONIDOS ASTROLOG" },
    { value: "tibetan_samples", label: "CUENCOS TIBETANOS" },
    { value: "fm_pad", label: "SINTETIZADOR" },
  ],
}
const INTERFACE_THEME_OPTIONS_BY_LANGUAGE: Record<Language, Array<{ value: InterfaceTheme; label: string }>> = {
  en: [
    { value: "white", label: "White" },
    { value: "neon_blue", label: "Neon Blue" },
    { value: "phosphor_green", label: "Phosphor Green" },
    { value: "amber_phosphor", label: "Amber Phosphor" },
    { value: "mystical_purpura", label: "Mystical Purpura" },
    { value: "inverted", label: "Inverted" },
  ],
  es: [
    { value: "white", label: "Blanco" },
    { value: "neon_blue", label: "Azul Neon" },
    { value: "phosphor_green", label: "Verde Fosforo" },
    { value: "amber_phosphor", label: "Fosforo Ambar" },
    { value: "mystical_purpura", label: "Purpura Mistica" },
    { value: "inverted", label: "Invertido" },
  ],
}
type ThemeSwatch = {
  text: string
  border: string
  hover: string
  activeBg: string
  activeText: string
  activeBorder: string
  shadow: string
  activeShadow: string
}

type ThemeMotionVisual = {
  filter: string
  overlayTone: string
  bloomTone: string
  shellStyle: CSSProperties
}

const INTERFACE_THEME_SWATCH_BY_THEME: Record<InterfaceTheme, ThemeSwatch> = {
  white: {
    text: "rgba(255,255,255,0.92)",
    border: "rgba(255,255,255,0.55)",
    hover: "rgba(255,255,255,0.2)",
    activeBg: "rgba(255,255,255,0.82)",
    activeText: "#050505",
    activeBorder: "rgba(255,255,255,0.96)",
    shadow: "none",
    activeShadow: "0 0 0 1px rgba(255,255,255,0.14)",
  },
  neon_blue: {
    text: "#8fe6ff",
    border: "rgba(143,230,255,0.7)",
    hover: "rgba(143,230,255,0.16)",
    activeBg: "rgba(143,230,255,0.82)",
    activeText: "#02151d",
    activeBorder: "rgba(143,230,255,0.96)",
    shadow: "none",
    activeShadow: "0 0 0 1px rgba(143,230,255,0.18)",
  },
  phosphor_green: {
    text: "#9effb6",
    border: "rgba(97,255,141,0.34)",
    hover: "rgba(7,31,15,0.92)",
    activeBg: "rgba(15,60,28,0.96)",
    activeText: "#d7ffe2",
    activeBorder: "rgba(176,255,196,0.9)",
    shadow: "0 0 0 1px rgba(97,255,141,0.06), inset 0 0 10px rgba(97,255,141,0.05)",
    activeShadow: "0 0 20px rgba(97,255,141,0.16), inset 0 0 18px rgba(97,255,141,0.12)",
  },
  amber_phosphor: {
    text: "#ffd28a",
    border: "rgba(255,190,94,0.34)",
    hover: "rgba(49,29,7,0.92)",
    activeBg: "rgba(96,58,14,0.96)",
    activeText: "#fff0cf",
    activeBorder: "rgba(255,217,152,0.86)",
    shadow: "0 0 0 1px rgba(255,190,94,0.05), inset 0 0 10px rgba(255,190,94,0.05)",
    activeShadow: "0 0 20px rgba(255,181,92,0.14), inset 0 0 18px rgba(255,181,92,0.1)",
  },
  mystical_purpura: {
    text: "#dca7ff",
    border: "rgba(220,167,255,0.72)",
    hover: "rgba(220,167,255,0.18)",
    activeBg: "rgba(220,167,255,0.84)",
    activeText: "#16051f",
    activeBorder: "rgba(220,167,255,0.96)",
    shadow: "none",
    activeShadow: "0 0 0 1px rgba(220,167,255,0.18)",
  },
  inverted: {
    text: "#050505",
    border: "rgba(255,255,255,0.88)",
    hover: "rgba(255,255,255,0.16)",
    activeBg: "rgba(255,255,255,0.96)",
    activeText: "#050505",
    activeBorder: "rgba(255,255,255,0.96)",
    shadow: "none",
    activeShadow: "0 0 0 1px rgba(255,255,255,0.12)",
  },
}

const THEME_MOTION_VISUALS: Record<InterfaceTheme, ThemeMotionVisual> = {
  white: {
    filter: "none",
    overlayTone: "rgba(255,255,255,0.08)",
    bloomTone: "rgba(255,255,255,0.06)",
    shellStyle: {
      "--phosphor-bg-top": "#020202",
      "--phosphor-bg-mid": "#0a0a0a",
      "--phosphor-bg-bottom": "#020202",
      "--phosphor-aura": "rgba(255,255,255,0.1)",
      "--phosphor-top-glow": "rgba(255,255,255,0.06)",
      "--phosphor-grid": "rgba(255,255,255,0.05)",
      "--phosphor-grid-soft": "rgba(255,255,255,0.04)",
      "--phosphor-scanline": "rgba(255,255,255,0.06)",
      "--phosphor-shadow": "rgba(255,255,255,0.18)",
      "--phosphor-vignette": "rgba(0,0,0,0.28)",
      "--phosphor-frame": "rgba(255,255,255,0.1)",
    } as CSSProperties,
  },
  neon_blue: {
    filter: "sepia(1) saturate(8.8) hue-rotate(163deg) brightness(0.88) contrast(1.18)",
    overlayTone: "rgba(104,235,255,0.11)",
    bloomTone: "rgba(128,232,255,0.1)",
    shellStyle: {
      "--phosphor-bg-top": "#01070c",
      "--phosphor-bg-mid": "#041620",
      "--phosphor-bg-bottom": "#01070c",
      "--phosphor-aura": "rgba(24,117,156,0.16)",
      "--phosphor-top-glow": "rgba(84,214,255,0.1)",
      "--phosphor-grid": "rgba(143,230,255,0.05)",
      "--phosphor-grid-soft": "rgba(143,230,255,0.04)",
      "--phosphor-scanline": "rgba(143,230,255,0.06)",
      "--phosphor-shadow": "rgba(143,230,255,0.2)",
      "--phosphor-vignette": "rgba(0,0,0,0.3)",
      "--phosphor-frame": "rgba(143,230,255,0.12)",
    } as CSSProperties,
  },
  phosphor_green: {
    filter: "sepia(1) saturate(7.85) hue-rotate(63deg) brightness(0.86) contrast(1.18)",
    overlayTone: "rgba(135,255,168,0.12)",
    bloomTone: "rgba(138,255,173,0.11)",
    shellStyle: {
      "--phosphor-bg-top": "#020903",
      "--phosphor-bg-mid": "#06160a",
      "--phosphor-bg-bottom": "#020903",
      "--phosphor-aura": "rgba(24,92,46,0.16)",
      "--phosphor-top-glow": "rgba(68,224,113,0.1)",
      "--phosphor-grid": "rgba(158,255,182,0.05)",
      "--phosphor-grid-soft": "rgba(158,255,182,0.04)",
      "--phosphor-scanline": "rgba(158,255,182,0.06)",
      "--phosphor-shadow": "rgba(97,255,141,0.22)",
      "--phosphor-vignette": "rgba(0,0,0,0.28)",
      "--phosphor-frame": "rgba(97,255,141,0.12)",
    } as CSSProperties,
  },
  amber_phosphor: {
    filter: "sepia(1) saturate(7.15) hue-rotate(350deg) brightness(0.84) contrast(1.17)",
    overlayTone: "rgba(255,181,92,0.1)",
    bloomTone: "rgba(255,170,72,0.095)",
    shellStyle: {
      "--phosphor-bg-top": "#090502",
      "--phosphor-bg-mid": "#170c04",
      "--phosphor-bg-bottom": "#090502",
      "--phosphor-aura": "rgba(128,68,18,0.16)",
      "--phosphor-top-glow": "rgba(255,168,74,0.1)",
      "--phosphor-grid": "rgba(255,214,156,0.05)",
      "--phosphor-grid-soft": "rgba(255,214,156,0.04)",
      "--phosphor-scanline": "rgba(255,214,156,0.055)",
      "--phosphor-shadow": "rgba(255,186,94,0.2)",
      "--phosphor-vignette": "rgba(0,0,0,0.3)",
      "--phosphor-frame": "rgba(255,190,94,0.11)",
    } as CSSProperties,
  },
  mystical_purpura: {
    filter: "sepia(1) saturate(8.15) hue-rotate(218deg) brightness(0.9) contrast(1.18)",
    overlayTone: "rgba(222,166,255,0.1)",
    bloomTone: "rgba(215,150,255,0.095)",
    shellStyle: {
      "--phosphor-bg-top": "#08030d",
      "--phosphor-bg-mid": "#17081d",
      "--phosphor-bg-bottom": "#08030d",
      "--phosphor-aura": "rgba(124,42,160,0.16)",
      "--phosphor-top-glow": "rgba(210,134,255,0.11)",
      "--phosphor-grid": "rgba(220,167,255,0.05)",
      "--phosphor-grid-soft": "rgba(220,167,255,0.04)",
      "--phosphor-scanline": "rgba(220,167,255,0.055)",
      "--phosphor-shadow": "rgba(220,167,255,0.22)",
      "--phosphor-vignette": "rgba(0,0,0,0.32)",
      "--phosphor-frame": "rgba(220,167,255,0.11)",
    } as CSSProperties,
  },
  inverted: {
    filter: "invert(1)",
    overlayTone: "rgba(255,255,255,0.035)",
    bloomTone: "rgba(255,255,255,0.03)",
    shellStyle: {
      "--phosphor-bg-top": "#f1f1f1",
      "--phosphor-bg-mid": "#e6e6e6",
      "--phosphor-bg-bottom": "#f4f4f4",
      "--phosphor-aura": "rgba(255,255,255,0.32)",
      "--phosphor-top-glow": "rgba(255,255,255,0.22)",
      "--phosphor-grid": "rgba(255,255,255,0.08)",
      "--phosphor-grid-soft": "rgba(255,255,255,0.06)",
      "--phosphor-scanline": "rgba(255,255,255,0.08)",
      "--phosphor-shadow": "rgba(255,255,255,0.22)",
      "--phosphor-vignette": "rgba(0,0,0,0.12)",
      "--phosphor-frame": "rgba(255,255,255,0.2)",
    } as CSSProperties,
  },
}
// Zodiac SVG set sourced from Tabler Icons (MIT).
const ZODIAC_GLYPH_SVGS: Record<string, string> = {
  aries: "/zodiac-glyphs/aries.svg",
  taurus: "/zodiac-glyphs/taurus.svg",
  gemini: "/zodiac-glyphs/gemini.svg",
  cancer: "/zodiac-glyphs/cancer.svg",
  leo: "/zodiac-glyphs/leo.svg",
  virgo: "/zodiac-glyphs/virgo.svg",
  libra: "/zodiac-glyphs/libra.svg",
  scorpio: "/zodiac-glyphs/scorpio.svg",
  sagittarius: "/zodiac-glyphs/sagittarius.svg",
  capricorn: "/zodiac-glyphs/capricorn.svg",
  aquarius: "/zodiac-glyphs/aquarius.svg",
  pisces: "/zodiac-glyphs/pisces.svg",
}
const ZODIAC_SIGN_FALLBACK_ORDER = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
]
const ZODIAC_SIGN_KEY_BY_LABEL: Record<string, string> = {
  aries: "aries",
  tauro: "taurus",
  taurus: "taurus",
  geminis: "gemini",
  gemini: "gemini",
  cancer: "cancer",
  leo: "leo",
  virgo: "virgo",
  libra: "libra",
  escorpio: "scorpio",
  scorpio: "scorpio",
  sagitario: "sagittarius",
  sagittarius: "sagittarius",
  capricornio: "capricorn",
  capricorn: "capricorn",
  acuario: "aquarius",
  aquarius: "aquarius",
  piscis: "pisces",
  pisces: "pisces",
}
const PLANET_LABEL_BY_KEY_BY_LANGUAGE: Record<Language, Record<string, string>> = {
  en: {
    sun: "Sun",
    moon: "Moon",
    mercury: "Mercury",
    venus: "Venus",
    mars: "Mars",
    jupiter: "Jupiter",
    saturn: "Saturn",
    uranus: "Uranus",
    neptune: "Neptune",
    pluto: "Pluto",
    asc: "Ascendant",
    mc: "Midheaven",
  },
  es: {
    sun: "Sol",
    moon: "Luna",
    mercury: "Mercurio",
    venus: "Venus",
    mars: "Marte",
    jupiter: "Jupiter",
    saturn: "Saturno",
    uranus: "Urano",
    neptune: "Neptuno",
    pluto: "Pluton",
    asc: "Ascendente",
    mc: "Medio Cielo",
  },
}
const PLANET_KEY_BY_LABEL: Record<string, string> = {
  sun: "sun",
  sol: "sun",
  moon: "moon",
  luna: "moon",
  mercury: "mercury",
  mercurio: "mercury",
  venus: "venus",
  mars: "mars",
  marte: "mars",
  jupiter: "jupiter",
  saturn: "saturn",
  saturno: "saturn",
  uranus: "uranus",
  urano: "uranus",
  neptune: "neptune",
  neptuno: "neptune",
  pluto: "pluto",
  pluton: "pluto",
  asc: "asc",
  ascendant: "asc",
  ascendente: "asc",
  mc: "mc",
  midheaven: "mc",
  mediocielo: "mc",
  "medio cielo": "mc",
}
const SIGN_LABEL_BY_KEY_BY_LANGUAGE: Record<Language, Record<string, string>> = {
  en: {
    aries: "Aries",
    taurus: "Taurus",
    gemini: "Gemini",
    cancer: "Cancer",
    leo: "Leo",
    virgo: "Virgo",
    libra: "Libra",
    scorpio: "Scorpio",
    sagittarius: "Sagittarius",
    capricorn: "Capricorn",
    aquarius: "Aquarius",
    pisces: "Pisces",
  },
  es: {
    aries: "Aries",
    taurus: "Tauro",
    gemini: "Geminis",
    cancer: "Cancer",
    leo: "Leo",
    virgo: "Virgo",
    libra: "Libra",
    scorpio: "Escorpio",
    sagittarius: "Sagitario",
    capricorn: "Capricornio",
    aquarius: "Acuario",
    pisces: "Piscis",
  },
}

const EARTH_CENTER_X = 200
const EARTH_CENTER_Y = 200
const EARTH_RADIUS = 10
const MAX_ASPECT_LINE_OPACITY = 0.7
const INTERACTIVE_PREVIEW_KEY = "__interactive_preview__"
const GLYPH_INTERACTION_SCALE = 1.15
const GLYPH_INTERACTION_FADE_EXTRA_MS = 1000
const GLYPH_INTERACTION_FADE_IN_MS = 500 + GLYPH_INTERACTION_FADE_EXTRA_MS
const GLYPH_INTERACTION_FADE_OUT_MS = 2200 + GLYPH_INTERACTION_FADE_EXTRA_MS + 500
const GLYPH_INTERACTION_FADE_OUT_HOLD_MS = 0
const GLYPH_INTERACTION_PREVIEW_CLEAR_MS = GLYPH_INTERACTION_FADE_OUT_MS + GLYPH_INTERACTION_FADE_OUT_HOLD_MS
const GLYPH_INTERACTION_EASE_IN = "cubic-bezier(0.32, 0.08, 0.24, 1)"
const GLYPH_INTERACTION_EASE_OUT = "cubic-bezier(0.16, 0.84, 0.32, 1)"
const DEFAULT_ASPECTS_SOUND_VOLUME = 11
const ORBIT_POINTER_FILL_OPACITY = 0.1575 // +5%
const CHORD_POINTER_FILL_OPACITY = 0.126 // +5%
const LOADING_SUBTITLE_STEP_MS = 25000
const MONOTYPE_FONT_STACK = '"Roboto Mono", "Courier New", Courier, monospace'
const LOADING_INTRO_PARAGRAPHS_BY_LANGUAGE: Record<Language, string[]> = {
  en: [
    "ASTRO.LOG.IO is inspired by Kepler’s Harmony of the Spheres.",
    "This vision of celestial music translates accurate astral data into music.",
    "By introrducing place and time you may listen and download sonic astrological charts.",
  ],
  es: [
    "ASTRO.LOG.IO está inspirado en la música de las Esferas de Keppler.",
    "Esta visión de la música celestial traduce datos astrales precisos en música.",
    "Introduciendo ubicación y hora podrás escuchar y descargar cartas astrales sonoras.",
  ],
}
const INFO_PARAGRAPHS_BY_LANGUAGE: Record<Language, string[]> = {
  en: [
    "ASTRO.LOG.IO is inspired by the historical idea of the Harmony of the Spheres, from ancient cosmology to Kepler’s vision of celestial music. It translates an astronomically accurate astrological chart into a living, immersive sonic system where planetary motion becomes audible form.",
    "CHORD MODE: the chart is heard as a dense, simultaneous harmonic field.\nCHART MODE: the experience becomes a sequential astrological reading, planet by planet.\nORBITAL MODE: listening follows a circular path that moves around the planets in continuous rotation.",
    "Each planetary timbre was carefully chosen to express the distinct character traditionally associated with that celestial body. Its spatial placement and tuning emerge from astrological chart coordinates, and interplanetary relationships are organized through astrological criteria.",
    "All rendered audio files can be downloaded and freely distributed, so feel free to experiment with different dates and combinations, including the here & now.\nFor a fully immersive experience, we recommend using headphones.\nEnjoy the spatial energies that surround us all.",
  ],
  es: [
    "ASTRO.LOG.IO se inspira en la idea historica de la Armonia de las Esferas, desde la cosmologia antigua hasta la vision de Kepler sobre la musica celeste. Traduce una carta astrologica astronomicamente precisa en un sistema sonoro vivo e inmersivo donde el movimiento planetario se vuelve forma audible.",
    "MODO CHORD: la carta se escucha como un campo armonico denso y simultaneo.\nMODO CHART: la experiencia se vuelve una lectura astrologica secuencial, planeta por planeta.\nMODO ORBITAL: la escucha sigue una orbita circular que recorre los planetas en rotacion continua.",
    "Cada timbre planetario fue elegido cuidadosamente para expresar el caracter distintivo asociado tradicionalmente a cada cuerpo celeste. Su ubicacion espacial y afinacion surgen de las coordenadas de la carta y de relaciones interplanetarias organizadas con criterio astrologico.",
    "Todos los archivos de audio renderizados pueden descargarse y distribuirse libremente, asi que puedes experimentar con diferentes fechas y combinaciones, incluyendo el aqui y ahora.\nPara una experiencia totalmente inmersiva recomendamos usar auriculares.\nDisfruta las energias espaciales que nos rodean.",
  ],
}
const NAV_MODE_INSTRUCTION_BY_MODE_BY_LANGUAGE: Record<Language, Record<NavigationMode, string>> = {
  en: {
    astral_chord: "Astral Chord: dense, simultaneous harmonic field.",
    radial: "Orbital: continuous circular listening around the planets.",
    sequential: "Chart: sequential astrological reading, planet by planet.",
  },
  es: {
    astral_chord: "Acorde Astral: campo armonico denso y simultaneo.",
    radial: "Orbital: escucha circular continua alrededor de los planetas.",
    sequential: "Carta: lectura astrologica secuencial, planeta por planeta.",
  },
}

function renderInfoParagraph(language: Language, infoParagraphs: string[], index: number) {
  const paragraph = infoParagraphs[index] ?? ""
  if (index !== 1) return <>{paragraph}</>

  if (language === "es") {
    return (
      <>
        <span className="block">
          <span className="font-bold uppercase">MODO CHORD</span>: la carta se escucha como un campo armonico denso y
          simultaneo.
        </span>
        <span className="block">
          <span className="font-bold uppercase">MODO CHART</span>: la experiencia se vuelve una lectura astrologica secuencial,
          planeta por planeta.
        </span>
        <span className="block">
          <span className="font-bold uppercase">MODO ORBITAL</span>: la escucha sigue una orbita circular que recorre los
          planetas en rotacion continua.
        </span>
      </>
    )
  }

  return (
    <>
      <span className="block">
        <span className="font-bold uppercase">CHORD MODE</span>: the chart is heard as a dense, simultaneous harmonic field.
      </span>
      <span className="block">
        <span className="font-bold uppercase">CHART MODE</span>: the experience becomes a sequential astrological reading,
        planet by planet.
      </span>
      <span className="block">
        <span className="font-bold uppercase">ORBITAL MODE</span>: listening follows a circular path that moves around the
        planets in continuous rotation.
      </span>
    </>
  )
}

const ASPECT_SYMBOL_BY_KEY: Record<MajorAspectKey, string> = {
  conjunction: "☌",
  opposition: "☍",
  trine: "△",
  square: "▢",
  sextile: "⚹",
}

const ASPECT_LABEL_BY_KEY_BY_LANGUAGE: Record<Language, Record<MajorAspectKey, string>> = {
  en: {
    conjunction: "Conjunction",
    opposition: "Opposition",
    trine: "Trine",
    square: "Square",
    sextile: "Sextile",
  },
  es: {
    conjunction: "Conjuncion",
    opposition: "Oposicion",
    trine: "Trigono",
    square: "Cuadratura",
    sextile: "Sextil",
  },
}

function normalizeCompareText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function getMajorAspectKey(aspectType: string): MajorAspectKey | null {
  const normalized = normalizeCompareText(aspectType)
  if (!normalized) return null
  if (normalized.includes("conj")) return "conjunction"
  if (normalized.includes("opos") || normalized.includes("oppo")) return "opposition"
  if (normalized.includes("trig") || normalized.includes("trin")) return "trine"
  if (normalized.includes("cuad") || normalized.includes("squar")) return "square"
  if (normalized.includes("sext")) return "sextile"
  return null
}

function isMajorAspectType(aspectType: string): boolean {
  return getMajorAspectKey(aspectType) !== null
}

function getMajorAspectLabel(aspectType: string, language: Language): string {
  const key = getMajorAspectKey(aspectType)
  return key ? ASPECT_LABEL_BY_KEY_BY_LANGUAGE[language][key] : aspectType
}

function getMajorAspectSymbol(aspectType: string): string {
  const key = getMajorAspectKey(aspectType)
  return key ? ASPECT_SYMBOL_BY_KEY[key] : aspectType
}

function getMajorAspectStrokeColor(aspectType: string): string {
  const key = getMajorAspectKey(aspectType)
  if (key === "opposition") return "#FF8C00"
  if (key === "conjunction") return "#9D4EDD"
  if (key === "trine") return "#00FF00"
  if (key === "square") return "#FF3B30"
  if (key === "sextile") return "#0099FF"
  return "#888"
}

function formatDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function sanitizeLocationLabel(rawLocation: string): string {
  const trimmed = rawLocation.trim()
  if (!trimmed) return ""

  const numericTokenPattern = /^[-+]?\d+(\.\d+)?$/
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !numericTokenPattern.test(part))

  if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`
  if (parts.length === 1) return parts[0]
  return trimmed
}

function titleCaseLocationToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
}

function getCountryFromLocale(preferredLanguage: Language = "en"): string | null {
  if (typeof navigator === "undefined") return null
  const language = (navigator.language || "").replace("_", "-")
  const region = language.split("-")[1]?.toUpperCase()
  if (!region) return null

  const locale = preferredLanguage === "es" ? "es-ES" : "en-GB"
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as any).DisplayNames === "function") {
      const displayNames = new Intl.DisplayNames([locale], { type: "region" })
      const localizedName = displayNames.of(region)
      if (localizedName) return localizedName
    }
  } catch {
    // Fall through to manual map.
  }

  const fallbackCountryByRegionByLanguage: Record<Language, Record<string, string>> = {
    en: {
      AR: "Argentina",
      UY: "Uruguay",
      PY: "Paraguay",
      BO: "Bolivia",
      BR: "Brazil",
      CL: "Chile",
      PE: "Peru",
      EC: "Ecuador",
      CO: "Colombia",
      VE: "Venezuela",
      MX: "Mexico",
      US: "United States",
      CA: "Canada",
      ES: "Spain",
      PT: "Portugal",
      FR: "France",
      DE: "Germany",
      IT: "Italy",
      GB: "United Kingdom",
      AU: "Australia",
      NZ: "New Zealand",
    },
    es: {
      AR: "Argentina",
      UY: "Uruguay",
      PY: "Paraguay",
      BO: "Bolivia",
      BR: "Brasil",
      CL: "Chile",
      PE: "Peru",
      EC: "Ecuador",
      CO: "Colombia",
      VE: "Venezuela",
      MX: "Mexico",
      US: "Estados Unidos",
      CA: "Canada",
      ES: "Espana",
      PT: "Portugal",
      FR: "Francia",
      DE: "Alemania",
      IT: "Italia",
      GB: "Reino Unido",
      AU: "Australia",
      NZ: "Nueva Zelanda",
    },
  }
  return fallbackCountryByRegionByLanguage[preferredLanguage][region] || null
}

function buildLocationFromTimeZone(preferredLanguage: Language = "en"): string | null {
  if (typeof Intl === "undefined") return null
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  const segments = timeZone.split("/").filter(Boolean)
  if (segments.length < 2) return null

  const city = titleCaseLocationToken(segments[segments.length - 1])
  let country: string | null = null

  if (segments.length >= 3) {
    country = titleCaseLocationToken(segments[segments.length - 2])
  } else {
    country = getCountryFromLocale(preferredLanguage)
  }

  if (!city) return country
  return country ? `${city}, ${country}` : city
}

function normalizeSignLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function getLocalizedPlanetLabel(planetNameOrLabel: string, language: Language): string {
  const normalized = normalizeCompareText(planetNameOrLabel)
  const planetKey = PLANET_KEY_BY_LABEL[normalized] || normalized
  return PLANET_LABEL_BY_KEY_BY_LANGUAGE[language][planetKey] || planetNameOrLabel
}

function getLocalizedSignLabel(signLabel: string, language: Language): string {
  const signKey = ZODIAC_SIGN_KEY_BY_LABEL[normalizeSignLabel(signLabel)] || normalizeSignLabel(signLabel)
  return SIGN_LABEL_BY_KEY_BY_LANGUAGE[language][signKey] || signLabel
}

function hashStringToUnitInterval(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return ((hash >>> 0) % 1000000) / 1000000
}

function getGlyphGlowTiming(glyphName: string) {
  let hash = 0
  for (let i = 0; i < glyphName.length; i += 1) {
    hash = (hash * 31 + glyphName.charCodeAt(i)) % 100000
  }
  const durationSec = 5 + (hash % 5000) / 1000 // 5s..10s
  const delaySec = -((Math.floor(hash / 7) % 10000) / 1000) // desync start phase
  return {
    durationSec: durationSec.toFixed(3),
    delaySec: delaySec.toFixed(3),
  }
}

function getThemeTwinkleTiming(keyName: string) {
  let hash = 0
  for (let i = 0; i < keyName.length; i += 1) {
    hash = (hash * 37 + keyName.charCodeAt(i)) % 100000
  }
  const durationSec = 2.6 + (hash % 2600) / 1000 // 2.6s..5.2s
  const delaySec = -((Math.floor(hash / 9) % 9000) / 1000) // desync phase start
  return {
    durationSec: durationSec.toFixed(3),
    delaySec: delaySec.toFixed(3),
  }
}

function adjustPlanetPositions(planets: { name: string; degrees: number }[], minSeparation = 12) {
  const sorted = [...planets].sort((a, b) => a.degrees - b.degrees)
  const adjusted: { name: string; adjustedDegrees: number }[] = []

  for (let i = 0; i < sorted.length; i++) {
    let newDegrees = sorted[i].degrees

    for (const placed of adjusted) {
      const diff = Math.abs(newDegrees - placed.adjustedDegrees)
      const circularDiff = Math.min(diff, 360 - diff)

      if (circularDiff < minSeparation) {
        const halfSep = minSeparation / 2 + 2
        if (newDegrees >= placed.adjustedDegrees) {
          newDegrees = placed.adjustedDegrees + halfSep
        } else {
          newDegrees = placed.adjustedDegrees - halfSep
        }
      }
    }
    adjusted.push({ name: sorted[i].name, adjustedDegrees: norm360(newDegrees) })
  }
  return adjusted
}

// Normalizar ángulo a [0, 360)
function norm360(x: number): number {
  return ((x % 360) + 360) % 360
}

function getElementFromDegrees(degrees: number): "fire" | "earth" | "air" | "water" {
  const signIndex = Math.floor(norm360(degrees) / 30) % 12
  const elements = ["fire", "earth", "air", "water"] as const
  return elements[signIndex % 4]
}

// Convertir coordenadas polares a cartesianas (método AstroChart)
function polarToCartesian(cx: number, cy: number, r: number, thetaDeg: number) {
  const thetaRad = (thetaDeg * Math.PI) / 180
  return {
    x: cx + r * Math.cos(thetaRad),
    y: cy - Math.sin(thetaRad) * r, // Y invertido para SVG
  }
}

function trimLineSegment(
  start: { x: number; y: number },
  end: { x: number; y: number },
  trimStartPx = 15,
  trimEndPx = 15,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  if (distance <= trimStartPx + trimEndPx) return null

  const ux = dx / distance
  const uy = dy / distance

  return {
    x1: start.x + ux * trimStartPx,
    y1: start.y + uy * trimStartPx,
    x2: end.x - ux * trimEndPx,
    y2: end.y - uy * trimEndPx,
  }
}

function getZodiacSign(degrees: number) {}

function toCanvasAngle(degrees: number): number {
  return 180 - degrees
}

function sanitizeFileToken(raw: string, fallback: string): string {
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase()
  return normalized || fallback
}

const calculatePointerState = (elapsed: number, duration: number, ascDegrees: number) => {
  const progress = elapsed / duration
  const pointerAngle = norm360(180 + 360 * progress)
  const adjustedAngle = pointerAngle // Display shows pure pointer angle without ascendant modification
  return {
    pointerAngle,
    adjustedAngle, // This is the display value (pointer angle starting at 180° going counter-clockwise)
    pointerRotation: -360 * progress,
  }
}

export default function AstrologyCalculator() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showSubject, setShowSubject] = useState(true)
  const [isFetchingHereNow, setIsFetchingHereNow] = useState(false)
  const hasAutoAppliedHereNowRef = useRef(false)
  const [showPlanets, setShowPlanets] = useState(false)
  const [showAspects, setShowAspects] = useState(false) // changed to false - dynaspects is the main one
  const [showAspectGraph, setShowAspectGraph] = useState(false)
  const [showDynAspects, setShowDynAspects] = useState(true) // changed to true - this is the default visible one
  const [showAspectBox, setShowAspectBox] = useState(false) // New separate state for the info box
  const [activePlanetAspectsMap, setActivePlanetAspectsMap] = useState<
    Record<string, { aspects: Array<any>; opacity: number }>
  >({})

  const [dynAspectsOpacity, setDynAspectsOpacity] = useState(0)
  const [showChart, setShowChart] = useState(true)
  const [showCircle, setShowCircle] = useState(false)
  const [showSignsRing, setShowSignsRing] = useState(false)
  const [showHousesRing, setShowHousesRing] = useState(false)
  const [showMatrix, setShowMatrix] = useState(false)
  const [showDegrees, setShowDegrees] = useState(false)
  const [showAngles, setShowAngles] = useState(false)
  const [showAstroChart, setShowAstroChart] = useState(false)
  const [loadingIntroCompleted, setLoadingIntroCompleted] = useState(false)
  const [loadingIntroSkipped, setLoadingIntroSkipped] = useState(false)
  const [loadingIntroExitReady, setLoadingIntroExitReady] = useState(false)
  const [loadingIntroProgressPct, setLoadingIntroProgressPct] = useState(0)
  const [loadingIntroIndex, setLoadingIntroIndex] = useState(0)
  const [loadingIntroTick, setLoadingIntroTick] = useState(0)
  const [loadingLanguageHint, setLoadingLanguageHint] = useState<Language | null>(null)
  const [loadingLanguageHintFading, setLoadingLanguageHintFading] = useState(false)
  const [showInfoOverlay, setShowInfoOverlay] = useState(false)
  const [infoParagraphIndex, setInfoParagraphIndex] = useState(0)
  const [peakLevelLeftPre, setPeakLevelLeftPre] = useState(0)
  const [peakLevelRightPre, setPeakLevelRightPre] = useState(0)
  const [peakLevelLeftPost, setPeakLevelLeftPost] = useState(0)
  const [peakLevelRightPost, setPeakLevelRightPost] = useState(0)
  const [showPointer, setShowPointer] = useState(true)
  const [showPointerInfo, setShowPointerInfo] = useState(false)
  const [showVuMeter, setShowVuMeter] = useState(false)
  const [showModeInfo, setShowModeInfo] = useState(false)
  const [advancedMenuEnabled, setAdvancedMenuEnabled] = useState(false)
  const [isSubjectBoxHovered, setIsSubjectBoxHovered] = useState(false)
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("radial")
  const [topPanelHoverKey, setTopPanelHoverKey] = useState<string | null>(null)
  const [isExportingMp3, setIsExportingMp3] = useState(false)
  const [isExportingJpg, setIsExportingJpg] = useState(false)
  const [pendingMp3Download, setPendingMp3Download] = useState<{ url: string; fileName: string } | null>(null)
  const mobileDownloadArmedModeRef = useRef<NavigationMode | null>(null)
  const mobileDownloadArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const topPanelHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const menuPanelAnchorRef = useRef<HTMLDivElement | null>(null)
  const chartSvgRef = useRef<SVGSVGElement | null>(null)
  const exportAssetDataUrlCacheRef = useRef<Map<string, string>>(new Map())
  const desktopMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const [menuPanelPosition, setMenuPanelPosition] = useState<{ bottom: number; left: number } | null>(null)
  const [crtFocusPoint, setCrtFocusPoint] = useState({ x: 50, y: 50 })
  const [isSidereal, setIsSidereal] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<SubjectPreset>("here_now")
  const [formData, setFormData] = useState<SubjectFormData>(EMPTY_SUBJECT_FORM)
  const [horoscopeData, setHoroscopeData] = useState<HoroscopeData | null>(null)
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [isPreparingPlaybackAudio, setIsPreparingPlaybackAudio] = useState(false)

  const [loopDuration, setLoopDuration] = useState(180)
  const [isLoopRunning, setIsLoopRunning] = useState(false)
  const [pointerRotation, setPointerRotation] = useState(0)
  const [pointerOpacity, setPointerOpacity] = useState(1)
  const [pointerOpacityTransitionMs, setPointerOpacityTransitionMs] = useState(0)
  const [chartAspectsTransitionMs, setChartAspectsTransitionMs] = useState(0)
  const [chordAspectsTransitionMs, setChordAspectsTransitionMs] = useState(CHORD_ASPECTS_FADE_IN_MS)
  const [startButtonScale, setStartButtonScale] = useState(1)

  const [audioFadeIn, setAudioFadeIn] = useState(5)
  const [audioFadeOut, setAudioFadeOut] = useState(10)
  const [backgroundVolume, setBackgroundVolume] = useState(2)
  const [elementSoundVolume, setElementSoundVolume] = useState(2)
  const [dynAspectsFadeIn, setDynAspectsFadeIn] = useState(3)
  const [dynAspectsSustain, setDynAspectsSustain] = useState(2)
  const [dynAspectsFadeOut, setDynAspectsFadeOut] = useState(15)

  const [aspectsSoundVolume, setAspectsSoundVolume] = useState(DEFAULT_ASPECTS_SOUND_VOLUME)
  const [masterVolume, setMasterVolume] = useState(50) // Nuevo estado para controlar volumen maestro (0-100%)
  const [reverbMixPercent, setReverbMixPercent] = useState(20)
  const [chordReverbMixPercent, setChordReverbMixPercent] = useState(40)
  const [tuningCents, setTuningCents] = useState(0)
  const [modalEnabled, setModalEnabled] = useState(true)
  const [audioEngineMode, setAudioEngineMode] = useState<AudioEngineMode>("samples")
  const [interfaceTheme, setInterfaceTheme] = useState<InterfaceTheme>("neon_blue")
  const [language, setLanguage] = useState<Language>("en")
  const [synthVolume, setSynthVolume] = useState(450)

  const [glyphAnimationManager] = useState(() => new GlyphAnimationManager())
  const [animatedPlanets, setAnimatedPlanets] = useState<Record<string, number>>({})

  const [startButtonPhase, setStartButtonPhase] = useState<"contracted" | "expanding" | "stable">("contracted")
  const [currentPlanetUnderPointer, setCurrentPlanetUnderPointer] = useState<string | null>(null)
  const [showAstrofono, setShowAstrofono] = useState(false) // Declared showAstrofono
  const [debugPointerAngle, setDebugPointerAngle] = useState(0) // Added state to track pointer angle for debugging
  const animationFrameIdRef = useRef<number | null>(null)
  const loopStartTimeRef = useRef(0)
  const loopElapsedBeforePauseMsRef = useRef(0)
  const lastUiCommitTimeRef = useRef(0)
  const startButtonPhaseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const navigationStepTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const navigationTimeoutsRef = useRef<NodeJS.Timeout[]>([])
  const navigationRunIdRef = useRef(0)
  const lastClickTimeRef = useRef<number>(0)
  const [isPaused, setIsPaused] = useState(false)

  const [hoveredGlyph, setHoveredGlyph] = useState<string | null>(null)
  const [pressedGlyph, setPressedGlyph] = useState<string | null>(null)
  const [glyphHoverOpacity, setGlyphHoverOpacity] = useState(0)
  const [showAspectIndicator, setShowAspectIndicator] = useState(false) // Declared showAspectIndicator
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const [playbackUiVisible, setPlaybackUiVisible] = useState(true)
  const aspectClickTimersRef = useRef<Record<string, NodeJS.Timeout[]>>({})
  const affectedScaleTimersRef = useRef<Record<string, { start: NodeJS.Timeout | null; end: NodeJS.Timeout | null }>>(
    {},
  )
  const glyphScaleTriggerLockRef = useRef<Record<string, number>>({})
  const pressedGlyphReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactivePreviewClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackUiHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playbackUiVisibleRef = useRef(true)
  const playbackPreparationRequestIdRef = useRef(0)
  const skipNextAutoCalculateRef = useRef(false)
  const pendingModeLaunchRef = useRef<NavigationMode | null>(null)
  const playbackProgressFrameRef = useRef<number | null>(null)
  const loadingIntroIndexRef = useRef(0)
  const loadingIntroElapsedBeforeCurrentMsRef = useRef(0)
  const loadingIntroParagraphStartTimeRef = useRef(0)
  const loadingIntroAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingLanguageHintFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingLanguageHintClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [locationSuggestions, setLocationSuggestions] = useState<GeoSuggestion[]>([])
  const [isResolvingLocation, setIsResolvingLocation] = useState(false)

  // [T-30] Render-phase toggles. Persisted in localStorage so user
  // tweaks survive reloads. Loaded lazily on first client render to
  // avoid SSR/hydration mismatches.
  const [renderPhases, setRenderPhases] = useState<RenderPhases>(DEFAULT_RENDER_PHASES)
  const [renderPhasesHydrated, setRenderPhasesHydrated] = useState(false)
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null)

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(RENDER_PHASES_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RenderPhases>
        setRenderPhases({ ...DEFAULT_RENDER_PHASES, ...parsed })
      }
    } catch {
      // ignore corrupt storage, fall back to defaults
    }
    setRenderPhasesHydrated(true)
  }, [])

  // Persist after hydration so we never overwrite stored values with
  // defaults during the first render.
  useEffect(() => {
    if (!renderPhasesHydrated || typeof window === "undefined") return
    try {
      window.localStorage.setItem(RENDER_PHASES_STORAGE_KEY, JSON.stringify(renderPhases))
    } catch {
      // storage may be full or disabled (private mode); silent fail OK
    }
  }, [renderPhases, renderPhasesHydrated])

  // Ref mirror so render-pipeline callbacks (live inside a hook with
  // its own closure) can read current phases without us threading
  // them through every dependency array.
  const renderPhasesRef = useRef<RenderPhases>(renderPhases)
  useEffect(() => {
    renderPhasesRef.current = renderPhases
  }, [renderPhases])

  // Toggle setter that, for cache-invalidating phases (1..6),
  // will also nuke the offline playback cache. The cache-clearing
  // hookup is wired in [T-30-b]; for now this is a pure state
  // setter so behavior is unchanged.
  const setRenderPhase = useCallback(
    <K extends keyof RenderPhases>(key: K, value: RenderPhases[K]) => {
      setRenderPhases((prev) => {
        if (prev[key] === value) return prev
        return { ...prev, [key]: value }
      })
      // NOTE: actual cache invalidation lands in T-30-b once we
      // expose clearOfflinePlaybackCache from usePlanetAudio.
      if (RENDER_PHASE_CACHE_INVALIDATING_KEYS.includes(key)) {
        // placeholder — no-op until T-30-b
      }
    },
    [],
  )
  const chartAspectsKeyRef = useRef("__chart__")
  const subjectHoverTouchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingIntroParagraphs = useMemo(() => LOADING_INTRO_PARAGRAPHS_BY_LANGUAGE[language], [language])
  const infoParagraphs = useMemo(() => INFO_PARAGRAPHS_BY_LANGUAGE[language], [language])
  const navModeHintLabel = useMemo(() => NAV_MODE_HINT_LABEL_BY_LANGUAGE[language], [language])
  const navModeActionLabel = useMemo(() => NAV_MODE_ACTION_LABEL_BY_LANGUAGE[language], [language])
  const navModeInstructionByMode = useMemo(() => NAV_MODE_INSTRUCTION_BY_MODE_BY_LANGUAGE[language], [language])
  const downloadTooltipText = useMemo(() => DOWNLOAD_TOOLTIP_TEXT_BY_LANGUAGE[language], [language])
  const photoTooltipText = useMemo(() => PHOTO_TOOLTIP_TEXT_BY_LANGUAGE[language], [language])
  const engineOptions = useMemo(() => ENGINE_OPTIONS_BY_LANGUAGE[language], [language])
  const interfaceThemeOptions = useMemo(() => INTERFACE_THEME_OPTIONS_BY_LANGUAGE[language], [language])
  const localeCode = language === "es" ? "es-ES" : "en-US"
  const ui = useMemo(
    () =>
      language === "es"
        ? {
            menu: "Menu",
            advanced: "Avanzado",
            on: "ACTIVO",
            off: "INACTIVO",
            subject: "Sujeto",
            signs: "Signos",
            houses: "Casas",
            reset: "Reset",
            info: "Info",
            engine: "Motor",
            interface: "Interfaz",
            minimal: "Minimo",
            planets: "Planetas",
            aspects: "Aspectos",
            dynAspects: "Aspectos Dinamicos",
            chart: "Carta",
            matrix: "Matriz",
            circle: "Circulo",
            signsRing: "Anillo de Signos",
            housesRing: "Anillo de Casas",
            degrees: "Grados",
            astroChart: "AstroCarta",
            pointerInfo: "Info del Puntero",
            aspectBox: "Caja de Aspectos",
            modeInfo: "Info de Modo",
            navigation: "Navegacion",
            loop: "Vuelta",
            audioEnvelope: "Envolvente de Audio",
            mode: "Modo",
            fadeIn: "Fade In",
            fadeOut: "Fade Out",
            bgVol: "Vol Fondo",
            element: "Elemento",
            aspectVol: "Vol Aspectos",
            masterVol: "Vol Master",
            reverb: "Reverb",
            chordReverb: "RVB Acorde",
            synthVol: "Vol Sint",
            tuning: "Afinacion",
            dynamicAspects: "Aspectos Dinamicos",
            sustain: "Sustain",
            vu: "VU",
            vuMeter: "Medidor VU",
            pre: "Pre",
            post: "Post",
            comp: "Comp",
            modeLabel: "Modo",
            modeOff: "APAGADO",
            manual: "MANUAL",
            hereNow: "AQUI Y AHORA",
            dateTimePlaceInput: "INPUT DATE & PLACE",
            dataInput: "NUEVO INGRESO DE DATOS",
            dateTime: "Fecha y Hora",
            location: "Ubicacion",
            latitude: "Latitud",
            longitude: "Longitud",
            cityCountryPlaceholder: "Ciudad, Pais",
            resolvingLocation: "Resolviendo ubicacion...",
            send: "ENVIAR",
            astrologicalData: "Datos Astrologicos",
            astrologicalAspects: "Aspectos Astrologicos",
            majorAspects: "Conjuncion, Oposicion, Trigono, Cuadratura, Sextil",
            total: "Total",
            planet1: "Planeta 1",
            planet2: "Planeta 2",
            aspect: "Aspecto",
            angle: "Angulo (°)",
            orb: "Orb (°)",
            glyph: "Glifo",
            ecliptic: "Ecliptica (°)",
            sign: "Signo",
            house: "Casa",
            position: "Posicion",
            horizon: "Horizonte (°)",
            retrograde: "Retrogrado",
            aspectsOf: "Aspectos de",
            renderMp3: "RENDER MP3...",
            saveMp3: "GUARDAR MP3",
            close: "CERRAR",
            noDate: "Sin Fecha",
            noTime: "Sin Hora",
            noCity: "Sin Ciudad",
            noCountry: "Sin Pais",
            play: "Reproducir",
            stop: "Detener",
          }
        : {
            menu: "Menu",
            advanced: "Advanced",
            on: "ON",
            off: "OFF",
            subject: "Subject",
            signs: "Signs",
            houses: "Houses",
            reset: "Reset",
            info: "Info",
            engine: "Engine",
            interface: "Interface",
            minimal: "Minimal",
            planets: "Planets",
            aspects: "Aspects",
            dynAspects: "DynAspects",
            chart: "Chart",
            matrix: "Matrix",
            circle: "Circle",
            signsRing: "Signs Ring",
            housesRing: "Houses Ring",
            degrees: "Degrees",
            astroChart: "AstroChart",
            pointerInfo: "Pointer Info",
            aspectBox: "Aspect Box",
            modeInfo: "Mode Info",
            navigation: "Navigation",
            loop: "Loop",
            audioEnvelope: "Audio Envelope",
            mode: "Mode",
            fadeIn: "Fade In",
            fadeOut: "Fade Out",
            bgVol: "BG Vol",
            element: "Element",
            aspectVol: "Aspect Vol",
            masterVol: "Master Vol",
            reverb: "Reverb",
            chordReverb: "Chord RVB",
            synthVol: "Synth Vol",
            tuning: "Tuning",
            dynamicAspects: "Dynamic Aspects",
            sustain: "Sustain",
            vu: "VU",
            vuMeter: "VU Meter",
            pre: "Pre",
            post: "Post",
            comp: "Comp",
            modeLabel: "Mode",
            modeOff: "OFF",
            manual: "MANUAL",
            hereNow: "HERE & NOW",
            dateTimePlaceInput: "INPUT DATE & PLACE",
            dataInput: "NEW DATA INPUT",
            dateTime: "Date & Time",
            location: "Location",
            latitude: "Latitude",
            longitude: "Longitude",
            cityCountryPlaceholder: "City, Country",
            resolvingLocation: "Resolving location...",
            send: "SEND",
            astrologicalData: "Astrological Data",
            astrologicalAspects: "Astrological Aspects",
            majorAspects: "Conjunction, Opposition, Trine, Square, Sextile",
            total: "Total",
            planet1: "Planet 1",
            planet2: "Planet 2",
            aspect: "Aspect",
            angle: "Angle (°)",
            orb: "Orb (°)",
            glyph: "Glyph",
            ecliptic: "Ecliptic (°)",
            sign: "Sign",
            house: "House",
            position: "Position",
            horizon: "Horizon (°)",
            retrograde: "Retrograde",
            aspectsOf: "Aspects of",
            renderMp3: "RENDER MP3...",
            saveMp3: "SAVE MP3",
            close: "CLOSE",
            noDate: "No Date",
            noTime: "No Time",
            noCity: "No City",
            noCountry: "No Country",
            play: "Play",
            stop: "Stop",
          },
    [language],
  )

  const modalSunSignIndex = useMemo(() => {
    const sunDegrees = horoscopeData?.planets?.find((p) => p.name === "sun")?.ChartPosition?.Ecliptic?.DecimalDegrees
    if (typeof sunDegrees !== "number" || Number.isNaN(sunDegrees)) return null
    return Math.floor(norm360(sunDegrees) / 30) % 12
  }, [horoscopeData?.planets])

  const currentModeLabel =
    modalSunSignIndex !== null
      ? MODE_NAME_BY_SIGN_INDEX_BY_LANGUAGE[language][modalSunSignIndex] || (language === "es" ? "Modal" : "Modal")
      : language === "es"
        ? "Modal"
        : "Modal"
  const subjectLocationLines = useMemo(() => {
    const sanitized = sanitizeLocationLabel(formData.location)
    const parts = sanitized
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    return {
      city: parts[0] || ui.noCity,
      country: parts.length > 1 ? parts[parts.length - 1] : ui.noCountry,
    }
  }, [formData.location, ui.noCity, ui.noCountry])

  const effectiveMasterVolume = navigationMode === "astral_chord" ? masterVolume * 0.6 : masterVolume
  const themeMotionEnabled = Boolean(THEME_MOTION_VISUALS[interfaceTheme])
  const earthCenterTwinkleTiming = useMemo(() => getThemeTwinkleTiming("earth-center"), [])

  // Added hook for planet audio
  const {
    playPlanetSound,
    stopAll,
    prepareOfflinePlayback,
    startOfflinePlayback,
    getOfflinePlaybackElapsedSec,
    playBackgroundSound,
    stopBackgroundSound,
    prepareOrbitalStarBackground,
    playElementBackground,
    stopElementBackground,
    loadingProgress,
    audioLevelLeftPre,
    audioLevelRightPre,
    audioLevelLeftPost,
    audioLevelRightPost,
    compressionReductionDb,
    renderOfflineMp3,
  } =
    usePlanetAudio({
      fadeIn: audioFadeIn,
      fadeOut: audioFadeOut,
      backgroundVolume: backgroundVolume,
      elementSoundVolume: elementSoundVolume,
      aspectsSoundVolume: aspectsSoundVolume,
      masterVolume: effectiveMasterVolume,
      tuningCents: tuningCents,
      dynAspectsFadeIn: dynAspectsFadeIn,
      dynAspectsSustain: dynAspectsSustain,
      dynAspectsFadeOut: dynAspectsFadeOut,
      modalEnabled,
      modalSunSignIndex,
      audioEngineMode,
      synthVolume,
      vuEnabled: showVuMeter,
      isChordMode: navigationMode === "astral_chord",
      reverbMixPercent,
      chordReverbMixPercent,
    })

  useEffect(() => {
    if (!horoscopeData?.planets?.length) return
    const sunDegrees = horoscopeData.planets.find((planet) => planet.name === "sun")?.ChartPosition?.Ecliptic?.DecimalDegrees
    const sunSignIndex = typeof sunDegrees === "number" ? Math.floor(norm360(sunDegrees) / 30) % 12 : null
    void prepareOrbitalStarBackground(sunSignIndex, { modalEnabled, force: true })
  }, [horoscopeData, modalEnabled, prepareOrbitalStarBackground])
  const lastPlayedPlanetRef = useRef<string | null>(null)
  const lastPlanetTriggerAtMsByNameRef = useRef<Map<string, number>>(new Map())
  const totalLoadingIntroDurationMs = loadingIntroParagraphs.length * LOADING_SUBTITLE_STEP_MS
  const showLoadingIntroScreen =
    !loadingIntroSkipped && (loadingProgress < 100 || !loadingIntroCompleted || !loadingIntroExitReady)

  const languageToggleInline = (
    <div className="flex items-center gap-0.5 font-mono text-[8px] md:text-[10px] uppercase tracking-[0.15em] select-none leading-none">
      <button
        type="button"
        onClick={() => setLanguage("es")}
        className={`px-0.5 py-0.5 transition-colors ${
          language === "es" ? "text-white" : "text-white/40 hover:text-white/80"
        }`}
        aria-label="Cambiar a español"
      >
        SPA
      </button>
      <span className="text-white/30">/</span>
      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={`px-0.5 py-0.5 transition-colors ${
          language === "en" ? "text-white" : "text-white/40 hover:text-white/80"
        }`}
        aria-label="Switch to English"
      >
        ENG
      </button>
    </div>
  )

  const activeThemeVisual = THEME_MOTION_VISUALS[interfaceTheme]
  const themeMotionDataAttr = interfaceTheme
  const interfaceThemeFilter = useMemo(() => {
    return activeThemeVisual.filter
  }, [activeThemeVisual])
  const isThemeMotionActive = Boolean(activeThemeVisual)
  const crtOverlayTone = activeThemeVisual.overlayTone
  const crtBloomTone = activeThemeVisual.bloomTone
  const phosphorShellStyle = activeThemeVisual.shellStyle
  const phosphorShellStyleWithFocus = useMemo(
    () =>
      ({
        ...phosphorShellStyle,
        "--crt-focus-x": `${crtFocusPoint.x}%`,
        "--crt-focus-y": `${crtFocusPoint.y}%`,
      }) satisfies CSSProperties,
    [crtFocusPoint.x, crtFocusPoint.y, phosphorShellStyle],
  )
  const contentToneStyle = useMemo(
    () => ({ filter: interfaceThemeFilter }) satisfies CSSProperties,
    [interfaceThemeFilter],
  )
  const themeMotionOverlays = isThemeMotionActive ? (
    <>
      <div
        aria-hidden="true"
        className="crt-scan-overlay pointer-events-none fixed inset-0 z-0 opacity-100"
        style={{
          backgroundImage: [
            `radial-gradient(circle at var(--crt-focus-x, 50%) var(--crt-focus-y, 50%), ${crtBloomTone} 0%, rgba(0,0,0,0) 62%)`,
            "repeating-linear-gradient(to bottom, rgba(255,255,255,0.055) 0px, rgba(255,255,255,0.055) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
          ].join(", "),
          backgroundBlendMode: "screen",
          mixBlendMode: "screen",
        }}
      />
      <div aria-hidden="true" className="crt-grid-overlay pointer-events-none fixed inset-0 z-0 opacity-100" />
      <div
        aria-hidden="true"
        className="crt-phosphor-overlay pointer-events-none fixed inset-0 z-0 opacity-100"
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,0.06) 0%, ${crtOverlayTone} 48%, rgba(0,0,0,0.12) 100%)`,
          mixBlendMode: "screen",
        }}
      />
      <div aria-hidden="true" className="crt-vignette-overlay pointer-events-none fixed inset-0 z-0" />
    </>
  ) : null
  const chartAnalogGlowAnimation = themeMotionEnabled ? "theme-star-pulse-subtle 6.4s ease-in-out infinite" : undefined
  const chartAnalogGlowFilter =
    "drop-shadow(0 0 2.2px rgba(255,255,255,0.82)) drop-shadow(0 0 6.8px rgba(255,255,255,0.46)) drop-shadow(0 0 14px rgba(255,255,255,0.28))"
  const chartGlyphCoreFilter = "drop-shadow(0 0 1.6px rgba(255,255,255,0.58))"
  const chartGlyphHaloBaseFilter =
    "url(#glyph-halo-only) drop-shadow(0 0 6.4px rgba(255,255,255,0.98)) drop-shadow(0 0 16px rgba(255,255,255,0.88))"
  const chartGlyphHaloHoverFilter =
    "url(#glyph-halo-only) drop-shadow(0 0 7.6px rgba(255,255,255,1)) drop-shadow(0 0 19.2px rgba(255,255,255,0.95))"
  const chartAddonGlowStyle = useMemo(
    () =>
      ({
        filter: chartAnalogGlowFilter,
        animation: chartAnalogGlowAnimation,
        mixBlendMode: "screen",
      }) satisfies CSSProperties,
    [chartAnalogGlowAnimation],
  )
  const chartAddonPassiveGlowStyle = useMemo(
    () =>
      ({
        ...chartAddonGlowStyle,
        pointerEvents: "none",
      }) satisfies CSSProperties,
    [chartAddonGlowStyle],
  )
  const loadingDisplayProgressTarget = useMemo(() => {
    // Keep bar proportional to actual loading while preserving intro timeline as minimum floor.
    const proportionalLoad = Math.max(0, Math.min(100, loadingProgress))
    const introFloor = loadingIntroCompleted ? 100 : Math.min(99, loadingIntroProgressPct)
    return Math.max(proportionalLoad, introFloor)
  }, [loadingIntroCompleted, loadingIntroProgressPct, loadingProgress])
  const [loadingDisplayProgress, setLoadingDisplayProgress] = useState(0)

  useEffect(() => {
    let frameId: number | null = null
    const animate = () => {
      setLoadingDisplayProgress((prev) => {
        const delta = loadingDisplayProgressTarget - prev
        if (Math.abs(delta) < 0.05) return loadingDisplayProgressTarget
        return prev + delta * 0.16
      })
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
    }
  }, [loadingDisplayProgressTarget])

  const clearLoadingIntroAdvanceTimeout = useCallback(() => {
    if (loadingIntroAdvanceTimeoutRef.current) {
      clearTimeout(loadingIntroAdvanceTimeoutRef.current)
      loadingIntroAdvanceTimeoutRef.current = null
    }
  }, [])

  const showLoadingLanguageHint = useCallback((nextLanguage: Language) => {
    if (loadingLanguageHintFadeTimeoutRef.current) {
      clearTimeout(loadingLanguageHintFadeTimeoutRef.current)
      loadingLanguageHintFadeTimeoutRef.current = null
    }
    if (loadingLanguageHintClearTimeoutRef.current) {
      clearTimeout(loadingLanguageHintClearTimeoutRef.current)
      loadingLanguageHintClearTimeoutRef.current = null
    }

    setLoadingLanguageHint(nextLanguage)
    setLoadingLanguageHintFading(false)

    loadingLanguageHintFadeTimeoutRef.current = setTimeout(() => {
      setLoadingLanguageHintFading(true)
      loadingLanguageHintFadeTimeoutRef.current = null
    }, 5000)

    loadingLanguageHintClearTimeoutRef.current = setTimeout(() => {
      setLoadingLanguageHint(null)
      setLoadingLanguageHintFading(false)
      loadingLanguageHintClearTimeoutRef.current = null
    }, 8000)
  }, [])

  const advanceLoadingIntroParagraph = useCallback(() => {
    const lastParagraphIndex = loadingIntroParagraphs.length - 1
    if (loadingIntroIndexRef.current >= lastParagraphIndex) {
      loadingIntroElapsedBeforeCurrentMsRef.current = totalLoadingIntroDurationMs
      loadingIntroParagraphStartTimeRef.current = performance.now()
      setLoadingIntroProgressPct(100)
      setLoadingIntroCompleted(true)
      clearLoadingIntroAdvanceTimeout()
      return
    }

    const nextIndex = loadingIntroIndexRef.current + 1
    loadingIntroIndexRef.current = nextIndex
    loadingIntroElapsedBeforeCurrentMsRef.current = Math.min(totalLoadingIntroDurationMs, nextIndex * LOADING_SUBTITLE_STEP_MS)
    loadingIntroParagraphStartTimeRef.current = performance.now()

    setLoadingIntroCompleted(false)
    setLoadingIntroIndex(nextIndex)
    setLoadingIntroTick((prev) => prev + 1)
    setLoadingIntroProgressPct((loadingIntroElapsedBeforeCurrentMsRef.current / totalLoadingIntroDurationMs) * 100)
  }, [clearLoadingIntroAdvanceTimeout, totalLoadingIntroDurationMs])

  const retreatLoadingIntroParagraph = useCallback(() => {
    if (loadingIntroIndexRef.current <= 0) return

    const prevIndex = loadingIntroIndexRef.current - 1
    loadingIntroIndexRef.current = prevIndex
    loadingIntroElapsedBeforeCurrentMsRef.current = Math.max(0, prevIndex * LOADING_SUBTITLE_STEP_MS)
    loadingIntroParagraphStartTimeRef.current = performance.now()

    setLoadingIntroCompleted(false)
    setLoadingIntroIndex(prevIndex)
    setLoadingIntroTick((prev) => prev + 1)
    setLoadingIntroProgressPct((loadingIntroElapsedBeforeCurrentMsRef.current / totalLoadingIntroDurationMs) * 100)
  }, [totalLoadingIntroDurationMs])

  const skipLoadingIntro = useCallback(() => {
    setLoadingIntroSkipped(true)
    setLoadingIntroCompleted(true)
    setLoadingIntroExitReady(true)
    clearLoadingIntroAdvanceTimeout()
  }, [clearLoadingIntroAdvanceTimeout])

  const openInfoOverlay = useCallback(() => {
    setInfoParagraphIndex(0)
    setShowInfoOverlay(true)
  }, [])

  const closeInfoOverlay = useCallback(() => {
    setShowInfoOverlay(false)
  }, [])

  const advanceInfoParagraph = useCallback(() => {
    setInfoParagraphIndex((prev) => {
      const next = prev + 1
      if (next >= infoParagraphs.length) {
        setShowInfoOverlay(false)
        return 0
      }
      return next
    })
  }, [infoParagraphs.length])

  const retreatInfoParagraph = useCallback(() => {
    setInfoParagraphIndex((prev) => (prev - 1 + infoParagraphs.length) % infoParagraphs.length)
  }, [infoParagraphs.length])

  useEffect(() => {
    if (!showLoadingIntroScreen) return

    loadingIntroIndexRef.current = 0
    loadingIntroElapsedBeforeCurrentMsRef.current = 0
    loadingIntroParagraphStartTimeRef.current = performance.now()

    setLoadingIntroIndex(0)
    setLoadingIntroTick(0)
    setLoadingIntroCompleted(false)
    setLoadingIntroProgressPct(0)

    let animationFrameId: number | null = null
    const updateLoadingTimeline = () => {
      const now = performance.now()
      const elapsedMs =
        loadingIntroElapsedBeforeCurrentMsRef.current + Math.max(0, now - loadingIntroParagraphStartTimeRef.current)
      const boundedElapsedMs = Math.min(totalLoadingIntroDurationMs, elapsedMs)
      const progressPct = (boundedElapsedMs / totalLoadingIntroDurationMs) * 100
      setLoadingIntroProgressPct(progressPct)

      if (boundedElapsedMs >= totalLoadingIntroDurationMs) {
        setLoadingIntroCompleted(true)
        setLoadingIntroProgressPct(100)
        clearLoadingIntroAdvanceTimeout()
        return
      }

      animationFrameId = requestAnimationFrame(updateLoadingTimeline)
    }

    animationFrameId = requestAnimationFrame(updateLoadingTimeline)

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      clearLoadingIntroAdvanceTimeout()
    }
  }, [clearLoadingIntroAdvanceTimeout, showLoadingIntroScreen, totalLoadingIntroDurationMs])

  useEffect(() => {
    if (!showLoadingIntroScreen || loadingIntroCompleted) return

    clearLoadingIntroAdvanceTimeout()
    loadingIntroAdvanceTimeoutRef.current = setTimeout(() => {
      advanceLoadingIntroParagraph()
    }, LOADING_SUBTITLE_STEP_MS)

    return () => {
      clearLoadingIntroAdvanceTimeout()
    }
  }, [advanceLoadingIntroParagraph, clearLoadingIntroAdvanceTimeout, loadingIntroCompleted, loadingIntroIndex, showLoadingIntroScreen])

  useEffect(() => {
    if (loadingIntroSkipped) return
    if (!loadingIntroCompleted || loadingProgress < 100) {
      setLoadingIntroExitReady(false)
      return
    }

    const timeoutId = setTimeout(() => {
      setLoadingIntroExitReady(true)
    }, 10000)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [loadingIntroCompleted, loadingIntroSkipped, loadingProgress])

  useEffect(() => {
    if (!showInfoOverlay) return

    const handleInfoOverlayKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeInfoOverlay()
        return
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        advanceInfoParagraph()
        return
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        retreatInfoParagraph()
      }
    }

    window.addEventListener("keydown", handleInfoOverlayKeyDown)
    return () => {
      window.removeEventListener("keydown", handleInfoOverlayKeyDown)
    }
  }, [advanceInfoParagraph, closeInfoOverlay, retreatInfoParagraph, showInfoOverlay])

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "o" && event.key !== "O") return

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const isEditableTarget =
        !!target && (target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select")
      if (isEditableTarget) return

      event.preventDefault()
      setAdvancedMenuEnabled((prev) => !prev)
    }

    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const savedLanguage = window.localStorage.getItem("astro.log.io.language")
    if (savedLanguage === "en" || savedLanguage === "es") {
      setLanguage(savedLanguage)
      return
    }
    const browserLanguage = window.navigator.language?.toLowerCase() || "en"
    setLanguage(browserLanguage.startsWith("es") ? "es" : "en")
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("astro.log.io.language", language)
  }, [language])

  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.setAttribute("data-phosphor-theme", interfaceTheme)
  }, [interfaceTheme])

  useEffect(() => {
    if (hasAutoAppliedHereNowRef.current) return
    if (!showSubject) return
    if (showLoadingIntroScreen) return
    hasAutoAppliedHereNowRef.current = true
    void applyHereAndNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLoadingIntroScreen, showSubject])

  const updateMenuPanelPosition = useCallback(() => {
    if (typeof window === "undefined") return
    const anchorRect = menuPanelAnchorRef.current?.getBoundingClientRect()
    if (!anchorRect) {
      setMenuPanelPosition(null)
      return
    }

    const panelWidth = window.innerWidth >= 768 ? 560 : Math.min(window.innerWidth * 0.92, 540)
    const viewportPadding = 12
    const left = Math.min(
      Math.max(viewportPadding, anchorRect.left),
      Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding),
    )

    setMenuPanelPosition({
      bottom: Math.max(viewportPadding, window.innerHeight - anchorRect.bottom),
      left,
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDownOutsideMenu = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuPanelRef.current?.contains(target)) return
      if (desktopMenuButtonRef.current?.contains(target)) return
      if (mobileMenuButtonRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDownOutsideMenu)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutsideMenu)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPanelPosition(null)
      return
    }

    updateMenuPanelPosition()

    window.addEventListener("resize", updateMenuPanelPosition)
    window.addEventListener("scroll", updateMenuPanelPosition, true)

    return () => {
      window.removeEventListener("resize", updateMenuPanelPosition)
      window.removeEventListener("scroll", updateMenuPanelPosition, true)
    }
  }, [menuOpen, updateMenuPanelPosition])

  const clearAspectTimers = useCallback(() => {
    Object.values(aspectClickTimersRef.current).forEach((timers) => {
      timers.forEach((timerId) => clearTimeout(timerId))
    })
    aspectClickTimersRef.current = {}
  }, [])

  useEffect(() => {
    if (showSubject) return
    if (skipNextAutoCalculateRef.current) {
      skipNextAutoCalculateRef.current = false
      return
    }

    const birthDateTime = formData.datetime.trim()
    const [birthDate, birthTime] = birthDateTime.split("T")
    const latitude = Number.parseFloat(formData.latitude.replace(",", "."))
    const longitude = Number.parseFloat(formData.longitude.replace(",", "."))

    if (!birthDate || !birthTime || Number.isNaN(latitude) || Number.isNaN(longitude)) return

    const calculateHoroscope = async () => {
      try {
        console.log("[v0] Calculating with isSidereal:", isSidereal)
        const data = await calculateCustomHoroscope(birthDate, birthTime, latitude, longitude, isSidereal, selectedPreset)
        console.log("[v0] Horoscope data received:", data)
        console.log("[v0] Aspects found:", data.aspects?.length || 0, data.aspects)
        if (!data?.planets?.length) return
        setHoroscopeData(data)
        setShowChart(true)
      } catch (calcError) {
        console.error("[v0] Auto-calculate failed:", calcError)
      }
    }

    calculateHoroscope()
  }, [formData, isSidereal, selectedPreset, showSubject])

  useEffect(() => {
    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current)
        animationFrameIdRef.current = null
      }
      if (playbackProgressFrameRef.current !== null) {
        cancelAnimationFrame(playbackProgressFrameRef.current)
        playbackProgressFrameRef.current = null
      }
      if (navigationStepTimeoutRef.current) {
        clearTimeout(navigationStepTimeoutRef.current)
        navigationStepTimeoutRef.current = null
      }
      if (navigationTimeoutsRef.current.length > 0) {
        navigationTimeoutsRef.current.forEach((timerId) => clearTimeout(timerId))
        navigationTimeoutsRef.current = []
      }
      clearAspectTimers()
      if (startButtonPhaseTimeoutRef.current) {
        clearTimeout(startButtonPhaseTimeoutRef.current)
        startButtonPhaseTimeoutRef.current = null
      }
      if (pressedGlyphReleaseTimeoutRef.current) {
        clearTimeout(pressedGlyphReleaseTimeoutRef.current)
        pressedGlyphReleaseTimeoutRef.current = null
      }
      if (interactivePreviewClearTimeoutRef.current) {
        clearTimeout(interactivePreviewClearTimeoutRef.current)
        interactivePreviewClearTimeoutRef.current = null
      }
      if (loadingIntroAdvanceTimeoutRef.current) {
        clearTimeout(loadingIntroAdvanceTimeoutRef.current)
        loadingIntroAdvanceTimeoutRef.current = null
      }
      if (loadingLanguageHintFadeTimeoutRef.current) {
        clearTimeout(loadingLanguageHintFadeTimeoutRef.current)
        loadingLanguageHintFadeTimeoutRef.current = null
      }
      if (loadingLanguageHintClearTimeoutRef.current) {
        clearTimeout(loadingLanguageHintClearTimeoutRef.current)
        loadingLanguageHintClearTimeoutRef.current = null
      }
    }
  }, [clearAspectTimers])

  // Track peak audio level (pre/post) and reset every 5 seconds
  useEffect(() => {
    if (audioLevelLeftPre > peakLevelLeftPre) {
      setPeakLevelLeftPre(audioLevelLeftPre)
    }
    if (audioLevelRightPre > peakLevelRightPre) {
      setPeakLevelRightPre(audioLevelRightPre)
    }
    if (audioLevelLeftPost > peakLevelLeftPost) {
      setPeakLevelLeftPost(audioLevelLeftPost)
    }
    if (audioLevelRightPost > peakLevelRightPost) {
      setPeakLevelRightPost(audioLevelRightPost)
    }
  }, [
    audioLevelLeftPre,
    audioLevelRightPre,
    audioLevelLeftPost,
    audioLevelRightPost,
    peakLevelLeftPre,
    peakLevelRightPre,
    peakLevelLeftPost,
    peakLevelRightPost,
  ])

  useEffect(() => {
    if (!showVuMeter) {
      setPeakLevelLeftPre(0)
      setPeakLevelRightPre(0)
      setPeakLevelLeftPost(0)
      setPeakLevelRightPost(0)
      return
    }

    const peakResetInterval = setInterval(() => {
      setPeakLevelLeftPre(0)
      setPeakLevelRightPre(0)
      setPeakLevelLeftPost(0)
      setPeakLevelRightPost(0)
    }, 5000)
    
    return () => clearInterval(peakResetInterval)
  }, [showVuMeter])

  const percentToDb = (percent: number) => {
    const db = (percent / 100) * 60 - 60
    return Math.max(-60, Math.min(0, db))
  }

  const formatSuggestion = (name: string, _admin1: string | undefined, country: string) => {
    return [name, country].filter(Boolean).join(", ")
  }

  const searchLocation = useCallback(async (query: string, count = 6): Promise<GeoSuggestion[]> => {
    const trimmed = query.trim()
    if (!trimmed) return []

    const geocodeLanguage = language === "es" ? "es" : "en"
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=${count}&language=${geocodeLanguage}&format=json`
    const response = await fetch(url)
    if (!response.ok) return []

    const payload = await response.json()
    const results = Array.isArray(payload?.results) ? payload.results : []
    return results
      .filter((item: any) => item?.name && item?.country && Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude))
      .map((item: any) => ({
        name: item.name,
        country: item.country,
        admin1: item.admin1,
        latitude: item.latitude,
          longitude: item.longitude,
          display: formatSuggestion(item.name, item.admin1, item.country),
      }))
  }, [language])

  const resolveLocationAndUpdateCoords = useCallback(
    async (rawLocation: string) => {
      const input = rawLocation.trim()
      if (!input) return null

      setIsResolvingLocation(true)
      try {
        const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim()
        const normalizedInput = normalize(input)
        const pool = locationSuggestions.length > 0 ? locationSuggestions : await searchLocation(input, 8)

        let best = pool.find((item) => normalize(item.display) === normalizedInput)
        if (!best) {
          best = pool.find((item) => normalize(item.display).includes(normalizedInput))
        }
        if (!best) {
          const fallback = await searchLocation(input, 1)
          best = fallback[0]
        }
        if (!best) return null
        const selected = best

        setFormData((prev) => ({
          ...prev,
          location: selected.display,
          latitude: selected.latitude.toFixed(4),
          longitude: selected.longitude.toFixed(4),
        }))
        setLocationSuggestions((prev) => (prev.length > 0 ? prev : [selected]))
        return selected
      } catch {
        return null
      } finally {
        setIsResolvingLocation(false)
      }
    },
    [locationSuggestions, searchLocation],
  )

  const reverseGeocodeLocation = useCallback(async (latitude: number, longitude: number): Promise<string | null> => {
    try {
      const geocodeLanguage = language === "es" ? "es" : "en"
      const fallbackUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=${geocodeLanguage}`
      const fallbackResponse = await fetch(fallbackUrl)
      if (fallbackResponse.ok) {
        const fallbackPayload = await fallbackResponse.json()
        const fallbackCity =
          fallbackPayload?.city ||
          fallbackPayload?.locality ||
          fallbackPayload?.principalSubdivision ||
          null
        const fallbackCountry = fallbackPayload?.countryName || null
        if (fallbackCity && fallbackCountry) {
          return formatSuggestion(String(fallbackCity), undefined, String(fallbackCountry))
        }
        if (fallbackCity) {
          return String(fallbackCity)
        }
      }
    } catch {
      // Continue with secondary provider.
    }

    try {
      const geocodeLanguage = language === "es" ? "es" : "en"
      const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=${geocodeLanguage}&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`
      const nominatimResponse = await fetch(nominatimUrl)
      if (!nominatimResponse.ok) return null
      const nominatimPayload = await nominatimResponse.json()
      const address = nominatimPayload?.address || {}
      const cityCandidate =
        address.city ||
        address.town ||
        address.village ||
        address.municipality ||
        address.county ||
        address.state ||
        null
      const countryCandidate = address.country || null
      if (cityCandidate && countryCandidate) {
        return formatSuggestion(String(cityCandidate), undefined, String(countryCandidate))
      }
      if (cityCandidate) {
        return String(cityCandidate)
      }
      if (countryCandidate) {
        return String(countryCandidate)
      }
      return null
    } catch {
      return null
    }
  }, [language])

  const getCurrentPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (typeof window === "undefined" || !window.navigator?.geolocation) {
        reject(new Error("GeolocationUnavailable"))
        return
      }

      const tryGet = (highAccuracy: boolean) =>
        window.navigator.geolocation.getCurrentPosition(
          resolve,
          (err) => {
            if (highAccuracy && (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE)) {
              window.navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 15000,
                maximumAge: 600000,
              })
            } else {
              reject(err)
            }
          },
          {
            enableHighAccuracy: highAccuracy,
            timeout: 10000,
            maximumAge: 120000,
          },
        )

      tryGet(true)
    })
  }, [])

  useEffect(() => {
    if (!showSubject || (selectedPreset !== "manual" && selectedPreset !== "here_now")) return

    const q = formData.location.trim()
    if (q.length < 2) {
      setLocationSuggestions([])
      return
    }

    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchLocation(q, 6)
        setLocationSuggestions(results)
      } catch {
        setLocationSuggestions([])
      }
    }, 220)

    return () => clearTimeout(timeoutId)
  }, [formData.location, searchLocation, selectedPreset, showSubject])

  useEffect(() => {
    if ((selectedPreset !== "manual" && selectedPreset !== "here_now") || !showSubject) {
      setLocationSuggestions([])
    }
  }, [selectedPreset, showSubject])

  const cancelPointerLoop = useCallback(() => {
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current)
      animationFrameIdRef.current = null
    }
  }, [])

  const cancelPlaybackProgressAnimation = useCallback(() => {
    if (playbackProgressFrameRef.current !== null) {
      cancelAnimationFrame(playbackProgressFrameRef.current)
      playbackProgressFrameRef.current = null
    }
  }, [])

  const startPlaybackProgressAnimation = useCallback(
    (durationMs: number) => {
      cancelPlaybackProgressAnimation()
      setPlaybackProgress(0)
      if (durationMs <= 0) return
      const startMs = performance.now()
      const tick = () => {
        const now = performance.now()
        const progress = Math.min(1, (now - startMs) / durationMs)
        setPlaybackProgress(progress)
        if (progress >= 1) {
          playbackProgressFrameRef.current = null
          return
        }
        playbackProgressFrameRef.current = requestAnimationFrame(tick)
      }
      playbackProgressFrameRef.current = requestAnimationFrame(tick)
    },
    [cancelPlaybackProgressAnimation],
  )

  const detectPlanetUnderPointer = useCallback(
    (adjustedAngle: number, ascDegrees: number): string | null => {
      if (!horoscopeData?.planets) return null
      const chartRotation = 180 - ascDegrees

      for (const planet of horoscopeData.planets) {
        const planetDegrees = planet.ChartPosition.Ecliptic.DecimalDegrees
        const planetCanvasAngle = norm360(planetDegrees + chartRotation)
        const diff = Math.abs(adjustedAngle - planetCanvasAngle)
        const circularDiff = Math.min(diff, 360 - diff)
        if (circularDiff < 5) return planet.name
      }
      return null
    },
    [horoscopeData?.planets],
  )

  const triggerPlanetAudioAtPointer = useCallback(
    (
      planetName: string,
      adjustedAngle: number,
      options?: { aspectsPoint1Only?: boolean; forceChordProfile?: boolean },
    ) => {
      const planet = horoscopeData?.planets?.find((p) => p.name === planetName)
      if (!planet) return

      const aspectsPoint1Only = options?.aspectsPoint1Only ?? false
      const aspectsForPlanet =
        horoscopeData?.aspects?.filter(
          (aspect) =>
            (aspect.point1.name.toLowerCase() === planetName.toLowerCase() ||
              aspect.point2.name.toLowerCase() === planetName.toLowerCase()) &&
            isMajorAspectType(aspect.aspectType) &&
            (!aspectsPoint1Only || aspect.point1.name.toLowerCase() === planetName.toLowerCase()),
        ) || []

      playPlanetSound(
        planetName,
        adjustedAngle,
        planet.declination || 0,
        aspectsForPlanet,
        horoscopeData?.planets || [],
        horoscopeData?.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees || 0,
        horoscopeData?.mc?.ChartPosition?.Ecliptic?.DecimalDegrees || 0,
        undefined,
        options?.forceChordProfile
          ? {
              wetMix: Math.max(0, Math.min(1, chordReverbMixPercent / 100)),
              decaySeconds: 5,
              gainMultiplier: 1.1,
              fadeOutScale: 2,
              fadeOutCurve: "s",
            }
          : undefined,
      )
    },
    [
      horoscopeData?.aspects,
      horoscopeData?.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees,
      horoscopeData?.mc?.ChartPosition?.Ecliptic?.DecimalDegrees,
      horoscopeData?.planets,
      chordReverbMixPercent,
      playPlanetSound,
    ],
  )

  const beginPointerLoop = useCallback(
    (initialElapsedMs: number, options?: { mutePlanetAudio?: boolean }) => {
      if (!horoscopeData) return

      const ascDegrees = horoscopeData.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees ?? 0
      const totalDuration = loopDuration * 1000
      const uiCommitIntervalMs = 66
      const mutePlanetAudio = options?.mutePlanetAudio ?? false

      loopStartTimeRef.current = performance.now() - Math.max(0, initialElapsedMs)
      lastUiCommitTimeRef.current = 0

      const tick = () => {
        const now = performance.now()
        const elapsed = now - loopStartTimeRef.current
        const boundedElapsed = Math.min(elapsed, totalDuration)
        const state = calculatePointerState(boundedElapsed, totalDuration, ascDegrees)
        const detectedPlanet = detectPlanetUnderPointer(state.adjustedAngle, ascDegrees)

        if (!mutePlanetAudio && detectedPlanet && detectedPlanet !== lastPlayedPlanetRef.current) {
          // Anti-click guard: don't re-trigger the same planet within 600 ms.
          // Detection can flicker at angular boundaries (planet→null→planet)
          // and rapid re-triggers create overlapping note onsets that audibly click.
          const lastTriggeredAt = lastPlanetTriggerAtMsByNameRef.current.get(detectedPlanet) ?? 0
          if (now - lastTriggeredAt >= 600) {
            triggerPlanetAudioAtPointer(detectedPlanet, state.adjustedAngle)
            lastPlanetTriggerAtMsByNameRef.current.set(detectedPlanet, now)
          }
          lastPlayedPlanetRef.current = detectedPlanet
        } else if (!detectedPlanet) {
          lastPlayedPlanetRef.current = null
        }

        if (lastUiCommitTimeRef.current === 0 || now - lastUiCommitTimeRef.current >= uiCommitIntervalMs) {
          lastUiCommitTimeRef.current = now
          setPointerRotation(state.pointerRotation)
          setDebugPointerAngle(Math.round(state.adjustedAngle))
          setCurrentPlanetUnderPointer(detectedPlanet)
          setPlaybackProgress(totalDuration > 0 ? boundedElapsed / totalDuration : 0)
        }

        if (elapsed >= totalDuration) {
          cancelPointerLoop()
          loopElapsedBeforePauseMsRef.current = 0
          setPointerRotation(180)
          setPointerOpacity(1)
          setPointerOpacityTransitionMs(0)
          setChartAspectsTransitionMs(0)
          setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
          setPlaybackProgress(0)
          setIsLoopRunning(false)
          setIsPaused(false)
          setCurrentPlanetUnderPointer(null)
          setDebugPointerAngle(0)
          setStartButtonPhase("contracted")
          stopBackgroundSound()
          stopElementBackground()
          return
        }

        animationFrameIdRef.current = requestAnimationFrame(tick)
      }

      cancelPointerLoop()
      animationFrameIdRef.current = requestAnimationFrame(tick)
    },
    [
      cancelPointerLoop,
      detectPlanetUnderPointer,
      horoscopeData,
      loopDuration,
      stopBackgroundSound,
      stopElementBackground,
      triggerPlanetAudioAtPointer,
    ],
  )

  const clearNavigationTimeouts = useCallback(() => {
    if (navigationStepTimeoutRef.current) {
      clearTimeout(navigationStepTimeoutRef.current)
      navigationStepTimeoutRef.current = null
    }
    if (navigationTimeoutsRef.current.length > 0) {
      navigationTimeoutsRef.current.forEach((timerId) => clearTimeout(timerId))
      navigationTimeoutsRef.current = []
    }
  }, [])

  const cancelAllNavigationSchedulers = useCallback(() => {
    cancelPointerLoop()
    clearNavigationTimeouts()
    navigationRunIdRef.current += 1
  }, [cancelPointerLoop, clearNavigationTimeouts])

  useEffect(() => {
    if (!isLoopRunning) {
      lastPlayedPlanetRef.current = null
      lastPlanetTriggerAtMsByNameRef.current.clear()
      // When loop ends, stop background sound
      stopBackgroundSound()
      stopElementBackground()
    }
  }, [isLoopRunning, stopBackgroundSound, stopElementBackground])

  useEffect(() => {
    if (hoveredGlyph) {
      let opacity = 0
      const fadeInInterval = setInterval(() => {
        opacity += 0.02 // 5 seconds / 100 steps = 50ms per step
        if (opacity >= 1) {
          opacity = 1
          clearInterval(fadeInInterval)
        }
        setGlyphHoverOpacity(opacity)
      }, 50)

      return () => {
        clearInterval(fadeInInterval)
      }
    } else {
      if (glyphHoverOpacity > 0) {
        let opacity = glyphHoverOpacity
        const fadeOutInterval = setInterval(() => {
          opacity -= 0.02
          if (opacity < 0) {
            opacity = 0
            clearInterval(fadeOutInterval)
          }
          setGlyphHoverOpacity(opacity)
        }, 50)

        return () => {
          clearInterval(fadeOutInterval)
        }
      }
    }
  }, [hoveredGlyph, glyphHoverOpacity])

  useEffect(() => {
    if (
      navigationMode === "astral_chord" ||
      navigationMode === "sequential" ||
      !showDynAspects ||
      !currentPlanetUnderPointer ||
      !horoscopeData?.aspects
    ) {
      return
    }

    const planet = horoscopeData?.planets?.find((p) => p.name.toLowerCase() === currentPlanetUnderPointer.toLowerCase())
    if (!planet) return

    const aspectsForPlanet = horoscopeData.aspects.filter(
      (aspect) =>
        (aspect.point1.name.toLowerCase() === currentPlanetUnderPointer.toLowerCase() ||
          aspect.point2.name.toLowerCase() === currentPlanetUnderPointer.toLowerCase()) &&
        isMajorAspectType(aspect.aspectType),
    )

    if (aspectsForPlanet.length === 0) return

    const fadeInInterval = setInterval(() => {
      setActivePlanetAspectsMap((prevMap) => {
        const current = prevMap[currentPlanetUnderPointer] || { aspects: aspectsForPlanet, opacity: 0 }
        const targetOpacity = MAX_ASPECT_LINE_OPACITY
        const increment = targetOpacity / (dynAspectsFadeIn * 10) // Divide by (seconds * 10) for 100ms intervals
        const newOpacity = Math.min(current.opacity + increment, targetOpacity)

        return {
          ...prevMap,
          [currentPlanetUnderPointer]: {
            aspects: aspectsForPlanet,
            opacity: newOpacity,
          },
        }
      })
    }, 100)

    const fadeInTimeout = setTimeout(() => {
      clearInterval(fadeInInterval)
    }, dynAspectsFadeIn * 1000)

    return () => {
      clearInterval(fadeInInterval)
      clearTimeout(fadeInTimeout)
    }
  }, [currentPlanetUnderPointer, showDynAspects, dynAspectsFadeIn, horoscopeData?.aspects, navigationMode])

  useEffect(() => {
    if (navigationMode === "astral_chord" || navigationMode === "sequential") {
      return
    }
    if (
      showDynAspects &&
      currentPlanetUnderPointer === null &&
      !hoveredGlyph &&
      !pressedGlyph &&
      Object.keys(activePlanetAspectsMap).length > 0
    ) {
      const fadeOutInterval = setInterval(() => {
        setActivePlanetAspectsMap((prevMap) => {
          const result = { ...prevMap }
          const targetOpacity = 0
          const decrement = MAX_ASPECT_LINE_OPACITY / (dynAspectsFadeOut * 10) // Divide by (seconds * 10) for 100ms intervals

          Object.keys(result).forEach((planetName) => {
            result[planetName].opacity = Math.max(result[planetName].opacity - decrement, targetOpacity)
          })

          const hasVisibleAspects = Object.values(result).some((data) => data.opacity > 0)
          if (!hasVisibleAspects) {
            return {}
          }

          return result
        })
      }, 100)

      const fadeOutTimeout = setTimeout(() => {
        clearInterval(fadeOutInterval)
        setActivePlanetAspectsMap({})
      }, dynAspectsFadeOut * 1000)

      return () => {
        clearInterval(fadeOutInterval)
        clearTimeout(fadeOutTimeout)
      }
    }
  }, [currentPlanetUnderPointer, showDynAspects, activePlanetAspectsMap, dynAspectsFadeOut, navigationMode, hoveredGlyph, pressedGlyph])

  useEffect(() => {
    return () => {
      if (subjectHoverTouchTimeoutRef.current) {
        clearTimeout(subjectHoverTouchTimeoutRef.current)
        subjectHoverTouchTimeoutRef.current = null
      }
      if (topPanelHintTimeoutRef.current) {
        clearTimeout(topPanelHintTimeoutRef.current)
        topPanelHintTimeoutRef.current = null
      }
      if (mobileDownloadArmTimeoutRef.current) {
        clearTimeout(mobileDownloadArmTimeoutRef.current)
        mobileDownloadArmTimeoutRef.current = null
      }
      if (pendingMp3Download?.url) {
        URL.revokeObjectURL(pendingMp3Download.url)
      }
    }
  }, [pendingMp3Download])

  const resetToInitialState = () => {
    playbackPreparationRequestIdRef.current += 1
    setIsPreparingPlaybackAudio(false)
    setIsExportingMp3(false)
    setPendingMp3Download(null)
    cancelAllNavigationSchedulers()
    cancelPlaybackProgressAnimation()
    clearAspectTimers()
    loopStartTimeRef.current = 0
    loopElapsedBeforePauseMsRef.current = 0
    lastUiCommitTimeRef.current = 0
    if (startButtonPhaseTimeoutRef.current) {
      clearTimeout(startButtonPhaseTimeoutRef.current)
      startButtonPhaseTimeoutRef.current = null
    }
    setIsLoopRunning(false)
    setIsPaused(false)
    setPointerRotation(180)
    setPointerOpacity(1)
    setPointerOpacityTransitionMs(0)
    setChartAspectsTransitionMs(0)
    setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
    setPlaybackProgress(0)
    setCurrentPlanetUnderPointer(null)
    setDebugPointerAngle(0)
    setStartButtonPhase("contracted")
    lastClickTimeRef.current = 0
    glyphAnimationManager["animations"]?.clear()
    setAnimatedPlanets({})
    stopBackgroundSound()
    stopElementBackground()
    setHoveredGlyph(null)
    setPressedGlyph(null)
    setGlyphHoverOpacity(0)
    setActivePlanetAspectsMap({})
    if (pressedGlyphReleaseTimeoutRef.current) {
      clearTimeout(pressedGlyphReleaseTimeoutRef.current)
      pressedGlyphReleaseTimeoutRef.current = null
    }
    if (interactivePreviewClearTimeoutRef.current) {
      clearTimeout(interactivePreviewClearTimeoutRef.current)
      interactivePreviewClearTimeoutRef.current = null
    }
    stopAll()
    setShowSubject(false)
    setShowChart(true)
    setError("")
    setElementSoundVolume(2)
    setBackgroundVolume(2)
    setAspectsSoundVolume(DEFAULT_ASPECTS_SOUND_VOLUME)
    setMasterVolume(50)
    setReverbMixPercent(20)
    setChordReverbMixPercent(40)
    setSynthVolume(450)
    setModalEnabled(true)
    setAudioEngineMode("samples")
    setLoopDuration(180)
    setShowDynAspects(true)
    setShowAspectGraph(false)
    setShowAspectBox(false)
    setShowAspectIndicator(false)
    setShowPlanets(false)
    setShowAspects(false)
    setShowMatrix(false)
    setShowCircle(false)
    setShowSignsRing(false)
    setShowHousesRing(false)
    setShowDegrees(false)
    setShowAngles(false)
    setShowAstroChart(false)
    setShowPointer(true)
    setShowPointerInfo(false)
    setShowVuMeter(false)
    setShowModeInfo(false)
    setIsSidereal(false)
  }

  const startAmbientBed = (options?: { playBackground?: boolean; playElement?: boolean; elementVolumeOverride?: number }) => {
    const playBackground = options?.playBackground ?? true
    const playElement = options?.playElement ?? true

    if (playBackground) {
      playBackgroundSound({
        sunSignIndex: modalSunSignIndex,
        modalEnabled,
      })
    } else {
      stopBackgroundSound()
    }

    if (!playElement) {
      stopElementBackground()
      return
    }

    if (horoscopeData?.planets && horoscopeData?.ascendant) {
      const sunDegrees = horoscopeData.planets.find((p) => p.name === "sun")?.ChartPosition.Ecliptic.DecimalDegrees
      if (sunDegrees !== undefined) {
        playElementBackground(
          getElementFromDegrees(sunDegrees),
          undefined,
          0,
          30,
          {
            modalEnabled,
            sunSignIndex: modalSunSignIndex,
          },
          options?.elementVolumeOverride,
        )
      }
    }
  }

  const setPointerAngle = (angle: number, currentPlanet: string | null) => {
    const normalized = norm360(angle)
    // Pointer base is at 180° (left) and CSS rotate is clockwise-positive.
    // Convert chart angle (counter-clockwise-positive) into CSS rotation.
    setPointerRotation(180 - normalized)
    setDebugPointerAngle(Math.round(normalized))
    setCurrentPlanetUnderPointer(currentPlanet)
  }

  const getPlanetDialAngle = (planetName: string): number | null => {
    const normalizedName = planetName.toLowerCase()
    const planet = horoscopeData?.planets?.find((p) => p.name.toLowerCase() === normalizedName)
    if (!planet || !horoscopeData?.ascendant) return null
    const degree = adjustedPositions[planet.name] ?? planet.ChartPosition.Ecliptic.DecimalDegrees
    const chartRotation = 180 - horoscopeData.ascendant.ChartPosition.Ecliptic.DecimalDegrees
    return norm360(degree + chartRotation)
  }

  const buildSequentialRoute = (): string[] => {
    if (!horoscopeData?.planets) return []
    const available = new Set(horoscopeData.planets.map((p) => p.name.toLowerCase()))
    return SEQUENTIAL_PLANET_ORDER.filter((name) => available.has(name))
  }

  const startNonRadialRoute = (
    route: string[],
    options?: {
      teleport?: boolean
      holdMs?: number
      crossfadeMs?: number
      chartAspects?: boolean
      fadeInSpeedMultiplier?: number
      fadeTransitionMultiplier?: number
      shrinkHoldForFade?: boolean
      forceContinuousFade?: boolean
      audioLeadMs?: number
      jitterMs?: number
      infractionProbability?: number
      infractionJitterMs?: number
    },
  ) => {
    const resolvedRoute = route
      .map((name) => ({ name, angle: getPlanetDialAngle(name) }))
      .filter((item): item is { name: string; angle: number } => item.angle !== null)
    if (resolvedRoute.length === 0) {
      setIsLoopRunning(false)
      setStartButtonPhase("contracted")
      return
    }

    const teleport = options?.teleport ?? false
    const holdMs = Math.max(0, options?.holdMs ?? 0)
    const crossfadeMs = Math.max(0, options?.crossfadeMs ?? NAVIGATION_TRANSITION_MS)
    const chartAspects = options?.chartAspects ?? false
    const fadeInSpeedMultiplier = Math.max(1, options?.fadeInSpeedMultiplier ?? 1)
    const fadeTransitionMultiplier = Math.max(1, options?.fadeTransitionMultiplier ?? 1)
    const shrinkHoldForFade = options?.shrinkHoldForFade ?? false
    const forceContinuousFade = options?.forceContinuousFade ?? false
    const audioLeadMs = Math.max(0, options?.audioLeadMs ?? 0)
    const jitterMs = Math.max(0, options?.jitterMs ?? 0)
    const infractionProbability = Math.min(1, Math.max(0, options?.infractionProbability ?? 0))
    const infractionJitterMs = Math.max(jitterMs, options?.infractionJitterMs ?? jitterMs)
    const baseHalfFadeMs = Math.max(0, Math.floor(crossfadeMs / 2))
    const baseFadeInMs = Math.max(0, Math.floor(baseHalfFadeMs / fadeInSpeedMultiplier))
    const halfFadeMs = Math.max(0, Math.floor(baseHalfFadeMs * fadeTransitionMultiplier))
    const fadeInMs = Math.max(0, Math.floor(baseFadeInMs * fadeTransitionMultiplier))
    const transitionFadeDurationMs = Math.max(0, halfFadeMs + fadeInMs)
    const runId = navigationRunIdRef.current
    const uiCommitIntervalMs = 33
    let lastUiCommitMs = 0
    let stepIndex = 0

    setPointerOpacity(1)
    setPointerOpacityTransitionMs(0)
    setChartAspectsTransitionMs(0)
    setPointerAngle(resolvedRoute[0].angle, resolvedRoute[0].name)
    triggerPlanetAudioAtPointer(resolvedRoute[0].name, resolvedRoute[0].angle)
    if (chartAspects) {
      triggerChartPlanetAspects(resolvedRoute[0].name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: 0 })
    }
    lastPlayedPlanetRef.current = resolvedRoute[0].name

    const animateTransition = (fromAngle: number, toAngle: number, onDone: () => void) => {
      const startMs = performance.now()
      const delta = ((toAngle - fromAngle + 540) % 360) - 180
      const tick = () => {
        if (navigationRunIdRef.current !== runId) return
        const now = performance.now()
        const progress = Math.min(1, (now - startMs) / NAVIGATION_TRANSITION_MS)
        const angle = norm360(fromAngle + delta * progress)
        if (lastUiCommitMs === 0 || now - lastUiCommitMs >= uiCommitIntervalMs) {
          lastUiCommitMs = now
          setPointerAngle(angle, resolvedRoute[Math.min(stepIndex + 1, resolvedRoute.length - 1)]?.name ?? null)
        }
        if (progress >= 1) {
          setPointerAngle(toAngle, resolvedRoute[Math.min(stepIndex + 1, resolvedRoute.length - 1)]?.name ?? null)
          onDone()
          return
        }
        animationFrameIdRef.current = requestAnimationFrame(tick)
      }
      cancelPointerLoop()
      animationFrameIdRef.current = requestAnimationFrame(tick)
    }

    const finishRoute = () => {
      setIsLoopRunning(false)
      setIsPaused(false)
      setPlaybackProgress(0)
      setCurrentPlanetUnderPointer(null)
      setStartButtonPhase("contracted")
      loopElapsedBeforePauseMsRef.current = 0
      setPointerOpacity(1)
      setPointerOpacityTransitionMs(0)
      setChartAspectsTransitionMs(0)
      if (chartAspects) {
        const key = chartAspectsKeyRef.current
        setActivePlanetAspectsMap((prevMap) => {
          if (!prevMap[key]) return prevMap
          const updated = { ...prevMap }
          delete updated[key]
          return updated
        })
      }
    }

    const computeStepHoldMs = () => {
      if (forceContinuousFade) return 0
      if (holdMs <= 0) return 0
      const useInfraction = Math.random() < infractionProbability
      const jitterRange = useInfraction ? infractionJitterMs : jitterMs
      const randomOffset = jitterRange > 0 ? (Math.random() * 2 - 1) * jitterRange : 0
      const rawHoldMs = Math.max(0, holdMs + randomOffset)
      if (!shrinkHoldForFade) return rawHoldMs
      return Math.max(0, rawHoldMs - transitionFadeDurationMs)
    }

    const teleportTransition = (
      currentStep: { name: string; angle: number },
      nextStep: { name: string; angle: number },
      onDone: () => void,
    ) => {
      if (!teleport) {
        onDone()
        return
      }

      if (halfFadeMs === 0) {
        setPointerOpacity(0)
        if (chartAspects) {
          triggerChartPlanetAspects(currentStep.name, { targetOpacity: 0, transitionMs: 0 })
        }
        setPointerAngle(nextStep.angle, nextStep.name)
        triggerPlanetAudioAtPointer(nextStep.name, nextStep.angle)
        lastPlayedPlanetRef.current = nextStep.name
        if (chartAspects) {
          triggerChartPlanetAspects(nextStep.name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: 0 })
        }
        setPointerOpacity(1)
        onDone()
        return
      }

      setPointerOpacityTransitionMs(halfFadeMs)
      setPointerOpacity(0)
      if (chartAspects) {
        triggerChartPlanetAspects(currentStep.name, { targetOpacity: 0, transitionMs: halfFadeMs })
      }

      const fadeOutTimer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setPointerAngle(nextStep.angle, nextStep.name)
        triggerPlanetAudioAtPointer(nextStep.name, nextStep.angle)
        lastPlayedPlanetRef.current = nextStep.name
        if (chartAspects) {
          triggerChartPlanetAspects(nextStep.name, { targetOpacity: 0, transitionMs: 0 })
        }
        setPointerOpacityTransitionMs(fadeInMs)
        setPointerOpacity(1)

        if (chartAspects) {
          const chartFadeInTimer = setTimeout(() => {
            if (navigationRunIdRef.current !== runId) return
            triggerChartPlanetAspects(nextStep.name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: fadeInMs })
          }, 0)
          navigationTimeoutsRef.current.push(chartFadeInTimer)
        }

        const fadeInTimer = setTimeout(() => {
          if (navigationRunIdRef.current !== runId) return
          setPointerOpacityTransitionMs(0)
          onDone()
        }, fadeInMs)
        navigationTimeoutsRef.current.push(fadeInTimer)
      }, halfFadeMs)
      navigationTimeoutsRef.current.push(fadeOutTimer)
    }

    const scheduleNextAdvance = () => {
      if (navigationRunIdRef.current !== runId) return
      const stepHoldMs = computeStepHoldMs()
      const waitBeforeTransitionMs = Math.max(0, stepHoldMs - audioLeadMs)
      navigationStepTimeoutRef.current = setTimeout(advance, waitBeforeTransitionMs)
    }

    const advance = () => {
      if (navigationRunIdRef.current !== runId) return
      const nextIndex = stepIndex + 1
      if (nextIndex >= resolvedRoute.length) {
        finishRoute()
        return
      }

      const currentStep = resolvedRoute[stepIndex]
      const nextStep = resolvedRoute[nextIndex]
      const runStepDone = () => {
        stepIndex = nextIndex
        if (stepIndex >= resolvedRoute.length - 1) {
          const finalHoldMs = computeStepHoldMs()
          if (finalHoldMs > 0) {
            navigationStepTimeoutRef.current = setTimeout(() => {
              if (navigationRunIdRef.current !== runId) return
              finishRoute()
            }, finalHoldMs)
          } else {
            finishRoute()
          }
          return
        }
        scheduleNextAdvance()
      }

      if (!teleport) {
        triggerPlanetAudioAtPointer(nextStep.name, nextStep.angle)
        lastPlayedPlanetRef.current = nextStep.name
      }
      if (chartAspects && !teleport) {
        triggerChartPlanetAspects(nextStep.name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: 100 })
      }

      if (teleport) {
        if (audioLeadMs > 0) {
          const transitionTimer = setTimeout(() => {
            if (navigationRunIdRef.current !== runId) return
            teleportTransition(currentStep, nextStep, runStepDone)
          }, audioLeadMs)
          navigationTimeoutsRef.current.push(transitionTimer)
        } else {
          teleportTransition(currentStep, nextStep, runStepDone)
        }
        return
      }

      if (audioLeadMs > 0) {
        const transitionTimer = setTimeout(() => {
          if (navigationRunIdRef.current !== runId) return
          animateTransition(currentStep.angle, nextStep.angle, runStepDone)
        }, audioLeadMs)
        navigationTimeoutsRef.current.push(transitionTimer)
      } else {
        animateTransition(currentStep.angle, nextStep.angle, runStepDone)
      }
    }

    scheduleNextAdvance()
  }

  const startSequentialVisualMode = (timeline: NavigationPlaybackTimelineItem[]) => {
    if (timeline.length === 0) {
      setIsLoopRunning(false)
      setStartButtonPhase("contracted")
      return
    }

    const runId = navigationRunIdRef.current
    const baseHalfFadeMs = Math.max(0, Math.floor(NON_RADIAL_CROSSFADE_MS / 2))
    const halfFadeMs = Math.max(0, Math.floor(baseHalfFadeMs * NON_RADIAL_FADE_SLOWDOWN_MULTIPLIER))
    const fadeInMs = Math.max(0, Math.floor(baseHalfFadeMs * NON_RADIAL_FADE_SLOWDOWN_MULTIPLIER))

    const teleportTransition = (
      currentStep: NavigationPlaybackTimelineItem,
      nextStep: NavigationPlaybackTimelineItem,
    ) => {
      if (halfFadeMs === 0) {
        setPointerOpacity(0)
        triggerChartPlanetAspects(currentStep.name, { targetOpacity: 0, transitionMs: 0 })
        setPointerAngle(nextStep.angle, nextStep.name)
        triggerChartPlanetAspects(nextStep.name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: 0 })
        setPointerOpacity(1)
        return
      }

      setPointerOpacityTransitionMs(halfFadeMs)
      setPointerOpacity(0)
      triggerChartPlanetAspects(currentStep.name, { targetOpacity: 0, transitionMs: halfFadeMs })

      const fadeOutTimer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setPointerAngle(nextStep.angle, nextStep.name)
        triggerChartPlanetAspects(nextStep.name, { targetOpacity: 0, transitionMs: 0 })
        setPointerOpacityTransitionMs(fadeInMs)
        setPointerOpacity(1)

        const fadeInTimer = setTimeout(() => {
          if (navigationRunIdRef.current !== runId) return
          triggerChartPlanetAspects(nextStep.name, {
            targetOpacity: MAX_ASPECT_LINE_OPACITY,
            transitionMs: fadeInMs,
          })
          setPointerOpacityTransitionMs(0)
        }, 0)
        navigationTimeoutsRef.current.push(fadeInTimer)
      }, halfFadeMs)
      navigationTimeoutsRef.current.push(fadeOutTimer)
    }

    setPointerOpacity(1)
    setPointerOpacityTransitionMs(0)
    setChartAspectsTransitionMs(0)
    setPointerAngle(timeline[0].angle, timeline[0].name)
    triggerChartPlanetAspects(timeline[0].name, { targetOpacity: MAX_ASPECT_LINE_OPACITY, transitionMs: 0 })
    lastPlayedPlanetRef.current = timeline[0].name

    for (let index = 1; index < timeline.length; index += 1) {
      const currentStep = timeline[index - 1]
      const nextStep = timeline[index]
      const transitionStartMs = Math.max(0, nextStep.startSec * 1000 - halfFadeMs)
      const timer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        teleportTransition(currentStep, nextStep)
        lastPlayedPlanetRef.current = nextStep.name
      }, transitionStartMs)
      navigationTimeoutsRef.current.push(timer)
    }

    const finalStartSec = timeline[timeline.length - 1]?.startSec ?? 0
    const finishTimer = setTimeout(() => {
      if (navigationRunIdRef.current !== runId) return
      setIsLoopRunning(false)
      setIsPaused(false)
      setPlaybackProgress(0)
      setCurrentPlanetUnderPointer(null)
      setStartButtonPhase("contracted")
      setActivePlanetAspectsMap({})
      setPointerOpacity(1)
      setPointerOpacityTransitionMs(0)
      setChartAspectsTransitionMs(0)
    }, Math.max(2000, finalStartSec * 1000 + fadeInMs + 800))
    navigationTimeoutsRef.current.push(finishTimer)
  }

  const startAstralChordMode = (
    timeline?: NavigationPlaybackTimelineItem[],
    options?: { mutePlanetAudio?: boolean },
  ) => {
    if (!horoscopeData?.planets) return
    const runId = navigationRunIdRef.current
    const mutePlanetAudio = options?.mutePlanetAudio ?? false
    const allMajorAspects =
      horoscopeData.aspects?.filter(
        (aspect) =>
          isMajorAspectType(aspect.aspectType) &&
          aspect.point1.name.toLowerCase() !== aspect.point2.name.toLowerCase(),
      ) || []

    if (allMajorAspects.length > 0) {
      setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
      setActivePlanetAspectsMap({
        all: {
          aspects: allMajorAspects,
          opacity: 0,
        },
      })
      const chordFadeTimer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setActivePlanetAspectsMap((prevMap) => {
          const current = prevMap.all
          if (!current) return prevMap
          return {
            ...prevMap,
            all: {
              aspects: current.aspects,
              opacity: 1,
            },
          }
        })
      }, 40)
      navigationTimeoutsRef.current.push(chordFadeTimer)

      const chordFadeOutTimer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_OUT_MS)
        setActivePlanetAspectsMap((prevMap) => {
          const current = prevMap.all
          if (!current) return prevMap
          return {
            ...prevMap,
            all: {
              aspects: current.aspects,
              opacity: 0,
            },
          }
        })
      }, CHORD_ASPECTS_FADE_IN_MS + CHORD_ASPECTS_HOLD_MS)
      navigationTimeoutsRef.current.push(chordFadeOutTimer)

      const chordCleanupTimer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setActivePlanetAspectsMap((prevMap) => {
          if (!prevMap.all) return prevMap
          const updated = { ...prevMap }
          delete updated.all
          return updated
        })
      }, CHORD_ASPECTS_FADE_IN_MS + CHORD_ASPECTS_HOLD_MS + CHORD_ASPECTS_FADE_OUT_MS + 80)
      navigationTimeoutsRef.current.push(chordCleanupTimer)
    } else {
      setActivePlanetAspectsMap({})
    }

    const routeTimeline =
      timeline && timeline.length > 0
        ? timeline
        : buildSequentialRoute()
            .filter((name, index, arr) => index === arr.indexOf(name))
            .map((planetName, index) => {
              const angle = getPlanetDialAngle(planetName)
              if (angle === null) return null
              return {
                name: planetName,
                angle,
                startSec: index * 0.02,
              }
            })
            .filter((item): item is NavigationPlaybackTimelineItem => item !== null)
    setCurrentPlanetUnderPointer(null)

    routeTimeline.forEach((item) => {
      const timer = setTimeout(() => {
        if (navigationRunIdRef.current !== runId) return
        setCurrentPlanetUnderPointer(item.name)
        if (!mutePlanetAudio) {
          triggerPlanetAudioAtPointer(item.name, item.angle, { aspectsPoint1Only: false, forceChordProfile: true })
        }
      }, item.startSec * 1000)
      navigationTimeoutsRef.current.push(timer)
    })

    const totalDurationSec = Math.max(audioFadeIn + audioFadeOut, dynAspectsFadeIn + dynAspectsSustain + dynAspectsFadeOut)
    const chordVisualDurationMs = CHORD_ASPECTS_FADE_IN_MS + CHORD_ASPECTS_HOLD_MS + CHORD_ASPECTS_FADE_OUT_MS + 300
    const finalRouteStartSec = routeTimeline.length > 0 ? routeTimeline[routeTimeline.length - 1].startSec : 0
    const finishTimer = setTimeout(() => {
      if (navigationRunIdRef.current !== runId) return
      setIsLoopRunning(false)
      setIsPaused(false)
      setPlaybackProgress(0)
      setCurrentPlanetUnderPointer(null)
      setStartButtonPhase("contracted")
      setActivePlanetAspectsMap({})
      setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
    }, Math.max(2000, totalDurationSec * 1000 + 300, chordVisualDurationMs, finalRouteStartSec * 1000 + 400))
    navigationTimeoutsRef.current.push(finishTimer)
  }

  const startNavigationMode = async (mode: NavigationMode) => {
    if (!horoscopeData) return

    setNavigationMode(mode)
    cancelAllNavigationSchedulers()
    cancelPlaybackProgressAnimation()
    clearAspectTimers()
    stopAll()
    stopBackgroundSound()
    stopElementBackground()
    loopElapsedBeforePauseMsRef.current = 0
    lastUiCommitTimeRef.current = 0
    setPointerOpacity(1)
    setPointerOpacityTransitionMs(0)
    setChartAspectsTransitionMs(0)
    setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
    setPlaybackProgress(0)
    setActivePlanetAspectsMap({})
    setIsLoopRunning(false)
    setIsPaused(false)
    setStartButtonPhase("contracted")

    const runId = navigationRunIdRef.current
    const preparationRequestId = playbackPreparationRequestIdRef.current + 1
    playbackPreparationRequestIdRef.current = preparationRequestId
    setIsPreparingPlaybackAudio(true)

    const playbackPlan = buildNavigationPlaybackPlan(mode)
    const preparedPlayback = playbackPlan ? await prepareOfflinePlayback(playbackPlan.audioOptions) : null

    if (
      navigationRunIdRef.current !== runId ||
      playbackPreparationRequestIdRef.current !== preparationRequestId
    ) {
      return
    }

    setIsPreparingPlaybackAudio(false)
    setIsLoopRunning(true)
    setStartButtonPhase("expanding")

    if (startButtonPhaseTimeoutRef.current) {
      clearTimeout(startButtonPhaseTimeoutRef.current)
    }
    startButtonPhaseTimeoutRef.current = setTimeout(() => {
      setStartButtonPhase("stable")
    }, 15000)

    if (playbackPlan && preparedPlayback) {
      await startOfflinePlayback(playbackPlan.audioOptions, 0)
      if (
        navigationRunIdRef.current !== runId ||
        playbackPreparationRequestIdRef.current !== preparationRequestId
      ) {
        return
      }

      if (mode === "radial") {
        beginPointerLoop(0, { mutePlanetAudio: true })
        return
      }

      if (mode === "astral_chord") {
        startPlaybackProgressAnimation(
          Math.max(
            2000,
            playbackPlan.durationSec * 1000,
            CHORD_ASPECTS_FADE_IN_MS + CHORD_ASPECTS_HOLD_MS + CHORD_ASPECTS_FADE_OUT_MS + 300,
          ),
        )
        startAstralChordMode(playbackPlan.timeline, { mutePlanetAudio: true })
        return
      }

      startPlaybackProgressAnimation(Math.max(CHART_PLANET_HOLD_MS, playbackPlan.durationSec * 1000))
      startSequentialVisualMode(playbackPlan.timeline)
      return
    }

    if (mode === "radial") {
      startAmbientBed({ playBackground: true, playElement: true })
      beginPointerLoop(0)
      return
    }
    if (mode === "astral_chord") {
      startAmbientBed({ playBackground: false, playElement: true })
      startPlaybackProgressAnimation(
        Math.max(
          2000,
          Math.max(audioFadeIn + audioFadeOut, dynAspectsFadeIn + dynAspectsSustain + dynAspectsFadeOut) * 1000 + 300,
          CHORD_ASPECTS_FADE_IN_MS + CHORD_ASPECTS_HOLD_MS + CHORD_ASPECTS_FADE_OUT_MS + 300,
        ),
      )
      startAstralChordMode()
      return
    }
    if (mode === "sequential") {
      startAmbientBed({ playBackground: false, playElement: true, elementVolumeOverride: 1 })
      startPlaybackProgressAnimation(Math.max(CHART_PLANET_HOLD_MS, buildSequentialRoute().length * CHART_PLANET_HOLD_MS))
      startNonRadialRoute(buildSequentialRoute(), {
        teleport: true,
        holdMs: CHART_PLANET_HOLD_MS,
        crossfadeMs: NON_RADIAL_CROSSFADE_MS,
        chartAspects: true,
        fadeInSpeedMultiplier: 1,
        fadeTransitionMultiplier: NON_RADIAL_FADE_SLOWDOWN_MULTIPLIER,
        shrinkHoldForFade: true,
        forceContinuousFade: true,
        audioLeadMs: 0,
        jitterMs: NON_RADIAL_JITTER_MS,
        infractionProbability: NON_RADIAL_INFRACTION_PROBABILITY,
        infractionJitterMs: NON_RADIAL_INFRACTION_JITTER_MS,
      })
    }
  }

  const buildOfflineMp3Plan = useCallback(
    (
      mode: NavigationMode,
    ):
      | {
          events: OfflineMp3PlanetEvent[]
          durationSec: number
          includeBackground: boolean
          includeElement: boolean
          elementVolumePercent: number
          timeline: NavigationPlaybackTimelineItem[]
        }
      | null => {
      if (!horoscopeData?.planets) return null

      const getDeclination = (planetName: string): number => {
        const found = horoscopeData.planets.find((planet) => planet.name.toLowerCase() === planetName.toLowerCase())
        return found?.declination || 0
      }

      const getAspectEvents = (planetName: string, aspectsPoint1Only: boolean): OfflineMp3AspectEvent[] => {
        const events: OfflineMp3AspectEvent[] = []
        for (const aspect of horoscopeData.aspects || []) {
          if (!isMajorAspectType(aspect.aspectType)) continue

          const point1 = aspect.point1.name.toLowerCase()
          const point2 = aspect.point2.name.toLowerCase()
          const targetName = planetName.toLowerCase()
          const isRelated = point1 === targetName || point2 === targetName
          if (!isRelated) continue
          if (aspectsPoint1Only && point1 !== targetName) continue

          const otherPlanet = point1 === targetName ? point2 : point1
          const otherAngle = getPlanetDialAngle(otherPlanet)
          if (otherAngle === null) continue
          events.push({
            planetName: otherPlanet,
            angleDeg: otherAngle,
            declinationDeg: getDeclination(otherPlanet),
            aspectType: aspect.aspectType,
          })
        }
        return events
      }

      const buildPlanetEvent = (planetName: string, startSec: number): OfflineMp3PlanetEvent | null => {
        const angle = getPlanetDialAngle(planetName)
        if (angle === null) return null
        return {
          planetName,
          angleDeg: angle,
          declinationDeg: getDeclination(planetName),
          startSec,
          fadeInSec: audioFadeIn,
          fadeOutSec: audioFadeOut,
          aspects: getAspectEvents(planetName, false),
          aspectFadeInSec: dynAspectsFadeIn,
          aspectSustainSec: dynAspectsSustain,
          aspectFadeOutSec: dynAspectsFadeOut,
          aspectVolumePercent: aspectsSoundVolume,
        }
      }

      if (mode === "astral_chord") {
        const route = buildSequentialRoute().filter((name, index, arr) => index === arr.indexOf(name))
        const events = route
          .map((planetName, index) => buildPlanetEvent(planetName, index * 0.02))
          .filter((event): event is OfflineMp3PlanetEvent => event !== null)
        if (events.length === 0) return null
        const timeline = events.map((event) => ({
          name: event.planetName,
          angle: event.angleDeg,
          startSec: event.startSec,
        }))
        const chordDurationSec = Math.max(audioFadeIn + audioFadeOut, dynAspectsFadeIn + dynAspectsSustain + dynAspectsFadeOut)
        return {
          events,
          durationSec: Math.max(8, chordDurationSec + 3),
          includeBackground: false,
          includeElement: true,
          elementVolumePercent: elementSoundVolume,
          timeline,
        }
      }

      if (mode === "sequential") {
        const route = buildSequentialRoute()
        if (route.length === 0) return null

        const events: OfflineMp3PlanetEvent[] = []
        const timeline: NavigationPlaybackTimelineItem[] = []
        let cursorSec = 0
        const firstEvent = buildPlanetEvent(route[0], cursorSec)
        if (firstEvent) {
          events.push(firstEvent)
          timeline.push({
            name: firstEvent.planetName,
            angle: firstEvent.angleDeg,
            startSec: firstEvent.startSec,
          })
        }

        for (let i = 1; i < route.length; i++) {
          const seed = [route[i], i, formData.datetime, formData.latitude, formData.longitude, formData.location].join("|")
          const useInfraction = hashStringToUnitInterval(`${seed}|infraction`) < NON_RADIAL_INFRACTION_PROBABILITY
          const jitterRangeMs = useInfraction ? NON_RADIAL_INFRACTION_JITTER_MS : NON_RADIAL_JITTER_MS
          const randomOffsetMs = jitterRangeMs > 0 ? (hashStringToUnitInterval(`${seed}|jitter`) * 2 - 1) * jitterRangeMs : 0
          const stepHoldMs = Math.max(0, CHART_PLANET_HOLD_MS + randomOffsetMs)
          cursorSec += stepHoldMs / 1000

          const event = buildPlanetEvent(route[i], cursorSec)
          if (event) {
            events.push(event)
            timeline.push({
              name: event.planetName,
              angle: event.angleDeg,
              startSec: event.startSec,
            })
          }
        }

        if (events.length === 0) return null
        const durationSec = cursorSec + CHART_PLANET_HOLD_MS / 1000 + Math.max(audioFadeOut, dynAspectsFadeOut) + 2
        return {
          events,
          durationSec: Math.max(10, durationSec),
          includeBackground: false,
          includeElement: true,
          elementVolumePercent: 1,
          timeline,
        }
      }

      const radialEvents = horoscopeData.planets
        .map((planet) => {
          const angle = getPlanetDialAngle(planet.name)
          if (angle === null) return null
          const phase = norm360(angle - 180) / 360
          const startSec = phase * loopDuration
          return buildPlanetEvent(planet.name, startSec)
        })
        .filter((event): event is OfflineMp3PlanetEvent => event !== null)
        .sort((a, b) => a.startSec - b.startSec)

      if (radialEvents.length === 0) return null
      const timeline = radialEvents.map((event) => ({
        name: event.planetName,
        angle: event.angleDeg,
        startSec: event.startSec,
      }))
      return {
        events: radialEvents,
        durationSec: Math.max(12, loopDuration + Math.max(audioFadeOut, dynAspectsFadeOut) + 2),
        includeBackground: true,
        includeElement: true,
        elementVolumePercent: elementSoundVolume,
        timeline,
      }
    },
    [
      aspectsSoundVolume,
      audioFadeIn,
      audioFadeOut,
      buildSequentialRoute,
      dynAspectsFadeIn,
      dynAspectsFadeOut,
      dynAspectsSustain,
      elementSoundVolume,
      formData.datetime,
      formData.latitude,
      formData.location,
      formData.longitude,
      getPlanetDialAngle,
      horoscopeData?.aspects,
      horoscopeData?.planets,
      loopDuration,
    ],
  )

  const buildNavigationPlaybackPlan = useCallback(
    (mode: NavigationMode): NavigationPlaybackPlan | null => {
      if (!horoscopeData?.planets) return null

      const plan = buildOfflineMp3Plan(mode)
      if (!plan || plan.events.length === 0) return null

      const sunDegrees = horoscopeData.planets.find((planet) => planet.name === "sun")?.ChartPosition?.Ecliptic?.DecimalDegrees
      const sunElement = typeof sunDegrees === "number" ? getElementFromDegrees(sunDegrees) : "fire"

      return {
        durationSec: plan.durationSec,
        timeline: plan.timeline,
        audioOptions: {
          events: plan.events,
          durationSec: plan.durationSec,
          masterVolumePercent: mode === "astral_chord" ? masterVolume * 0.6 : masterVolume,
          tuningCents,
          modalEnabled,
          modalSunSignIndex,
          includeBackground: plan.includeBackground,
          backgroundVolumePercent: backgroundVolume,
          includeElement: plan.includeElement,
          elementName: sunElement,
          elementVolumePercent: plan.elementVolumePercent,
          isChordMode: mode === "astral_chord",
          reverbMixPercent: mode === "astral_chord" ? chordReverbMixPercent : reverbMixPercent,
        },
      }
    },
    [
      backgroundVolume,
      buildOfflineMp3Plan,
      chordReverbMixPercent,
      horoscopeData?.planets,
      masterVolume,
      modalEnabled,
      modalSunSignIndex,
      reverbMixPercent,
      tuningCents,
    ],
  )

  const prepareNavigationModePlayback = useCallback(
    async (mode: NavigationMode) => {
      const plan = buildNavigationPlaybackPlan(mode)
      if (!plan) return null
      return await prepareOfflinePlayback(plan.audioOptions)
    },
    [buildNavigationPlaybackPlan, prepareOfflinePlayback],
  )

  useEffect(() => {
    if (!horoscopeData || showSubject) return

    const timeoutId = setTimeout(() => {
      void prepareNavigationModePlayback(navigationMode)
    }, 180)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [horoscopeData, navigationMode, prepareNavigationModePlayback, showSubject])

  const buildSubjectMp3FileName = useCallback((mode: NavigationMode): string => {
    const datetime = formData.datetime.trim()
    const datetimeMatch = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    const yyyymmddhhmm = datetimeMatch
      ? `${datetimeMatch[1]}${datetimeMatch[2]}${datetimeMatch[3]}${datetimeMatch[4]}${datetimeMatch[5]}`
      : "000000000000"

    const locationParts = formData.location
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    const rawCity = locationParts[0] || "CITY"
    const rawCountry = locationParts.length > 1 ? locationParts[locationParts.length - 1] : "COUNTRY"
    const city = sanitizeFileToken(rawCity, "CITY")
    const country = sanitizeFileToken(rawCountry, "COUNTRY")
    const modeSuffix = EXPORT_MODE_SUFFIX[mode]
    return `ASTRO.LOG.IO_${yyyymmddhhmm}_${city}_${country}_${modeSuffix}.mp3`
  }, [formData.datetime, formData.location])

  const buildSubjectSnapshotFileName = useCallback((): string => {
    const datetime = formData.datetime.trim()
    const datetimeMatch = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    const yyyymmddhhmm = datetimeMatch
      ? `${datetimeMatch[1]}${datetimeMatch[2]}${datetimeMatch[3]}${datetimeMatch[4]}${datetimeMatch[5]}`
      : "000000000000"

    const locationParts = formData.location
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    const rawCity = locationParts[0] || "CITY"
    const rawCountry = locationParts.length > 1 ? locationParts[locationParts.length - 1] : "COUNTRY"
    const city = sanitizeFileToken(rawCity, "CITY")
    const country = sanitizeFileToken(rawCountry, "COUNTRY")
    return `ASTRO.LOG.IO_${yyyymmddhhmm}_${city}_${country}_SNAPSHOT.png`
  }, [formData.datetime, formData.location])

  const resolveSvgAssetToDataUrl = useCallback(async (assetHref: string) => {
    const absoluteHref = new URL(assetHref, window.location.origin).href
    const cachedDataUrl = exportAssetDataUrlCacheRef.current.get(absoluteHref)
    if (cachedDataUrl) return cachedDataUrl

    const response = await fetch(absoluteHref)
    if (!response.ok) {
      throw new Error(`Asset fetch failed: ${absoluteHref}`)
    }

    const contentType = response.headers.get("content-type") || ""
    let dataUrl = absoluteHref

    if (contentType.includes("image/svg+xml") || absoluteHref.toLowerCase().endsWith(".svg")) {
      const svgText = await response.text()
      dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
    } else {
      const blob = await response.blob()
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : absoluteHref)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    }

    exportAssetDataUrlCacheRef.current.set(absoluteHref, dataUrl)
    return dataUrl
  }, [])

  const downloadChartSnapshotJpg = useCallback(async () => {
    if (!horoscopeData || !chartSvgRef.current || isExportingJpg) return

    setError("")
    setIsExportingJpg(true)
    try {
      const sourceSvg = chartSvgRef.current
      const clone = sourceSvg.cloneNode(true) as SVGSVGElement
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink")
      clone.setAttribute("width", String(SNAPSHOT_EXPORT_DIMENSION))
      clone.setAttribute("height", String(SNAPSHOT_EXPORT_DIMENSION))
      clone.setAttribute(
        "viewBox",
        `${SNAPSHOT_EXPORT_VIEWBOX.x} ${SNAPSHOT_EXPORT_VIEWBOX.y} ${SNAPSHOT_EXPORT_VIEWBOX.size} ${SNAPSHOT_EXPORT_VIEWBOX.size}`,
      )
      clone.style.background = "transparent"
      if (interfaceThemeFilter !== "none") {
        clone.style.filter = interfaceThemeFilter
      }

      clone.querySelectorAll("[data-export-pointer='true']").forEach((node) => {
        node.remove()
      })

      const originalNodes = Array.from(sourceSvg.querySelectorAll("*"))
      const cloneNodes = Array.from(clone.querySelectorAll("*"))
      for (const [index, originalNode] of originalNodes.entries()) {
        const clonedNode = cloneNodes[index]
        if (!(originalNode instanceof Element) || !(clonedNode instanceof Element)) continue

        if (clonedNode.tagName.toLowerCase() === "text") {
          const computed = window.getComputedStyle(originalNode)
          clonedNode.setAttribute("fill", computed.fill || "#ffffff")
          clonedNode.setAttribute("font-size", computed.fontSize || "8px")
          clonedNode.setAttribute("font-family", computed.fontFamily || MONOTYPE_FONT_STACK)
          clonedNode.setAttribute("font-weight", computed.fontWeight || "400")
          clonedNode.setAttribute("letter-spacing", computed.letterSpacing || "0px")
        }

        if (clonedNode.tagName.toLowerCase() === "image") {
          const href = clonedNode.getAttribute("href") || clonedNode.getAttributeNS("http://www.w3.org/1999/xlink", "href")
          if (href) {
            const resolvedHref = await resolveSvgAssetToDataUrl(href)
            clonedNode.setAttribute("href", resolvedHref)
            clonedNode.setAttributeNS("http://www.w3.org/1999/xlink", "href", resolvedHref)
          }
        }
      }

      const serializedSvg = new XMLSerializer().serializeToString(clone)
      const svgBlob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" })
      const svgUrl = URL.createObjectURL(svgBlob)

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image()
        nextImage.onload = () => resolve(nextImage)
        nextImage.onerror = (event) => reject(event)
        nextImage.src = svgUrl
      })

      const canvas = document.createElement("canvas")
      canvas.width = SNAPSHOT_EXPORT_DIMENSION
      canvas.height = SNAPSHOT_EXPORT_DIMENSION
      const context = canvas.getContext("2d")
      if (!context) {
        URL.revokeObjectURL(svgUrl)
        throw new Error("Canvas context unavailable")
      }
      const exportCenter = SNAPSHOT_EXPORT_DIMENSION / 2
      const exportRadius = SNAPSHOT_EXPORT_DIMENSION / 2
      const themeVisual = THEME_MOTION_VISUALS[interfaceTheme]
      const shellVars = (themeVisual?.shellStyle ?? {}) as Record<string, string>
      const phosphorBgTop = shellVars["--phosphor-bg-top"] || "#020202"
      const phosphorBgMid = shellVars["--phosphor-bg-mid"] || "#0a0a0a"
      const phosphorBgBottom = shellVars["--phosphor-bg-bottom"] || "#020202"
      const phosphorAura = shellVars["--phosphor-aura"] || "rgba(255,255,255,0.1)"
      const phosphorTopGlow = shellVars["--phosphor-top-glow"] || "rgba(255,255,255,0.06)"
      const phosphorScanline = shellVars["--phosphor-scanline"] || "rgba(255,255,255,0.06)"

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.save()

      // Phosphor background gradient (vertical, matching CRT shell)
      const bgGradient = context.createLinearGradient(0, 0, 0, canvas.height)
      bgGradient.addColorStop(0, phosphorBgTop)
      bgGradient.addColorStop(0.52, phosphorBgMid)
      bgGradient.addColorStop(1, phosphorBgBottom)
      context.fillStyle = bgGradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Centered aura/bloom
      const auraGradient = context.createRadialGradient(
        exportCenter, exportCenter, 0,
        exportCenter, exportCenter, exportRadius * 0.85,
      )
      auraGradient.addColorStop(0, phosphorAura)
      auraGradient.addColorStop(1, "rgba(0,0,0,0)")
      context.fillStyle = auraGradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Top glow
      const topGlowGradient = context.createRadialGradient(
        exportCenter, 0, 0,
        exportCenter, 0, exportRadius * 0.6,
      )
      topGlowGradient.addColorStop(0, phosphorTopGlow)
      topGlowGradient.addColorStop(1, "rgba(0,0,0,0)")
      context.fillStyle = topGlowGradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      // Chart SVG (already has interface theme filter applied)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)

      // CRT scanlines
      context.fillStyle = phosphorScanline
      for (let y = 0; y < canvas.height; y += 3) {
        context.fillRect(0, y, canvas.width, 1)
      }

      // Vignette darkening at edges
      const vignetteGradient = context.createRadialGradient(
        exportCenter, exportCenter, exportRadius * 0.55,
        exportCenter, exportCenter, exportRadius,
      )
      vignetteGradient.addColorStop(0, "rgba(0,0,0,0)")
      vignetteGradient.addColorStop(1, "rgba(0,0,0,0.55)")
      context.fillStyle = vignetteGradient
      context.fillRect(0, 0, canvas.width, canvas.height)

      context.restore()
      URL.revokeObjectURL(svgUrl)

      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png")
      })

      if (!pngBlob || pngBlob.size === 0) {
        throw new Error("Empty snapshot export")
      }

      const anchor = document.createElement("a")
      anchor.href = URL.createObjectURL(pngBlob)
      anchor.download = buildSubjectSnapshotFileName()
      anchor.rel = "noopener"
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(anchor.href), 2000)
    } catch (snapshotError) {
      console.error("[v0] Snapshot export error:", snapshotError)
      setError(language === "es" ? "Fallo la exportacion de la foto." : "Photo export failed.")
    } finally {
      setIsExportingJpg(false)
    }
  }, [buildSubjectSnapshotFileName, horoscopeData, interfaceTheme, interfaceThemeFilter, isExportingJpg, language, resolveSvgAssetToDataUrl])

  const downloadNavigationModeMp3 = useCallback(
    async (mode: NavigationMode) => {
      if (!horoscopeData || isExportingMp3) return
      const plan = buildOfflineMp3Plan(mode)
      if (!plan || plan.events.length === 0) {
        setError(language === "es" ? "No se pudo crear el plan de exportacion MP3." : "Could not build the MP3 export plan.")
        return
      }

      const sunDegrees = horoscopeData.planets.find((planet) => planet.name === "sun")?.ChartPosition?.Ecliptic?.DecimalDegrees
      const sunElement = typeof sunDegrees === "number" ? getElementFromDegrees(sunDegrees) : "fire"
      const exportMasterVolume = mode === "astral_chord" ? masterVolume * 0.6 : masterVolume
      const fileName = buildSubjectMp3FileName(mode)

      setPendingMp3Download((prev) => {
        if (prev?.url) {
          URL.revokeObjectURL(prev.url)
        }
        return null
      })
      setError("")
      setIsExportingMp3(true)
      try {
        let fileHandle: any = null
        let savedViaPicker = false
        const showSaveFilePicker = (window as any).showSaveFilePicker
        if (typeof showSaveFilePicker === "function") {
          try {
            fileHandle = await showSaveFilePicker({
              suggestedName: fileName,
              types: [{ description: language === "es" ? "Audio MP3" : "MP3 Audio", accept: { "audio/mpeg": [".mp3"] } }],
            })
          } catch (pickerError: any) {
            if (pickerError?.name === "AbortError") {
              setIsExportingMp3(false)
              return
            }
            console.warn("[v0] showSaveFilePicker unavailable/failed, falling back to auto-download", pickerError)
          }
        }

        const mp3Blob = await renderOfflineMp3({
          events: plan.events,
          durationSec: plan.durationSec,
          masterVolumePercent: exportMasterVolume,
          tuningCents,
          modalEnabled,
          modalSunSignIndex,
          includeBackground: plan.includeBackground,
          backgroundVolumePercent: backgroundVolume,
          includeElement: plan.includeElement,
          elementName: sunElement,
          elementVolumePercent: plan.elementVolumePercent,
          isChordMode: mode === "astral_chord",
          reverbMixPercent: mode === "astral_chord" ? chordReverbMixPercent : reverbMixPercent,
        })
        if (!mp3Blob) {
          setError(language === "es" ? "No se pudo renderizar el archivo MP3." : "Could not render the MP3 file.")
          setIsExportingMp3(false)
          setPendingMp3Download(null)
          return
        }
        if (mp3Blob.size === 0) {
          setError(language === "es" ? "MP3 vacio: el render de audio no produjo datos." : "Empty MP3: audio render produced no data.")
          setIsExportingMp3(false)
          setPendingMp3Download(null)
          return
        }

        if (fileHandle) {
          try {
            const writable = await fileHandle.createWritable()
            await writable.write(mp3Blob)
            await writable.close()
            savedViaPicker = true
          } catch (saveError) {
            console.warn("[v0] Save picker write failed, falling back to browser download", saveError)
          }
        }

        const fileUrl = URL.createObjectURL(mp3Blob)
        setPendingMp3Download((prev) => {
          if (prev?.url) {
            URL.revokeObjectURL(prev.url)
          }
          return { url: fileUrl, fileName }
        })

        if (!savedViaPicker) {
          const anchor = document.createElement("a")
          anchor.href = fileUrl
          anchor.download = fileName
          anchor.rel = "noopener"
          anchor.target = "_blank"
          document.body.appendChild(anchor)
          anchor.click()
          document.body.removeChild(anchor)
          setError(
            language === "es"
              ? "Si la descarga automatica del navegador esta bloqueada, presiona GUARDAR MP3."
              : "If browser auto-download is blocked, press SAVE MP3.",
          )
        } else {
          setError("")
        }
        setNavigationMode(mode)
      } catch (error) {
        console.error("[v0] Offline MP3 export error:", error)
        setError(language === "es" ? "Fallo la exportacion MP3." : "MP3 export failed.")
        setPendingMp3Download(null)
      } finally {
        setIsExportingMp3(false)
      }
    },
    [
      backgroundVolume,
      buildSubjectMp3FileName,
      buildOfflineMp3Plan,
      language,
      horoscopeData,
      isExportingMp3,
      masterVolume,
      modalEnabled,
      modalSunSignIndex,
      chordReverbMixPercent,
      reverbMixPercent,
      renderOfflineMp3,
      tuningCents,
    ],
  )

  const setNavigationModeFromMenu = (mode: NavigationMode) => {
    setNavigationMode(mode)
    if (!horoscopeData) return
    if (!isLoopRunning && !isPaused) return
    startNavigationMode(mode)
  }

  const stopCurrentPerformance = useCallback(() => {
    playbackPreparationRequestIdRef.current += 1
    setIsPreparingPlaybackAudio(false)
    cancelAllNavigationSchedulers()
    cancelPlaybackProgressAnimation()
    clearAspectTimers()
    loopStartTimeRef.current = 0
    loopElapsedBeforePauseMsRef.current = 0
    lastUiCommitTimeRef.current = 0
    if (startButtonPhaseTimeoutRef.current) {
      clearTimeout(startButtonPhaseTimeoutRef.current)
      startButtonPhaseTimeoutRef.current = null
    }
    setIsLoopRunning(false)
    setIsPaused(false)
    setPointerRotation(180)
    setPointerOpacity(1)
    setPointerOpacityTransitionMs(0)
    setChartAspectsTransitionMs(0)
    setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
    setPlaybackProgress(0)
    setCurrentPlanetUnderPointer(null)
    setDebugPointerAngle(0)
    setStartButtonPhase("contracted")
    setActivePlanetAspectsMap({})
    stopBackgroundSound()
    stopElementBackground()
    stopAll()
  }, [cancelAllNavigationSchedulers, cancelPlaybackProgressAnimation, clearAspectTimers, stopAll, stopBackgroundSound, stopElementBackground])

  const resumeRadialPlayback = async () => {
    const resumeOffsetMs = Math.max(0, loopElapsedBeforePauseMsRef.current)
    const playbackPlan = buildNavigationPlaybackPlan("radial")
    const preparationRequestId = playbackPreparationRequestIdRef.current + 1
    playbackPreparationRequestIdRef.current = preparationRequestId
    setIsPreparingPlaybackAudio(true)

    if (playbackPlan) {
      const preparedPlayback = await prepareOfflinePlayback(playbackPlan.audioOptions)
      if (playbackPreparationRequestIdRef.current !== preparationRequestId) {
        return
      }

      if (preparedPlayback) {
        setIsPreparingPlaybackAudio(false)
        setIsPaused(false)
        setIsLoopRunning(true)
        await startOfflinePlayback(playbackPlan.audioOptions, resumeOffsetMs / 1000)
        if (playbackPreparationRequestIdRef.current !== preparationRequestId) {
          return
        }
        beginPointerLoop(resumeOffsetMs, { mutePlanetAudio: true })
        return
      }
    }

    setIsPreparingPlaybackAudio(false)
    setIsPaused(false)
    setIsLoopRunning(true)
    beginPointerLoop(resumeOffsetMs)
  }

  const clearMobileDownloadArm = useCallback(() => {
    if (mobileDownloadArmTimeoutRef.current) {
      clearTimeout(mobileDownloadArmTimeoutRef.current)
      mobileDownloadArmTimeoutRef.current = null
    }
    mobileDownloadArmedModeRef.current = null
  }, [])

  const showTopPanelHint = useCallback((key: string) => {
    setTopPanelHoverKey(key)
    if (topPanelHintTimeoutRef.current) {
      clearTimeout(topPanelHintTimeoutRef.current)
    }
    topPanelHintTimeoutRef.current = setTimeout(() => {
      setTopPanelHoverKey((current) => (current === key ? null : current))
      topPanelHintTimeoutRef.current = null
    }, TOP_PANEL_HINT_MS)
  }, [])

  const handleDownloadButtonPress = useCallback(
    (mode: NavigationMode) => {
      if (!horoscopeData || isExportingMp3) return

      const isTouchLikeDevice =
        typeof window !== "undefined" &&
        ((typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
          window.matchMedia("(hover: none), (pointer: coarse)").matches)

      if (!isTouchLikeDevice) {
        showTopPanelHint(`download:${mode}`)
        void downloadNavigationModeMp3(mode)
        return
      }

      if (mobileDownloadArmedModeRef.current !== mode) {
        mobileDownloadArmedModeRef.current = mode
        showTopPanelHint(`download:${mode}`)
        if (mobileDownloadArmTimeoutRef.current) {
          clearTimeout(mobileDownloadArmTimeoutRef.current)
        }
        mobileDownloadArmTimeoutRef.current = setTimeout(() => {
          mobileDownloadArmedModeRef.current = null
          mobileDownloadArmTimeoutRef.current = null
        }, TOP_PANEL_HINT_MS)
        return
      }

      clearMobileDownloadArm()
      void downloadNavigationModeMp3(mode)
    },
    [clearMobileDownloadArm, downloadNavigationModeMp3, horoscopeData, isExportingMp3, showTopPanelHint],
  )

  const handleEarthCenterPress = () => {
    const mode = navigationMode
    const currentTime = Date.now()
    const isDoubleClick = currentTime - lastClickTimeRef.current < 1000
    lastClickTimeRef.current = currentTime

    if (isDoubleClick) {
      resetToInitialState()
      return
    }

    if (mode === "radial" && navigationMode === "radial" && isLoopRunning && !isPaused) {
      setIsPaused(true)
      cancelPointerLoop()
      loopElapsedBeforePauseMsRef.current = Math.max(
        0,
        getOfflinePlaybackElapsedSec() > 0 ? getOfflinePlaybackElapsedSec() * 1000 : performance.now() - loopStartTimeRef.current,
      )
      stopAll()
      return
    }

    if (mode === "radial" && navigationMode === "radial" && isPaused) {
      void resumeRadialPlayback()
      return
    }

    startNavigationMode(mode)
  }

  const handlePlaybackTogglePress = () => {
    const mode = navigationMode

    if (mode === "radial" && isLoopRunning && !isPaused) {
      setIsPaused(true)
      cancelPointerLoop()
      loopElapsedBeforePauseMsRef.current = Math.max(
        0,
        getOfflinePlaybackElapsedSec() > 0 ? getOfflinePlaybackElapsedSec() * 1000 : performance.now() - loopStartTimeRef.current,
      )
      stopAll()
      return
    }

    if (mode === "radial" && isPaused) {
      void resumeRadialPlayback()
      return
    }

    startNavigationMode(mode)
  }

  const handleCalculate = async (
    startMode?: NavigationMode,
    overridePayload?: SubjectFormData,
    overridePreset?: SubjectPreset,
  ) => {
    pendingModeLaunchRef.current = startMode ?? null

    let trimmed = overridePayload
      ? {
          datetime: overridePayload.datetime.trim(),
          location: overridePayload.location.trim(),
          latitude: overridePayload.latitude.trim(),
          longitude: overridePayload.longitude.trim(),
        }
      : {
          datetime: formData.datetime.trim(),
          location: formData.location.trim(),
          latitude: formData.latitude.trim(),
          longitude: formData.longitude.trim(),
        }

    let payload: SubjectFormData = trimmed
    let presetToUse: SubjectPreset = overridePreset ?? selectedPreset

    if (Object.values(trimmed).every((value) => value === "")) {
      payload = PRESET_BA77_FORM
      presetToUse = "ba77"
      setFormData({ ...PRESET_BA77_FORM })
      setSelectedPreset("manual")
    } else {
      if (trimmed.location) {
        const resolved = await resolveLocationAndUpdateCoords(trimmed.location)
        if (resolved) {
          const fresh = {
            datetime: trimmed.datetime,
            location: resolved.display,
            latitude: resolved.latitude.toFixed(4),
            longitude: resolved.longitude.toFixed(4),
          }
          trimmed = fresh
          payload = fresh
        }
      }

      const isComplete = Object.values(trimmed).every((value) => value !== "")
      if (!isComplete) {
        setError(
          language === "es"
            ? "Completa todos los campos o deja todos vacios para cargar el preset del 28/09/1977."
            : "Complete all fields, or leave all fields empty to load the 28/09/1977 preset.",
        )
        pendingModeLaunchRef.current = null
        return
      }
      payload = trimmed
    }

    const [birthDate, birthTime] = payload.datetime.split("T")
    const latitude = Number.parseFloat(payload.latitude.replace(",", "."))
    const longitude = Number.parseFloat(payload.longitude.replace(",", "."))

    if (!birthDate || !birthTime || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setError(
        language === "es"
          ? "Formato invalido. Revisa fecha/hora, latitud y longitud."
          : "Invalid format. Check date/time, latitude and longitude.",
      )
      pendingModeLaunchRef.current = null
      return
    }

    try {
      setError("")
      setLoading(true)
      setShowChart(true)
      cancelAllNavigationSchedulers()
      clearAspectTimers()
      stopAll()
      stopBackgroundSound()
      stopElementBackground()
      loopElapsedBeforePauseMsRef.current = 0
      lastUiCommitTimeRef.current = 0
      setIsLoopRunning(false)
      setIsPaused(false)
      setCurrentPlanetUnderPointer(null)
      setPointerRotation(180)
      setPointerOpacity(1)
      setPointerOpacityTransitionMs(0)
      setChartAspectsTransitionMs(0)
      setChordAspectsTransitionMs(CHORD_ASPECTS_FADE_IN_MS)
      setDebugPointerAngle(0)
      setActivePlanetAspectsMap({})
      console.log("[v0] Calculating with isSidereal:", isSidereal)
      const data = await calculateCustomHoroscope(birthDate, birthTime, latitude, longitude, isSidereal, presetToUse)
      console.log("[v0] Horoscope data received:", data)
      console.log("[v0] Aspects found:", data.aspects?.length || 0, data.aspects)
      if (!data?.planets?.length) {
        throw new Error("Horoscope returned empty planets list")
      }
      setHoroscopeData(data)
      skipNextAutoCalculateRef.current = true
      setShowChart(true)
      setShowSubject(false)
    } catch (err) {
      pendingModeLaunchRef.current = null
      setError(
        language === "es"
          ? "No se pudo calcular la carta astrologica. Revisa los datos ingresados."
          : "Could not calculate the astrological chart. Check the entered data.",
      )
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const setManualMode = () => {
    setFormData({ ...EMPTY_SUBJECT_FORM })
    setSelectedPreset("manual")
    setError("")
  }

  const applyHereAndNow = async (): Promise<SubjectFormData | null> => {
    const now = new Date()
    const nowDateTime = formatDateTimeLocalValue(now)

    setError("")
    setSelectedPreset("here_now")
    setIsFetchingHereNow(true)
    setFormData({
      datetime: nowDateTime,
      location: "",
      latitude: "",
      longitude: "",
    })

    try {
      const position = await getCurrentPosition()
      const latitude = position.coords.latitude
      const longitude = position.coords.longitude
      const resolvedLocation = await reverseGeocodeLocation(latitude, longitude)
      const timezoneFallbackLocation = buildLocationFromTimeZone(language)
      const locationLabel = sanitizeLocationLabel(
        resolvedLocation ||
          timezoneFallbackLocation ||
          (language === "es"
            ? `Ubicacion actual ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`
            : `Current location ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`),
      )

      setFormData({
        datetime: nowDateTime,
        location: locationLabel,
        latitude: latitude.toFixed(4),
        longitude: longitude.toFixed(4),
      })

      const payload = {
        datetime: nowDateTime,
        location: locationLabel,
        latitude: latitude.toFixed(4),
        longitude: longitude.toFixed(4),
      }

      if (!resolvedLocation) {
        setError(
          language === "es"
            ? "La busqueda de ciudad no estuvo disponible. Se cargo una etiqueta local de respaldo; puedes editarla manualmente."
            : "City lookup was unavailable. A local fallback label was loaded; edit manually if needed.",
        )
      }
      return payload
    } catch (geoError: any) {
      const denied = geoError?.code === 1
      setSelectedPreset("manual")
      setFormData({
        datetime: nowDateTime,
        location: "",
        latitude: "",
        longitude: "",
      })
      setError(
        denied
          ? language === "es"
            ? "Se nego el permiso de geolocalizacion. Ingresa la ubicacion manualmente."
            : "Geolocation permission was denied. Please enter location manually."
          : language === "es"
            ? "La geolocalizacion no esta disponible. Ingresa la ubicacion manualmente."
            : "Geolocation is unavailable. Please enter location manually.",
      )
      return null
    } finally {
      setIsFetchingHereNow(false)
    }
  }

  const isManualSubjectReady =
    (selectedPreset === "manual" || selectedPreset === "here_now") &&
    formData.datetime.trim() !== "" &&
    formData.location.trim() !== "" &&
    formData.latitude.trim() !== "" &&
    formData.longitude.trim() !== ""

  const launchModeFromSubject = useCallback(
    async (mode: NavigationMode) => {
      if (selectedPreset === "here_now" && !isManualSubjectReady) {
        const payload = await applyHereAndNow()
        if (!payload) {
          pendingModeLaunchRef.current = null
          return
        }
        await handleCalculate(mode, payload, "here_now")
        return
      }

      await handleCalculate(mode)
    },
    [applyHereAndNow, handleCalculate, isManualSubjectReady, selectedPreset],
  )

  useEffect(() => {
    if (!horoscopeData || showSubject) return
    const pendingMode = pendingModeLaunchRef.current
    if (!pendingMode) return
    pendingModeLaunchRef.current = null
    startNavigationMode(pendingMode)
  }, [horoscopeData, showSubject])

  const pointerPassFadeMs = useMemo(() => {
    // Pointer hit zone is ±5° (10° total around each glyph).
    const pointerZoneMs = (loopDuration * 1000 * 10) / 360
    return Math.max(220, Math.round(pointerZoneMs / 2))
  }, [loopDuration])

  const pointerSynchronizedGlyphFadeMs = pointerOpacityTransitionMs > 0 ? pointerOpacityTransitionMs : pointerPassFadeMs

  const shouldShowIdlePointer = showPointer && !isLoopRunning && navigationMode === "radial"
  const shouldShowChordCenterPointer = false
  const shouldShowOrbitPointer =
    showPointer &&
    (isLoopRunning || (!isLoopRunning && navigationMode === "sequential"))
  const isPlaybackActive = isLoopRunning && !isPaused
  const isPlaybackUiHidden = isPlaybackActive && !playbackUiVisible
  const playbackUiShellClassName = `playback-ui-shell ${
    isPlaybackUiHidden ? "playback-ui-shell--hidden" : "playback-ui-shell--visible"
  }`
  const earthCenterGlyphGlowTiming = getGlyphGlowTiming("earth-center")
  const earthCenterGlyphGlowAnimation = `planet-glyph-glow ${earthCenterGlyphGlowTiming.durationSec}s ease-in-out ${earthCenterGlyphGlowTiming.delaySec}s infinite alternate`
  const earthCenterThemePulseAnimation = themeMotionEnabled
    ? `theme-star-pulse-subtle 5s ease-in-out infinite, subtle-star-glitch-30 ${earthCenterTwinkleTiming.durationSec}s steps(2, end) ${earthCenterTwinkleTiming.delaySec}s infinite`
    : undefined
  const earthCenterGlyphHaloFilter = isLoopRunning ? chartGlyphHaloHoverFilter : chartGlyphHaloBaseFilter
  const chartScreenPaddingClassName = showSubject
    ? "pb-3 md:pb-[94px]"
    : "pb-[126px] md:pb-[94px]"

  useEffect(() => {
    playbackUiVisibleRef.current = playbackUiVisible
  }, [playbackUiVisible])

  const updateCrtFocusPoint = useCallback(() => {
    if (typeof window === "undefined") return
    const svgRect = chartSvgRef.current?.getBoundingClientRect()
    if (!svgRect || showSubject || !showChart || !horoscopeData) {
      setCrtFocusPoint((current) => (current.x === 50 && current.y === 50 ? current : { x: 50, y: 50 }))
      return
    }

    const nextX = Math.max(0, Math.min(100, ((svgRect.left + svgRect.width / 2) / window.innerWidth) * 100))
    const nextY = Math.max(0, Math.min(100, ((svgRect.top + svgRect.height / 2) / window.innerHeight) * 100))

    setCrtFocusPoint((current) =>
      Math.abs(current.x - nextX) < 0.15 && Math.abs(current.y - nextY) < 0.15
        ? current
        : { x: nextX, y: nextY },
    )
  }, [horoscopeData, showChart, showSubject])

  const clearPlaybackUiHideTimeout = useCallback(() => {
    if (playbackUiHideTimeoutRef.current) {
      clearTimeout(playbackUiHideTimeoutRef.current)
      playbackUiHideTimeoutRef.current = null
    }
  }, [])

  const schedulePlaybackUiHide = useCallback(
    (delayMs: number) => {
      clearPlaybackUiHideTimeout()
      if (!isPlaybackActive) return
      playbackUiHideTimeoutRef.current = setTimeout(() => {
        setPlaybackUiVisible(false)
        playbackUiHideTimeoutRef.current = null
      }, delayMs)
    },
    [clearPlaybackUiHideTimeout, isPlaybackActive],
  )

  useEffect(() => {
    if (!isPlaybackActive) {
      clearPlaybackUiHideTimeout()
      setPlaybackUiVisible(true)
      return
    }

    setPlaybackUiVisible(true)
    schedulePlaybackUiHide(PLAYBACK_UI_INITIAL_HIDE_DELAY_MS)

    const revealPlaybackUi = () => {
      if (!playbackUiVisibleRef.current) {
        setPlaybackUiVisible(true)
      }
      schedulePlaybackUiHide(PLAYBACK_UI_AUTO_HIDE_DELAY_MS)
    }

    window.addEventListener("pointermove", revealPlaybackUi, { passive: true })
    window.addEventListener("pointerdown", revealPlaybackUi, { passive: true })
    window.addEventListener("touchstart", revealPlaybackUi, { passive: true })

    return () => {
      clearPlaybackUiHideTimeout()
      window.removeEventListener("pointermove", revealPlaybackUi)
      window.removeEventListener("pointerdown", revealPlaybackUi)
      window.removeEventListener("touchstart", revealPlaybackUi)
    }
  }, [clearPlaybackUiHideTimeout, isPlaybackActive, schedulePlaybackUiHide])

  useEffect(() => {
    if (!isPlaybackUiHidden) return
    setMenuOpen(false)
  }, [isPlaybackUiHidden])

  useEffect(() => {
    if (typeof window === "undefined") return

    let frameId: number | null = null
    const syncCrtFocus = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        updateCrtFocusPoint()
        frameId = null
      })
    }

    syncCrtFocus()
    const shortDelayId = window.setTimeout(syncCrtFocus, 120)
    const transitionDelayId = window.setTimeout(syncCrtFocus, 620)
    window.addEventListener("resize", syncCrtFocus)
    window.addEventListener("scroll", syncCrtFocus, true)

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      window.clearTimeout(shortDelayId)
      window.clearTimeout(transitionDelayId)
      window.removeEventListener("resize", syncCrtFocus)
      window.removeEventListener("scroll", syncCrtFocus, true)
    }
  }, [horoscopeData, isPlaybackUiHidden, playbackUiVisible, showChart, showSubject, updateCrtFocusPoint])

  const ascDegrees = horoscopeData?.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees ?? 0
  const chartRotation = 180 - ascDegrees
  const adjustToCanvasAngle = (lambda: number) => norm360(lambda + chartRotation)

  const { adjustedPositionsArray, adjustedPositions } = useMemo(() => {
    if (!horoscopeData?.planets || horoscopeData.planets.length === 0) {
      return { adjustedPositionsArray: [], adjustedPositions: {} }
    }

    const positions =
      adjustPlanetPositions(
        horoscopeData.planets.map((p) => ({
          name: p.name,
          degrees: p.ChartPosition.Ecliptic.DecimalDegrees,
        })),
      ) || []

    return {
      adjustedPositionsArray: positions,
      adjustedPositions: Object.fromEntries(positions.map((p) => [p.name, p.adjustedDegrees])),
    }
  }, [horoscopeData])

  const allChartAspectSegments = useMemo(() => {
    if (!horoscopeData?.aspects?.length) return []

    return horoscopeData.aspects.flatMap((aspect, index) => {
      const planet1 = horoscopeData.planets.find((planet) => planet.name === aspect.point1.name)
      const planet2 = horoscopeData.planets.find((planet) => planet.name === aspect.point2.name)

      let pos1: { x: number; y: number } | null = null
      let pos2: { x: number; y: number } | null = null

      if (aspect.point1.name === "asc") {
        const ascLong = horoscopeData.ascendant.ChartPosition?.Ecliptic?.DecimalDegrees
        pos1 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(ascLong))
      } else if (aspect.point1.name === "mc") {
        const mcLong = horoscopeData.mc.ChartPosition?.Ecliptic?.DecimalDegrees
        pos1 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(mcLong))
      } else if (planet1) {
        const degree = adjustedPositions[planet1.name] ?? planet1.ChartPosition.Ecliptic.DecimalDegrees
        pos1 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(degree))
      }

      if (aspect.point2.name === "asc") {
        const ascLong = horoscopeData.ascendant.ChartPosition?.Ecliptic?.DecimalDegrees
        pos2 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(ascLong))
      } else if (aspect.point2.name === "mc") {
        const mcLong = horoscopeData.mc.ChartPosition?.Ecliptic?.DecimalDegrees
        pos2 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(mcLong))
      } else if (planet2) {
        const degree = adjustedPositions[planet2.name] ?? planet2.ChartPosition.Ecliptic.DecimalDegrees
        pos2 = polarToCartesian(200, 200, 180, adjustToCanvasAngle(degree))
      }

      if (!pos1 || !pos2) return []
      const trimmedSegment = trimLineSegment(pos1, pos2, 15, 15)
      if (!trimmedSegment) return []

      return [
        {
          key: `aspect-export-${index}`,
          x1: trimmedSegment.x1,
          y1: trimmedSegment.y1,
          x2: trimmedSegment.x2,
          y2: trimmedSegment.y2,
          stroke: getMajorAspectStrokeColor(aspect.aspectType),
          strokeWidth: 1,
          opacity: MAX_ASPECT_LINE_OPACITY,
        },
      ]
    })
  }, [adjustToCanvasAngle, adjustedPositions, horoscopeData])

  const zodiacRingItems = useMemo(() => {
    const cusps = horoscopeData?.zodiacCusps
    if (!cusps || cusps.length === 0) {
      return ZODIAC_SIGN_FALLBACK_ORDER.map((signKey, idx) => ({
        signKey,
        label: signKey.toUpperCase(),
        centerDegrees: norm360(idx * 30 + 15),
      }))
    }

    const sortedCusps = [...cusps]
      .map((cusp) => ({
        label: cusp.Sign?.label || "",
        startDegrees: cusp.ChartPosition?.Ecliptic?.DecimalDegrees ?? 0,
      }))
      .sort((a, b) => a.startDegrees - b.startDegrees)

    return sortedCusps.map((cusp) => {
      const normalizedLabel = normalizeSignLabel(cusp.label)
      const signKey = ZODIAC_SIGN_KEY_BY_LABEL[normalizedLabel] || normalizedLabel
      return {
        signKey,
        label: cusp.label || signKey.toUpperCase(),
        centerDegrees: norm360(cusp.startDegrees + 15),
      }
    })
  }, [horoscopeData?.zodiacCusps])

  const houseRingItems = useMemo(() => {
    const houses = horoscopeData?.houses
    if (!houses || houses.length === 0) return []

    const sortedHouses = [...houses]
      .map((house) => ({
        id: house.id,
        startDegrees: house.ChartPosition?.StartPosition?.Ecliptic?.DecimalDegrees ?? 0,
      }))
      .sort((a, b) => a.startDegrees - b.startDegrees)

    return sortedHouses.map((house, index) => {
      const nextHouse = sortedHouses[(index + 1) % sortedHouses.length]
      const arcSpan = norm360(nextHouse.startDegrees - house.startDegrees)
      return {
        id: house.id,
        startDegrees: house.startDegrees,
        centerDegrees: norm360(house.startDegrees + arcSpan / 2),
      }
    })
  }, [horoscopeData?.houses])

  const getAspectsForPlanet = (planetName: string) => {
    return (
      horoscopeData?.aspects?.filter(
        (aspect) =>
          (aspect.point1.name === planetName || aspect.point2.name === planetName) && isMajorAspectType(aspect.aspectType),
      ) || []
    )
  }

  const clearInteractivePlanetPreview = useCallback((fadeOut = true) => {
    if (interactivePreviewClearTimeoutRef.current) {
      clearTimeout(interactivePreviewClearTimeoutRef.current)
      interactivePreviewClearTimeoutRef.current = null
    }

    if (!fadeOut) {
      setActivePlanetAspectsMap((prevMap) => {
        if (!prevMap[INTERACTIVE_PREVIEW_KEY]) return prevMap
        const updated = { ...prevMap }
        delete updated[INTERACTIVE_PREVIEW_KEY]
        return updated
      })
      return
    }

    setActivePlanetAspectsMap((prevMap) => {
      const current = prevMap[INTERACTIVE_PREVIEW_KEY]
      if (!current) return prevMap
      return {
        ...prevMap,
        [INTERACTIVE_PREVIEW_KEY]: {
          aspects: current.aspects,
          opacity: 0,
        },
      }
    })

    interactivePreviewClearTimeoutRef.current = setTimeout(() => {
      setActivePlanetAspectsMap((prevMap) => {
        if (!prevMap[INTERACTIVE_PREVIEW_KEY]) return prevMap
        const updated = { ...prevMap }
        delete updated[INTERACTIVE_PREVIEW_KEY]
        return updated
      })
      interactivePreviewClearTimeoutRef.current = null
    }, GLYPH_INTERACTION_PREVIEW_CLEAR_MS)
  }, [])

  const triggerInteractivePlanetPreview = useCallback(
    (planetName: string, adjustedDegrees: number) => {
      const aspectsForPlanet = getAspectsForPlanet(planetName)

      triggerPlanetAudioAtPointer(planetName, adjustedDegrees, {
        forceChordProfile: navigationMode === "astral_chord",
      })

      if (aspectsForPlanet.length === 0) {
        clearInteractivePlanetPreview(false)
        return
      }

      setActivePlanetAspectsMap((prevMap) => ({
        ...prevMap,
        [INTERACTIVE_PREVIEW_KEY]: {
          aspects: aspectsForPlanet,
          opacity: MAX_ASPECT_LINE_OPACITY,
        },
      }))
    },
    [clearInteractivePlanetPreview, getAspectsForPlanet, navigationMode, triggerPlanetAudioAtPointer],
  )

  const triggerChartPlanetAspects = useCallback(
    (planetName: string, options?: { targetOpacity?: number; transitionMs?: number }) => {
      const key = chartAspectsKeyRef.current
      const existingTimers = aspectClickTimersRef.current[key]
      if (existingTimers) {
        existingTimers.forEach((timerId) => clearTimeout(timerId))
      }
      aspectClickTimersRef.current[key] = []

      const targetOpacity = Math.max(0, Math.min(MAX_ASPECT_LINE_OPACITY, options?.targetOpacity ?? MAX_ASPECT_LINE_OPACITY))
      const transitionMs = Math.max(0, options?.transitionMs ?? 0)
      setChartAspectsTransitionMs(transitionMs)

      if (!showDynAspects) {
        setActivePlanetAspectsMap((prevMap) => {
          const updated = { ...prevMap }
          delete updated[key]
          return updated
        })
        return
      }

      const aspectsForPlanet = getAspectsForPlanet(planetName)
      if (aspectsForPlanet.length === 0) {
        setActivePlanetAspectsMap((prevMap) => {
          const updated = { ...prevMap }
          delete updated[key]
          return updated
        })
        return
      }

      setActivePlanetAspectsMap((prevMap) => ({
        ...prevMap,
        [key]: {
          aspects: aspectsForPlanet,
          opacity: targetOpacity,
        },
      }))
    },
    [getAspectsForPlanet, showDynAspects],
  )

  const triggerPlanetGlyphScale = (_planetName: string, _aspectsForPlanet: any[]) => {
    // Dynamic glyph scaling disabled by request.
    return
  }

  const handlePlanetMouseDown = (planetName: string, degrees: number) => {
    setHoveredGlyph(planetName)
    setPressedGlyph(planetName)
    setGlyphHoverOpacity(0)
    triggerPlanetGlyphScale(planetName, getAspectsForPlanet(planetName))
    triggerInteractivePlanetPreview(planetName, degrees)

    if (pressedGlyphReleaseTimeoutRef.current) {
      clearTimeout(pressedGlyphReleaseTimeoutRef.current)
    }
    pressedGlyphReleaseTimeoutRef.current = setTimeout(() => {
      setPressedGlyph((current) => (current === planetName ? null : current))
      clearInteractivePlanetPreview(true)
      pressedGlyphReleaseTimeoutRef.current = null
    }, GLYPH_INTERACTION_FADE_IN_MS + 800)
  }

  const isPlanetUnderPointer = (planetDegrees: number, pointerAngle: number): boolean => {
    if (!showPointer || !isLoopRunning) return false

    // Calculate the difference in angles, considering circular nature
    let angleDiff = Math.abs(planetDegrees - pointerAngle)
    angleDiff = Math.min(angleDiff, 360 - angleDiff)

    // Check if planet is within ±5 degrees of pointer
    return angleDiff <= 5
  }

  // Planet detection is handled inside the active navigation scheduler.

  if (showLoadingIntroScreen) {
    const isFirstIntroParagraph = loadingIntroIndex <= 0
    const isLastIntroParagraph = loadingIntroIndex >= loadingIntroParagraphs.length - 1

    return (
      <main
        className={`min-h-screen bg-black text-white flex items-start justify-center p-4 pt-8 md:pt-10 relative ${
          isThemeMotionActive ? "astro-phosphor-shell astro-phosphor-shell--active" : ""
        }`}
        style={phosphorShellStyleWithFocus}
        data-phosphor-theme={themeMotionDataAttr}
      >
        {themeMotionOverlays}
        <div className="relative z-10 w-full max-w-3xl astro-phosphor-content" style={contentToneStyle}>
          <div className="mb-8 min-h-[420px]">
            <div className="relative w-full text-center pt-1">
              <h1 className="font-mono text-xl md:text-4xl uppercase tracking-widest text-center">
                ASTRO.LOG.IO
              </h1>
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                {languageToggleInline}
              </div>
              <div className="mt-2 h-[3px] w-full bg-white/20">
                <div
                  className="h-full bg-white"
                  style={{
                    width: `${loadingDisplayProgress}%`,
                    transition: "width 0.05s linear",
                  }}
                ></div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end text-[8px] uppercase tracking-[0.25em] text-white/50">
              <span>{Math.round(loadingDisplayProgress)}%</span>
            </div>

            <div className="mt-5 relative min-h-[500px] md:min-h-[560px] overflow-visible">
              <div className="mx-auto max-w-[980px] px-2 pt-10 pb-8 flex flex-col items-start gap-7">
                <p
                  key={`loading-current-${loadingIntroTick}-${loadingIntroIndex}`}
                  onClick={advanceLoadingIntroParagraph}
                  className="loading-intro-fade-in font-mono cursor-pointer text-[10px] md:text-[26px] leading-[1.36]"
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    textAlign: "left",
                    whiteSpace: "pre-line",
                  }}
                >
                  {loadingIntroParagraphs[loadingIntroIndex] ?? ""}
                </p>
                <div className="mt-8 w-full flex items-center justify-between">
                  <button
                    onClick={retreatLoadingIntroParagraph}
                    disabled={isFirstIntroParagraph}
                    className={`font-mono text-[21px] md:text-[36px] leading-none transition-colors px-2 py-1 ${
                      isFirstIntroParagraph
                        ? "text-white/30 cursor-not-allowed"
                        : "text-white/50 hover:text-white"
                    }`}
                  >
                    {"<"}
                  </button>
                  <button
                    onClick={advanceLoadingIntroParagraph}
                    className="play-idle-pulse font-mono text-[21px] md:text-[36px] leading-none text-white/50 hover:text-white transition-colors px-2 py-1"
                  >
                    {isLastIntroParagraph ? ">" : ">"}
                  </button>
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-[190px] flex items-center justify-between px-1 md:bottom-3 md:px-0">
                <span className="font-mono text-[10px] md:text-[12px] uppercase tracking-[0.2em] text-white/55 px-2 py-1">
                  {BUILD_MARK}
                </span>
                <button
                  type="button"
                  onClick={skipLoadingIntro}
                  className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.2em] text-white/55 hover:text-white transition-colors px-2 py-1"
                >
                  SKIP
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main
      className={`relative min-h-screen overflow-x-hidden bg-black p-2 text-white md:p-6 ${
        isThemeMotionActive ? "astro-phosphor-shell astro-phosphor-shell--active" : ""
      }`}
      style={phosphorShellStyleWithFocus}
      data-phosphor-theme={themeMotionDataAttr}
    >
      {themeMotionOverlays}
      {isPreparingPlaybackAudio && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-1/2 z-[80] w-[min(70vw,420px)] -translate-x-1/2 -translate-y-1/2"
          style={contentToneStyle}
        >
          <div className="playback-preparing-line" />
        </div>
      )}
      <div
        className={`relative z-10 mx-auto max-w-[1400px] astro-phosphor-content ${chartScreenPaddingClassName}`}
        style={contentToneStyle}
      >
        <div className={`${playbackUiShellClassName} relative mb-1 pb-1 border-b border-white flex items-end justify-center gap-3 min-h-[34px] md:min-h-[52px]`}>
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            {languageToggleInline}
          </div>
          <div ref={menuPanelAnchorRef} className="absolute left-0 bottom-full mb-[5px]" aria-hidden="true">
            {menuOpen && menuPanelPosition && typeof document !== "undefined"
              ? createPortal(
                  <div
                    ref={menuPanelRef}
                    className={`${playbackUiShellClassName} crt-panel fixed z-[70] w-[min(92vw,540px)] md:w-[560px] px-5 py-5 max-h-[72vh] overflow-y-auto`}
                    style={{
                      bottom: menuPanelPosition.bottom,
                      left: menuPanelPosition.left,
                    }}
                  >
                <div className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-white/88">
                  <span>{ui.menu}</span>
                  <span>
                    {ui.advanced} {advancedMenuEnabled ? ui.on : ui.off} [O]
                  </span>
                </div>

                <div className={advancedMenuEnabled ? "hidden" : "space-y-2"}>
                  <div className="grid grid-cols-3 gap-1">
                    <label className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.12em] cursor-pointer border border-white/60 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={showSignsRing}
                        onChange={(e) => setShowSignsRing(e.target.checked)}
                        className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                      />
                      {ui.signs}
                    </label>
                    <label className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.12em] cursor-pointer border border-white/60 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={showHousesRing}
                        onChange={(e) => setShowHousesRing(e.target.checked)}
                        className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                      />
                      {ui.houses}
                    </label>
                    <label className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.12em] cursor-pointer border border-white/60 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={showAngles}
                        onChange={(e) => setShowAngles(e.target.checked)}
                        className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                      />
                      MC
                    </label>
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="flex items-center gap-2">
                    <label className="font-mono text-[11px] uppercase tracking-[0.14em] w-24 flex-shrink-0">
                      ASPECT SOUND
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={aspectsSoundVolume}
                      onChange={(e) => setAspectsSoundVolume(Number(e.target.value))}
                      className="menu-slider flex-1 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      aria-label="Aspect sound mix"
                    />
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="space-y-1">
                    <div className="font-mono text-[13px] uppercase tracking-[0.14em]">{ui.interface}</div>
                    <div className="grid grid-cols-1 gap-1">
                      {interfaceThemeOptions.map((option) => (
                        <button
                          key={`minimal-interface-${option.value}`}
                          onClick={() => setInterfaceTheme(option.value)}
                          className="font-mono text-[12px] border px-2 py-1.5 transition-opacity hover:opacity-100"
                          style={{
                            color:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeText
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].text,
                            borderColor:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeBorder
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].border,
                            backgroundColor:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeBg
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].hover,
                            boxShadow:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeShadow
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].shadow,
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={advancedMenuEnabled ? "space-y-1 scale-[1.18] origin-top-left pr-6 pb-6" : "hidden"}>
                  <button
                    onClick={() => {
                      setShowSubject(false)
                      setShowPlanets(false)
                      setShowChart(false)
                      setShowMatrix(false)
                      setShowCircle(false)
                      setShowDegrees(false)
                      setShowAngles(false)
                      setShowAstroChart(false)
                      setShowAspects(false)
                    }}
                    className="w-full text-left font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400 border border-white px-2 py-1 hover:bg-white hover:text-black transition-colors"
                  >
                    {ui.minimal}
                  </button>
                  <div className="border-t border-gray-600 my-1"></div>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showSubject}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setShowSubject(checked)
                        if (checked) {
                          setMenuOpen(false)
                        }
                      }}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.dataInput}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showPlanets}
                      onChange={(e) => setShowPlanets(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.planets}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showAspects}
                      onChange={(e) => setShowAspects(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.aspects}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showDynAspects}
                      onChange={(e) => {
                        setShowDynAspects(e.target.checked)
                        if (!e.target.checked) setDynAspectsOpacity(0)
                      }}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.dynAspects}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showChart}
                      onChange={(e) => setShowChart(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.chart}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showMatrix}
                      onChange={(e) => setShowMatrix(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.matrix}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showCircle}
                      onChange={(e) => setShowCircle(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.circle}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showSignsRing}
                      onChange={(e) => setShowSignsRing(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.signsRing}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showHousesRing}
                      onChange={(e) => setShowHousesRing(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.housesRing}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showDegrees}
                      onChange={(e) => setShowDegrees(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.degrees}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showAngles}
                      onChange={(e) => setShowAngles(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    MC
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showAstroChart}
                      onChange={(e) => setShowAstroChart(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.astroChart}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showPointerInfo}
                      onChange={(e) => setShowPointerInfo(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.pointerInfo}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[8.4px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showAspectIndicator}
                      onChange={(e) => setShowAspectIndicator(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.aspectBox}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[8.4px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={modalEnabled}
                      onChange={(e) => setModalEnabled(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.mode}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[8.4px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showVuMeter}
                      onChange={(e) => setShowVuMeter(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.vu}
                  </label>
                  <label className="flex items-center gap-2 font-mono text-[8.4px] uppercase tracking-wide cursor-pointer hover:text-gray-400">
                    <input
                      type="checkbox"
                      checked={showModeInfo}
                      onChange={(e) => setShowModeInfo(e.target.checked)}
                      className="w-3 h-3 appearance-none border border-white checked:bg-white checked:border-white cursor-pointer"
                    />
                    {ui.modeInfo}
                  </label>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="space-y-1">
                    <div className="font-mono text-[8.4px] uppercase tracking-wide">{ui.interface}</div>
                    <div className="grid grid-cols-1 gap-1">
                      {interfaceThemeOptions.map((option) => (
                        <button
                          key={`advanced-interface-${option.value}`}
                          onClick={() => setInterfaceTheme(option.value)}
                          className="font-mono text-[8.5px] border px-1.5 py-1 transition-opacity hover:opacity-100"
                          style={{
                            color:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeText
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].text,
                            borderColor:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeBorder
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].border,
                            backgroundColor:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeBg
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].hover,
                            boxShadow:
                              interfaceTheme === option.value
                                ? INTERFACE_THEME_SWATCH_BY_THEME[option.value].activeShadow
                                : INTERFACE_THEME_SWATCH_BY_THEME[option.value].shadow,
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="space-y-1">
                    <div className="font-mono text-[7.5px] uppercase tracking-wide">{ui.navigation}</div>
                    <div className="grid grid-cols-2 gap-1">
                      {NAVIGATION_MODES.map((mode) => (
                        <button
                          key={mode}
                          title={navModeInstructionByMode[mode]}
                          onClick={() => setNavigationModeFromMenu(mode)}
                          className={`font-mono text-[7px] uppercase tracking-wide border px-1 py-0.5 transition-colors ${
                            navigationMode === mode
                              ? "bg-white text-black border-white"
                              : "bg-transparent text-white border-gray-600 hover:border-white"
                          }`}
                        >
                          {navModeHintLabel[mode]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={resetToInitialState}
                      className="w-full font-mono text-[7px] uppercase tracking-wide border border-white px-2 py-1 hover:bg-white hover:text-black transition-colors"
                    >
                      {ui.reset}
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        openInfoOverlay()
                      }}
                      className="w-full font-mono text-[7px] uppercase tracking-wide border border-white px-2 py-1 hover:bg-white hover:text-black transition-colors"
                    >
                      {ui.info}
                    </button>
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  {/* LOOP Duration Control */}
                  <div className="flex items-center gap-1 py-1 px-2">
                    <div className="font-mono text-[7.5px] uppercase tracking-wide whitespace-nowrap">{ui.loop}</div>
                    <button
                      onClick={() => setLoopDuration(Math.max(60, loopDuration - 5))}
                      className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-[6.5px]"
                    >
                      −
                    </button>
                    <span className="text-[7.5px] w-8 text-center">{loopDuration}s</span>
                    <button
                      onClick={() => setLoopDuration(Math.min(300, loopDuration + 5))}
                      className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 text-[6.5px]"
                    >
                      +
                    </button>
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="space-y-1">
                    <div className="font-mono text-[7.5px] uppercase tracking-wide">{ui.audioEnvelope}</div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[9px] uppercase tracking-wide w-16 flex-shrink-0">{ui.engine}</label>
                      <div className="relative w-36">
                        <select
                          value={audioEngineMode}
                          onChange={(e) => setAudioEngineMode(e.target.value as AudioEngineMode)}
                          className="w-full crt-select text-[9px] px-1.5 py-1 uppercase tracking-wide"
                        >
                          {engineOptions.map((option) => (
                            <option key={`advanced-engine-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white/80 text-[8px]">▾</span>
                      </div>
                      <span className="font-mono text-[8px] w-8 text-right uppercase">{ui.mode}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">{ui.fadeIn}</label>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={audioFadeIn}
                        onChange={(e) => setAudioFadeIn(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-6 text-right">{audioFadeIn}s</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.fadeOut}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={audioFadeOut}
                        onChange={(e) => setAudioFadeOut(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-6 text-right">{audioFadeOut}s</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">{ui.bgVol}</label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={backgroundVolume}
                        onChange={(e) => setBackgroundVolume(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{backgroundVolume}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.element}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={elementSoundVolume}
                        onChange={(e) => setElementSoundVolume(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{elementSoundVolume}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.aspectVol}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={aspectsSoundVolume}
                        onChange={(e) => setAspectsSoundVolume(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{aspectsSoundVolume}%</span>
                    </div>

                    {/* MASTER VOLUME CONTROL */}
                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.masterVol}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={masterVolume}
                        onChange={(e) => setMasterVolume(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{masterVolume}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.reverb}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={reverbMixPercent}
                        onChange={(e) => setReverbMixPercent(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{reverbMixPercent}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.chordReverb}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={chordReverbMixPercent}
                        onChange={(e) => setChordReverbMixPercent(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{chordReverbMixPercent}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.synthVol}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="600"
                        value={synthVolume}
                        onChange={(e) => setSynthVolume(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-8 text-right">{synthVolume}%</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.tuning}
                      </label>
                      <input
                        type="range"
                        min="-1200"
                        max="1200"
                        step="100"
                        value={tuningCents}
                        onChange={(e) => setTuningCents(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-12 text-right">
                        {tuningCents / 100} st
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-gray-600 my-1"></div>

                  <div className="space-y-1">
                    <div className="font-mono text-[7.5px] uppercase tracking-wide">{ui.dynamicAspects}</div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">{ui.fadeIn}</label>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={dynAspectsFadeIn}
                        onChange={(e) => setDynAspectsFadeIn(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-6 text-right">{dynAspectsFadeIn}s</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">{ui.sustain}</label>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={dynAspectsSustain}
                        onChange={(e) => setDynAspectsSustain(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-6 text-right">{dynAspectsSustain}s</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <label className="font-mono text-[7.5px] uppercase tracking-wide w-12 flex-shrink-0">
                        {ui.fadeOut}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="15"
                        value={dynAspectsFadeOut}
                        onChange={(e) => setDynAspectsFadeOut(Number(e.target.value))}
                        className="menu-slider flex-none w-32 h-[2px] bg-white rounded cursor-pointer appearance-none"
                      />
                      <span className="font-mono text-[7.5px] w-6 text-right">{dynAspectsFadeOut}s</span>
                    </div>
                  </div>

                  {showVuMeter && (
                    <div className="space-y-1">
                    <div className="font-mono text-[7.5px] uppercase tracking-wide">{ui.vuMeter}</div>
                    <div className="border border-white/50 bg-black p-1 space-y-1">
                      <div className="flex items-center justify-between text-[6.5px] font-mono uppercase tracking-wide">
                        <span>{ui.pre}</span>
                        <span>
                          L {percentToDb(peakLevelLeftPre).toFixed(1)} dB / R {percentToDb(peakLevelRightPre).toFixed(1)} dB
                        </span>
                      </div>
                      <div className="relative h-2 border-b border-white/20 overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-75"
                          style={{ width: `${audioLevelLeftPre}%` }}
                        />
                        {peakLevelLeftPre > 0 && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-white/60"
                            style={{ left: `${peakLevelLeftPre}%` }}
                          />
                        )}
                      </div>
                      <div className="relative h-2 overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-75"
                          style={{ width: `${audioLevelRightPre}%` }}
                        />
                        {peakLevelRightPre > 0 && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-white/60"
                            style={{ left: `${peakLevelRightPre}%` }}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[6.5px] font-mono uppercase tracking-wide pt-1">
                        <span>{ui.post}</span>
                        <span>
                          L {percentToDb(peakLevelLeftPost).toFixed(1)} dB / R {percentToDb(peakLevelRightPost).toFixed(1)} dB
                        </span>
                      </div>
                      <div className="relative h-2 border-b border-white/20 overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-75"
                          style={{ width: `${audioLevelLeftPost}%` }}
                        />
                        {peakLevelLeftPost > 0 && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-white/60"
                            style={{ left: `${peakLevelLeftPost}%` }}
                          />
                        )}
                      </div>
                      <div className="relative h-2 overflow-hidden">
                        <div
                          className="h-full bg-white transition-all duration-75"
                          style={{ width: `${audioLevelRightPost}%` }}
                        />
                        {peakLevelRightPost > 0 && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-white/60"
                            style={{ left: `${peakLevelRightPost}%` }}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[6.5px] font-mono uppercase tracking-wide pt-1">
                        <span>{ui.comp}</span>
                        <span>{compressionReductionDb.toFixed(1)} dB</span>
                      </div>
                      <div className="relative h-2 overflow-hidden border-t border-white/20">
                        <div
                          className="h-full bg-white/70 transition-all duration-75"
                          style={{ width: `${Math.min(100, Math.max(0, (compressionReductionDb / 24) * 100))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  )}
                </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <h1
            className={`${playbackUiShellClassName} font-mono text-[17px] md:text-[31px] uppercase tracking-[0.2em] text-white text-center whitespace-nowrap`}
          >
            ASTRO.LOG.IO
          </h1>
          {horoscopeData && !showSubject && (
            <div className={`${playbackUiShellClassName} fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+96px)] z-30 shrink-0 md:absolute md:right-0 md:bottom-0 md:z-auto`}>
              <div
                className={`border px-2 py-1 md:px-2.5 md:py-1.5 text-right font-mono text-[8px] md:text-[11px] uppercase tracking-[0.08em] md:tracking-wide leading-tight transition-all duration-200 ${
                  isSubjectBoxHovered ? "border-white bg-white text-black" : "border-white/70 bg-black/75 text-white/80"
                }`}
                style={{
                  touchAction: "manipulation",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTapHighlightColor: "transparent",
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === "touch") {
                    event.preventDefault()
                    event.stopPropagation()
                  }
                }}
                onPointerEnter={() => setIsSubjectBoxHovered(true)}
                onPointerLeave={() => setIsSubjectBoxHovered(false)}
                onTouchStart={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (subjectHoverTouchTimeoutRef.current) {
                    clearTimeout(subjectHoverTouchTimeoutRef.current)
                    subjectHoverTouchTimeoutRef.current = null
                  }
                  setIsSubjectBoxHovered(true)
                  subjectHoverTouchTimeoutRef.current = setTimeout(() => {
                    setIsSubjectBoxHovered(false)
                    subjectHoverTouchTimeoutRef.current = null
                  }, TOP_PANEL_HINT_MS)
                }}
                onTouchCancel={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (subjectHoverTouchTimeoutRef.current) {
                    clearTimeout(subjectHoverTouchTimeoutRef.current)
                    subjectHoverTouchTimeoutRef.current = null
                  }
                  setIsSubjectBoxHovered(false)
                }}
              >
                <div>
                  {formData.datetime ? new Date(formData.datetime).toLocaleDateString(localeCode) : ui.noDate}
                  {" "}
                  {formData.datetime
                    ? new Date(formData.datetime).toLocaleTimeString(localeCode, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ui.noTime}
                </div>
                <div>{subjectLocationLines.city}, {subjectLocationLines.country}</div>
              </div>
            </div>
          )}
        </div>

        {showSubject && (
          <div className={`${playbackUiShellClassName} crt-panel space-y-2 md:space-y-3 px-3 py-3 md:px-5 md:py-4`}>
            {isFetchingHereNow && (
              <div className="flex flex-col items-center justify-center py-6 md:py-8 gap-3">
                <div className="crt-loader text-white">
                  <div className="crt-loader__ring crt-loader__ring--outer" />
                  <div className="crt-loader__ring crt-loader__ring--mid" />
                  <div className="crt-loader__ring crt-loader__ring--inner" />
                  <div className="crt-loader__dot" />
                </div>
                <div className="crt-loader__label font-mono text-[10px] md:text-[14px] uppercase tracking-[0.25em] text-white/80">
                  {language === "es" ? "ESPERANDO DATOS..." : "WAITING DATA INPUT..."}
                </div>
              </div>
            )}
            <div className="mb-1.5 grid grid-cols-2 gap-1 md:mb-2 md:gap-1.5">
              <button
                onClick={() => {
                  void applyHereAndNow()
                }}
                className={`w-full px-2.5 py-1.5 text-[10px] leading-tight md:px-5 md:py-2 md:text-[18px] font-mono font-bold border transition-colors ${
                  selectedPreset === "here_now"
                    ? "bg-white text-black border-white"
                    : "bg-transparent text-white border-gray-600 hover:border-white"
                }`}
              >
                {ui.hereNow}
              </button>
              <button
                onClick={setManualMode}
                className={`w-full px-2.5 py-1.5 text-[10px] leading-tight md:px-5 md:py-2 md:text-[18px] font-mono font-bold border transition-colors ${
                  selectedPreset === "manual"
                    ? "bg-white text-black border-white"
                    : "bg-transparent text-white border-gray-600 hover:border-white"
                }`}
              >
                {ui.dateTimePlaceInput}
              </button>
            </div>

            {(selectedPreset === "manual" || selectedPreset === "here_now") && (
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-3">
                <div>
                  <label className="mb-0.5 block font-mono text-[10px] text-gray-300 md:mb-1 md:text-[18px]">
                    {ui.dateTime}
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.datetime}
                    onChange={(e) => setFormData({ ...formData, datetime: e.target.value })}
                    className="w-full crt-input p-1.5 text-[12px] md:p-2 md:text-[20px]"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block font-mono text-[10px] text-gray-300 md:mb-1 md:text-[18px]">
                    {ui.location}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      onBlur={() => {
                        if (formData.location.trim()) {
                          void resolveLocationAndUpdateCoords(formData.location)
                        }
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === "Tab") && formData.location.trim()) {
                          void resolveLocationAndUpdateCoords(formData.location)
                        }
                      }}
                      className="w-full crt-input p-1.5 text-[12px] md:p-2 md:text-[20px]"
                      placeholder={ui.cityCountryPlaceholder}
                    />
                    {locationSuggestions.length > 0 && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-full border border-gray-500 bg-black max-h-44 overflow-y-auto">
                        {locationSuggestions.map((suggestion, index) => (
                          <button
                            key={`${suggestion.display}-${index}`}
                            type="button"
                            className="w-full text-left border-b border-gray-700 px-2 py-1.5 text-[10px] md:text-[15px] font-mono text-white hover:bg-white hover:text-black transition-colors last:border-b-0"
                            onClick={() => {
                              setFormData((prev) => ({
                                ...prev,
                                location: suggestion.display,
                                latitude: suggestion.latitude.toFixed(4),
                                longitude: suggestion.longitude.toFixed(4),
                              }))
                              setLocationSuggestions([])
                            }}
                          >
                            {suggestion.display}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {isResolvingLocation && (
                    <div className="mt-1 text-[9px] md:text-[12px] font-mono text-white/70">{ui.resolvingLocation}</div>
                  )}
                </div>
                <div>
                  <label className="mb-0.5 block font-mono text-[10px] text-gray-300 md:mb-1 md:text-[18px]">
                    {ui.latitude}
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    className="w-full crt-input p-1.5 text-[12px] md:p-2 md:text-[20px]"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block font-mono text-[10px] text-gray-300 md:mb-1 md:text-[18px]">
                    {ui.longitude}
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    className="w-full crt-input p-1.5 text-[12px] md:p-2 md:text-[20px]"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-1.5 md:mt-8 md:grid-cols-3 md:gap-2">
              {TOP_PANEL_MODE_ORDER.map((mode) => {
                const modeHoverKey = `subject-mode:${mode}`
                const playHoverKey = `subject-play:${mode}`
                const downloadHoverKey = `subject-download:${mode}`
                const isHovered =
                  topPanelHoverKey === modeHoverKey ||
                  topPanelHoverKey === playHoverKey ||
                  topPanelHoverKey === downloadHoverKey
                const tooltipText =
                  topPanelHoverKey === playHoverKey
                    ? navModeActionLabel[mode]
                    : topPanelHoverKey === downloadHoverKey
                      ? TOP_PANEL_DOWNLOAD_TOOLTIP_TEXT
                      : topPanelHoverKey === modeHoverKey
                        ? navModeInstructionByMode[mode]
                        : null

                return (
                  <div key={`subject-launch-${mode}`} className="relative">
                    <div
                      className={`relative flex h-[38px] md:h-[42px] overflow-hidden border transition-colors ${
                        isHovered ? "border-white bg-white/20 text-white" : "border-white/50 bg-transparent text-white/60"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          showTopPanelHint(playHoverKey)
                          void launchModeFromSubject(mode)
                        }}
                        onMouseEnter={() => showTopPanelHint(playHoverKey)}
                        onFocus={() => showTopPanelHint(playHoverKey)}
                        className="flex h-full w-[24%] min-w-[28px] items-center justify-center border-r border-white/30 transition-colors hover:bg-white/12"
                        title={navModeActionLabel[mode]}
                      >
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M6 4 L16 10 L6 16 Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          showTopPanelHint(modeHoverKey)
                          void launchModeFromSubject(mode)
                        }}
                        onMouseEnter={() => showTopPanelHint(modeHoverKey)}
                        onFocus={() => showTopPanelHint(modeHoverKey)}
                        className="flex-1 px-1.5 md:px-2 font-mono font-bold text-[9px] md:text-[12px] leading-none uppercase tracking-[0.1em] md:tracking-[0.12em] transition-colors hover:bg-white/12"
                      >
                        {navModeHintLabel[mode]}
                      </button>
                      <button
                        type="button"
                        disabled
                        onMouseEnter={() => showTopPanelHint(downloadHoverKey)}
                        onFocus={() => showTopPanelHint(downloadHoverKey)}
                        className="flex h-full w-[24%] min-w-[28px] items-center justify-center border-l border-white/20 text-white/20 cursor-not-allowed"
                        title={TOP_PANEL_DOWNLOAD_TOOLTIP_TEXT}
                      >
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
                          <path d="M3 8.8V12.4H13V8.8" />
                          <path d="M8 2.8V9.1" />
                          <path d="M5.9 7L8 9.1L10.1 7" />
                        </svg>
                      </button>
                      <span
                        className={`pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-[160px] z-[60] inline-block w-fit max-w-[calc(100vw-20px)] whitespace-normal md:whitespace-nowrap crt-tooltip px-1.5 md:px-3 py-1.5 md:py-2 text-left font-mono text-[7px] md:text-[16px] normal-case leading-tight text-white transition-opacity duration-500 ${
                          tooltipText ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        {tooltipText || ""}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {horoscopeData && (
          <div className="space-y-2 md:space-y-3">
            {showChart && (
              <div className="mt-4 md:mt-0 mb-0 md:mb-1 flex justify-center md:[transform:translateY(-4px)]">
                <div className="relative w-full max-w-[324px] aspect-square md:w-[min(74vh,86vw)] md:h-[min(74vh,86vw)] md:max-w-none md:aspect-auto">
                  <svg ref={chartSvgRef} viewBox="0 0 400 400" className="w-full h-full scale-90 origin-center">
                    <defs>
                      <filter id="glyph-halo-only" x="-200%" y="-200%" width="400%" height="400%">
                        <feGaussianBlur in="SourceAlpha" stdDeviation="1.8" result="halo-blur" />
                        <feComposite in="halo-blur" in2="SourceAlpha" operator="out" result="halo-shell" />
                        <feFlood floodColor="#ffffff" floodOpacity="1" result="halo-color" />
                        <feComposite in="halo-color" in2="halo-shell" operator="in" result="halo-only" />
                        <feMerge>
                          <feMergeNode in="halo-only" />
                        </feMerge>
                      </filter>
                    </defs>

                    {showCircle && (
                      <g style={chartAddonPassiveGlowStyle}>
                        <circle cx="200" cy="200" r="180" fill="none" stroke="white" strokeWidth="1" opacity="0.2" />
                      </g>
                    )}

                    {showMatrix && (
                      <g style={chartAddonPassiveGlowStyle}>
                        <line x1="200" y1="20" x2="200" y2="380" stroke="white" strokeWidth="1" opacity="0.15" />
                        <line x1="20" y1="200" x2="380" y2="200" stroke="white" strokeWidth="1" opacity="0.15" />

                        <text
                          x="200"
                          y="12"
                          textAnchor="middle"
                          className="fill-white font-mono text-[8px]"
                          opacity="0.5"
                        >
                          180°
                        </text>
                        <text
                          x="200"
                          y="395"
                          textAnchor="middle"
                          className="fill-white font-mono text-[8px]"
                          opacity="0.5"
                        >
                          0°
                        </text>
                        <text
                          x="8"
                          y="204"
                          textAnchor="start"
                          className="fill-white font-mono text-[8px]"
                          opacity="0.5"
                        >
                          270°
                        </text>
                        <text
                          x="392"
                          y="204"
                          textAnchor="end"
                          className="fill-white font-mono text-[8px]"
                          opacity="0.5"
                        >
                          90°
                        </text>
                      </g>
                    )}

                    {showSignsRing && (
                      <g style={chartAddonPassiveGlowStyle}>
                        <circle cx="200" cy="200" r="146" fill="none" stroke="white" strokeWidth="1" opacity="0.3" />
                        {zodiacRingItems.map((sign, index) => {
                          const signPosition = polarToCartesian(200, 200, 160, adjustToCanvasAngle(sign.centerDegrees))
                          const signGlyphSrc = ZODIAC_GLYPH_SVGS[sign.signKey]
                          return (
                            <g key={`sign-ring-${sign.signKey}-${index}`} style={{ pointerEvents: "none" }}>
                              {signGlyphSrc ? (
                                <image
                                  href={signGlyphSrc}
                                  x={signPosition.x - 7}
                                  y={signPosition.y - 7}
                                  width={14}
                                  height={14}
                                  preserveAspectRatio="xMidYMid meet"
                                  opacity={0.3}
                                />
                              ) : (
                                <text
                                  x={signPosition.x}
                                  y={signPosition.y}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  className="fill-white text-[7px]"
                                  style={{ opacity: 0.3, fontFamily: MONOTYPE_FONT_STACK }}
                                >
                                  {getLocalizedSignLabel(sign.label, language).slice(0, 3).toUpperCase()}
                                </text>
                              )}
                            </g>
                          )
                        })}
                      </g>
                    )}

                    {showHousesRing && (
                      <g style={chartAddonPassiveGlowStyle}>
                        <circle cx="200" cy="200" r="114" fill="none" stroke="white" strokeWidth="1" opacity="0.3" />
                        {houseRingItems.map((house) => {
                          const cuspStart = polarToCartesian(200, 200, 124, adjustToCanvasAngle(house.startDegrees))
                          const cuspEnd = polarToCartesian(200, 200, 100, adjustToCanvasAngle(house.startDegrees))
                          const houseLabelPos = polarToCartesian(200, 200, 128, adjustToCanvasAngle(house.centerDegrees))

                          return (
                            <g key={`house-ring-${house.id}`} style={{ pointerEvents: "none" }}>
                              <line
                                x1={cuspStart.x}
                                y1={cuspStart.y}
                                x2={cuspEnd.x}
                                y2={cuspEnd.y}
                                stroke="white"
                                strokeWidth="0.75"
                                opacity="0.3"
                              />
                              <text
                                x={houseLabelPos.x}
                                y={houseLabelPos.y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className="fill-white text-[8px]"
                                style={{ opacity: 0.3, fontFamily: MONOTYPE_FONT_STACK }}
                              >
                                {house.id}
                              </text>
                            </g>
                          )
                        })}
                      </g>
                    )}

                    {horoscopeData.planets.map((planet) => {
                      const originalDegrees = planet.ChartPosition.Ecliptic.DecimalDegrees
                      const adjustedDegrees = adjustedPositions[planet.name] ?? originalDegrees
                      const position = polarToCartesian(200, 200, 180, adjustToCanvasAngle(adjustedDegrees))
                      const glyphSrc = PLANET_GLYPH_SVGS[planet.name]
                      const glyphFallback =
                        PLANET_GLYPH_FALLBACK_LABELS[planet.name] || getLocalizedPlanetLabel(planet.name || planet.label, language)
                      // Added hover detection for glyphs
                      const isHovered = hoveredGlyph === planet.name
                      const isPressed = pressedGlyph === planet.name
                      const isPointerFocused = currentPlanetUnderPointer === planet.name
                      const isInteractionActive = isHovered || isPressed || isPointerFocused
                      const interactionScale = isInteractionActive ? GLYPH_INTERACTION_SCALE : 1
                      const pointerDrivenFadeInMs = Math.max(
                        320,
                        Math.round(pointerSynchronizedGlyphFadeMs * 0.85),
                      ) + GLYPH_INTERACTION_FADE_EXTRA_MS
                      const glyphFadeInMs = isPointerFocused ? pointerDrivenFadeInMs : GLYPH_INTERACTION_FADE_IN_MS
                      const glyphFadeOutMs = GLYPH_INTERACTION_FADE_OUT_MS
                      const glyphTransition = isInteractionActive
                        ? `transform ${glyphFadeInMs}ms ${GLYPH_INTERACTION_EASE_IN} 0ms, opacity ${glyphFadeInMs}ms ${GLYPH_INTERACTION_EASE_IN} 0ms`
                        : `transform ${glyphFadeOutMs}ms ${GLYPH_INTERACTION_EASE_OUT} ${GLYPH_INTERACTION_FADE_OUT_HOLD_MS}ms, opacity ${glyphFadeOutMs}ms ${GLYPH_INTERACTION_EASE_OUT} ${GLYPH_INTERACTION_FADE_OUT_HOLD_MS}ms`
                      const baseGlyphScale =
                        planet.name === "sun" ? 0.945 : planet.name === "mars" ? 0.69 : planet.name === "venus" ? 0.88 : 1
                      const glyphSize = 20 * baseGlyphScale
                      const glyphGlowTiming = getGlyphGlowTiming(planet.name)
                      const glyphTwinkleTiming = getThemeTwinkleTiming(`planet-${planet.name}`)
                      const glyphGlowAnimation = `planet-glyph-glow ${glyphGlowTiming.durationSec}s ease-in-out ${glyphGlowTiming.delaySec}s infinite alternate`
                      const themeGlyphPulseAnimation = themeMotionEnabled
                        ? `theme-star-pulse-subtle 5s ease-in-out infinite, subtle-star-glitch-30 ${glyphTwinkleTiming.durationSec}s steps(2, end) ${glyphTwinkleTiming.delaySec}s infinite`
                        : undefined
                      const glyphHaloFilter = isHovered ? chartGlyphHaloHoverFilter : chartGlyphHaloBaseFilter

                      return (
                        <g
                          key={planet.name}
                          data-export-planet-glyph="true"
                          style={{
                            cursor: "pointer",
                            transformBox: "fill-box",
                            transformOrigin: "center",
                            animation: themeGlyphPulseAnimation,
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            handlePlanetMouseDown(planet.name, originalDegrees)
                          }}
                          onPointerEnter={() => {
                            setHoveredGlyph(planet.name)
                            setGlyphHoverOpacity(0)
                            triggerPlanetGlyphScale(planet.name, getAspectsForPlanet(planet.name))
                          }}
                          onPointerLeave={() => {
                            setHoveredGlyph((current) => (current === planet.name ? null : current))
                            setGlyphHoverOpacity(0)
                            clearInteractivePlanetPreview(true)
                          }}
                        >
                          <circle
                            cx={position.x}
                            cy={position.y}
                            r={Math.max(12, glyphSize * 0.8)}
                            fill="transparent"
                            style={{ pointerEvents: "all" }}
                          />
                          {glyphSrc ? (
                            <>
                              <image
                                href={glyphSrc}
                                x={position.x - glyphSize / 2}
                                y={position.y - glyphSize / 2}
                                width={glyphSize}
                                height={glyphSize}
                                preserveAspectRatio="xMidYMid meet"
                                style={{
                                  pointerEvents: "none",
                                  filter: glyphHaloFilter,
                                  animation: glyphGlowAnimation,
                                  mixBlendMode: "screen",
                                  transformBox: "fill-box",
                                  transformOrigin: "center",
                                  transform: `scale(${interactionScale})`,
                                  opacity: isInteractionActive ? 0.94 : 0.86,
                                  transition: glyphTransition,
                                }}
                              />
                              <image
                                href={glyphSrc}
                                x={position.x - glyphSize / 2}
                                y={position.y - glyphSize / 2}
                                width={glyphSize}
                                height={glyphSize}
                                preserveAspectRatio="xMidYMid meet"
                                style={{
                                  pointerEvents: "none",
                                  filter: chartGlyphCoreFilter,
                                  transformBox: "fill-box",
                                  transformOrigin: "center",
                                  transform: `scale(${interactionScale})`,
                                  opacity: isInteractionActive ? 1 : 0.92,
                                  transition: glyphTransition,
                                }}
                              />
                            </>
                          ) : (
                            <>
                              <text
                                x={position.x}
                                y={position.y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className={`fill-white font-sans text-xl select-none ${
                                  currentPlanetUnderPointer === planet.name ? "fill-white" : ""
                                }`}
                                style={{
                                  transform: `scale(${baseGlyphScale * interactionScale})`,
                                  transformOrigin: `${position.x}px ${position.y}px`,
                                  opacity: isInteractionActive ? 0.94 : 0.86,
                                  transition: glyphTransition,
                                  filter: glyphHaloFilter,
                                  animation: glyphGlowAnimation,
                                }}
                              >
                                {glyphFallback}
                              </text>
                              <text
                                x={position.x}
                                y={position.y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                className={`fill-white font-sans text-xl select-none ${
                                  currentPlanetUnderPointer === planet.name ? "fill-white" : ""
                                }`}
                                style={{
                                  paintOrder: "stroke fill",
                                  stroke: "#ffffff",
                                  strokeWidth: "0.5px",
                                  transform: `scale(${baseGlyphScale * interactionScale})`,
                                  transformOrigin: `${position.x}px ${position.y}px`,
                                  opacity: isInteractionActive ? 1 : 0.92,
                                  transition: glyphTransition,
                                  filter: chartGlyphCoreFilter,
                                }}
                              >
                                {glyphFallback}
                              </text>
                            </>
                          )}
                          {showDegrees && (
                            <text
                              x={position.x}
                              y={position.y + 15}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              className="fill-white font-mono text-[6px] select-none"
                              style={{ filter: chartAnalogGlowFilter, mixBlendMode: "screen" }}
                            >
                              {originalDegrees.toFixed(1)}°
                            </text>
                          )}
                        </g>
                      )
                    })}

                    {showAngles &&
                      (horoscopeData.mc?.ChartPosition?.Ecliptic?.DecimalDegrees !== undefined ||
                        horoscopeData.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees !== undefined) && (
                        <>
                          {(() => {
                            const mcLong = horoscopeData.mc.ChartPosition?.Ecliptic?.DecimalDegrees
                            const ascLong = horoscopeData.ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees
                            if (mcLong === undefined && ascLong === undefined) return null

                            const mcTheta = mcLong !== undefined ? adjustToCanvasAngle(mcLong) : null
                            const ascTheta = ascLong !== undefined ? adjustToCanvasAngle(ascLong) : null

                            const mcInnerPos = mcTheta !== null ? polarToCartesian(200, 200, 50, mcTheta) : null
                            const mcOuterPos = mcTheta !== null ? polarToCartesian(200, 200, 190, mcTheta) : null
                            const mcLabelPos = mcTheta !== null ? polarToCartesian(200, 200, 194, mcTheta) : null

                            const horizonPosA = ascTheta !== null ? polarToCartesian(200, 200, 188, ascTheta) : null
                            const horizonPosB =
                              ascTheta !== null ? polarToCartesian(200, 200, 188, norm360(ascTheta + 180)) : null
                            const horizonLabelPos = ascTheta !== null ? polarToCartesian(200, 200, 194, ascTheta) : null

                            return (
                              <g style={chartAddonPassiveGlowStyle}>
                                {horizonPosA && horizonPosB && (
                                  <>
                                    <line
                                      x1={horizonPosA.x}
                                      y1={horizonPosA.y}
                                      x2={horizonPosB.x}
                                      y2={horizonPosB.y}
                                      stroke="white"
                                      strokeWidth="1.05"
                                      opacity="0.3"
                                    />
                                    {horizonLabelPos && (
                                      <text
                                        x={horizonLabelPos.x}
                                        y={horizonLabelPos.y}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fill="white"
                                        fontSize="8"
                                        style={{ fontFamily: MONOTYPE_FONT_STACK, opacity: 0.3 }}
                                      >
                                        HZ
                                      </text>
                                    )}
                                  </>
                                )}
                                {mcInnerPos && mcOuterPos && mcLabelPos && (
                                  <>
                                    <line
                                      x1={mcInnerPos.x}
                                      y1={mcInnerPos.y}
                                      x2={mcOuterPos.x}
                                      y2={mcOuterPos.y}
                                      stroke="white"
                                      strokeWidth="1.05"
                                      opacity="0.3"
                                    />
                                    <text
                                      x={mcLabelPos.x}
                                      y={mcLabelPos.y}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                      fill="white"
                                      fontSize="9"
                                      style={{ fontFamily: MONOTYPE_FONT_STACK, opacity: 0.3 }}
                                    >
                                      MC
                                    </text>
                                  </>
                                )}
                              </g>
                            )
                          })()}
                        </>
                      )}

                    {showAspectGraph &&
                      allChartAspectSegments.map((segment) => (
                        <g key={segment.key} data-export-static-aspects="true" style={chartAddonPassiveGlowStyle}>
                          <line
                            x1={segment.x1}
                            y1={segment.y1}
                            x2={segment.x2}
                            y2={segment.y2}
                            stroke={segment.stroke}
                            strokeWidth={segment.strokeWidth}
                            opacity={segment.opacity}
                          />
                        </g>
                      ))}

                    {showPointer && (
                      <>
                        {/* Loading ring around Earth glyph */}
                        {loadingProgress < 100 && (() => {
                          const ringR = EARTH_RADIUS + 5
                          const circ = 2 * Math.PI * ringR
                          const dashOffset = circ * (1 - loadingProgress / 100)
                          return (
                            <g style={{ pointerEvents: "none" }}>
                              <circle
                                cx={EARTH_CENTER_X}
                                cy={EARTH_CENTER_Y}
                                r={ringR}
                                className="crt-loading-ring-track"
                              />
                              <circle
                                cx={EARTH_CENTER_X}
                                cy={EARTH_CENTER_Y}
                                r={ringR}
                                className="crt-loading-ring-progress"
                                strokeDasharray={circ}
                                strokeDashoffset={dashOffset}
                                style={{ transform: `rotate(-90deg)`, transformOrigin: `${EARTH_CENTER_X}px ${EARTH_CENTER_Y}px` }}
                              />
                            </g>
                          )
                        })()}

                        {/* Earth center control (single mode trigger) */}
                        <g
                          style={{
                            animation: earthCenterThemePulseAnimation,
                            transformOrigin: `${EARTH_CENTER_X}px ${EARTH_CENTER_Y}px`,
                          }}
                        >
                          <circle
                            cx={EARTH_CENTER_X}
                            cy={EARTH_CENTER_Y}
                            r={EARTH_RADIUS}
                            fill="#0F0F0F"
                            opacity={isLoopRunning ? 1 : 0.92}
                            onPointerDown={handleEarthCenterPress}
                            style={{ cursor: "pointer" }}
                          />
                          <g
                            style={{
                              pointerEvents: "none",
                              filter: earthCenterGlyphHaloFilter,
                              animation: earthCenterGlyphGlowAnimation,
                              mixBlendMode: "screen",
                              opacity: isLoopRunning ? 0.94 : 0.86,
                            }}
                          >
                            <circle
                              cx={EARTH_CENTER_X}
                              cy={EARTH_CENTER_Y}
                              r={EARTH_RADIUS}
                              fill="none"
                              stroke="white"
                              strokeWidth="1.5"
                            />
                            <line
                              x1={EARTH_CENTER_X}
                              y1={EARTH_CENTER_Y - EARTH_RADIUS}
                              x2={EARTH_CENTER_X}
                              y2={EARTH_CENTER_Y + EARTH_RADIUS}
                              stroke="white"
                              strokeWidth="1.2"
                            />
                            <line
                              x1={EARTH_CENTER_X - EARTH_RADIUS}
                              y1={EARTH_CENTER_Y}
                              x2={EARTH_CENTER_X + EARTH_RADIUS}
                              y2={EARTH_CENTER_Y}
                              stroke="white"
                              strokeWidth="1.2"
                            />
                          </g>
                          <g
                            style={{
                              pointerEvents: "none",
                              filter: chartGlyphCoreFilter,
                              opacity: isLoopRunning ? 1 : 0.92,
                            }}
                          >
                            <circle
                              cx={EARTH_CENTER_X}
                              cy={EARTH_CENTER_Y}
                              r={EARTH_RADIUS}
                              fill="none"
                              stroke="white"
                              strokeWidth="1.5"
                            />
                            <line
                              x1={EARTH_CENTER_X}
                              y1={EARTH_CENTER_Y - EARTH_RADIUS}
                              x2={EARTH_CENTER_X}
                              y2={EARTH_CENTER_Y + EARTH_RADIUS}
                              stroke="white"
                              strokeWidth="1.2"
                            />
                            <line
                              x1={EARTH_CENTER_X - EARTH_RADIUS}
                              y1={EARTH_CENTER_Y}
                              x2={EARTH_CENTER_X + EARTH_RADIUS}
                              y2={EARTH_CENTER_Y}
                              stroke="white"
                              strokeWidth="1.2"
                            />
                          </g>
                        </g>

                        <g data-export-pointer="true" style={chartAddonPassiveGlowStyle}>
                          {/* Animated pointer - rotates clockwise from ASC (180°) */}
                          {shouldShowIdlePointer && (
                            <circle
                              cx="20"
                              cy="200"
                              r="14"
                              fill="white"
                              fillOpacity={ORBIT_POINTER_FILL_OPACITY}
                              stroke="white"
                              strokeWidth="1"
                              opacity="1"
                              style={{ pointerEvents: "none" }}
                            />
                          )}

                          {/* Update pointer visibility - only show when loop is running */}
                          {shouldShowChordCenterPointer && (
                            <circle
                              cx={EARTH_CENTER_X}
                              cy={EARTH_CENTER_Y}
                              r={CHORD_POINTER_RADIUS}
                              fill="white"
                              fillOpacity={CHORD_POINTER_FILL_OPACITY}
                              stroke="white"
                              strokeWidth="1.25"
                              opacity={pointerOpacity}
                              style={{
                                pointerEvents: "none",
                                transition:
                                  pointerOpacityTransitionMs > 0
                                    ? `opacity ${pointerOpacityTransitionMs}ms linear`
                                    : "none",
                              }}
                            />
                          )}

                          {shouldShowOrbitPointer && (
                            <g
                              style={{
                                transform: `rotate(${pointerRotation}deg)`,
                                transformOrigin: "200px 200px",
                                transition: "none",
                                opacity: navigationMode === "astral_chord" ? 0 : 1,
                              }}
                            >
                              <circle
                                cx="20"
                                cy="200"
                                r="14"
                                fill="white"
                                fillOpacity={ORBIT_POINTER_FILL_OPACITY}
                                stroke="white"
                                strokeWidth="1"
                                opacity={pointerOpacity}
                                style={{
                                  pointerEvents: "none",
                                  transition:
                                    pointerOpacityTransitionMs > 0
                                      ? `opacity ${pointerOpacityTransitionMs}ms linear`
                                      : "none",
                                }}
                              />
                            </g>
                          )}
                        </g>
                      </>
                    )}

                    {/* Dynamically display aspects when pointer is over a planet - LINES ALWAYS SHOWN */}
                    {Object.entries(activePlanetAspectsMap).length > 0 &&
                      Object.entries(activePlanetAspectsMap).map(([planetName, data]) =>
                        data.aspects.map((aspect, index) => {
                          // Get positions for both planets involved in the aspect
                          const getPointPosition = (pointName: string) => {
                            let degrees
                            if (pointName === "asc") {
                              degrees = horoscopeData.ascendant.ChartPosition.Ecliptic.DecimalDegrees
                            } else if (pointName === "mc") {
                              degrees = horoscopeData.mc.ChartPosition.Ecliptic.DecimalDegrees
                            } else {
                              const planet = horoscopeData.planets.find((p) => p.name === pointName)
                              if (planet) {
                                // Match the printed glyph position (adjusted), not raw ecliptic angle.
                                degrees = adjustedPositions[planet.name] ?? planet.ChartPosition.Ecliptic.DecimalDegrees
                              }
                            }
                            return degrees !== undefined
                              ? polarToCartesian(200, 200, 180, adjustToCanvasAngle(degrees))
                              : null
                          }

                          const pos1 = getPointPosition(aspect.point1.name)
                          const pos2 = getPointPosition(aspect.point2.name)

                          if (!pos1 || !pos2) return null
                          const trimmedSegment = trimLineSegment(pos1, pos2, 15, 15)
                          if (!trimmedSegment) return null

                          // Determine color; all aspect lines use 1px width.
                          const aspectColor = getMajorAspectStrokeColor(aspect.aspectType)
                          const aspectWidth = 1
                          let aspectOpacity = Math.min(data.opacity, MAX_ASPECT_LINE_OPACITY)

                          return (
                            <g key={`aspect-${planetName}-${index}`} data-export-dynamic-aspects="true" style={chartAddonPassiveGlowStyle}>
                              <line
                                x1={trimmedSegment.x1}
                                y1={trimmedSegment.y1}
                                x2={trimmedSegment.x2}
                                y2={trimmedSegment.y2}
                                stroke={aspectColor}
                                strokeWidth={aspectWidth}
                                style={{
                                  opacity: aspectOpacity,
                                  transition:
                                    planetName === "all"
                                      ? `opacity ${chordAspectsTransitionMs / 1000}s linear`
                                      : planetName === chartAspectsKeyRef.current
                                        ? `opacity ${chartAspectsTransitionMs / 1000}s linear`
                                      : "opacity 0.1s linear",
                                }}
                              />
                            </g>
                          )
                        }),
                      )}
                  </svg>
                </div>
              </div>
            )}

            {showPlanets && (
              <div className={playbackUiShellClassName}>
                <div className="bg-white text-black p-3 font-mono flex items-center justify-between">
                  <div>
                    <h2 className="text-[10px] uppercase tracking-wider">{ui.astrologicalData}</h2>
                    <p className="text-[9px] mt-1 opacity-60">
                      ASC: {getLocalizedSignLabel(horoscopeData.ascendant.sign.label, language)}{" "}
                      {horoscopeData.ascendant.ChartPosition.Ecliptic.ArcDegreesFormatted30}
                    </p>
                  </div>
                  <div className="text-right text-[9px] opacity-60">
                    <div>{sanitizeLocationLabel(formData.location)}</div>
                    <div>{new Date(formData.datetime).toLocaleString(localeCode)}</div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-[9px]">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="text-center p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.glyph}
                        </th>
                        <th className="text-right p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.ecliptic}
                        </th>
                        <th className="text-left p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.sign}
                        </th>
                        <th className="text-center p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.house}
                        </th>
                        <th className="text-left p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.position}
                        </th>
                        <th className="text-right p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.horizon}
                        </th>
                        <th className="text-center p-2 font-normal uppercase tracking-wide">{ui.retrograde}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {horoscopeData.planets.map((planet, index) => (
                        <tr key={planet.name} className={index % 2 === 0 ? "bg-black" : "bg-gray-900"}>
                          <td className="p-2 border-r border-gray-700 text-center text-base">
                            {PLANET_GLYPH_SVGS[planet.name] ? (
                              <img
                                src={PLANET_GLYPH_SVGS[planet.name]}
                                alt={getLocalizedPlanetLabel(planet.name || planet.label, language)}
                                className="inline-block w-5 h-5 mx-auto align-middle select-none"
                                draggable={false}
                              />
                            ) : (
                              <span
                                style={{
                                  paintOrder: "stroke fill",
                                  WebkitTextStroke: "0.3px white",
                                }}
                              >
                                {PLANET_GLYPH_FALLBACK_LABELS[planet.name] || getLocalizedPlanetLabel(planet.name || planet.label, language)}
                              </span>
                            )}
                          </td>
                          <td className="p-2 border-r border-gray-700 text-right tabular-nums">
                            {planet.ChartPosition.Ecliptic.DecimalDegrees.toFixed(4)}
                          </td>
                          <td className="p-2 border-r border-gray-700">{getLocalizedSignLabel(planet.Sign.label, language)}</td>
                          <td className="p-2 border-r border-gray-700 text-center">{planet.House}</td>
                          <td className="p-2 border-r border-gray-700">
                            {planet.ChartPosition.Ecliptic.ArcDegreesFormatted30}
                          </td>
                          <td className="p-2 border-r border-gray-700 text-right tabular-nums">
                            {planet.ChartPosition.Horizon.DecimalDegrees.toFixed(4)}
                          </td>
                          <td className="p-2 text-center">{planet.isRetrograde ? "R" : "—"}</td>
                        </tr>
                      ))}
                      <tr className={horoscopeData.planets.length % 2 === 0 ? "bg-black" : "bg-gray-900"}>
                        <td className="p-2 border-r border-gray-700 text-center text-base">
                          <span
                            style={{
                              paintOrder: "stroke fill",
                              WebkitTextStroke: "0.3px white",
                            }}
                          >
                            ASC
                          </span>
                        </td>
                        <td className="p-2 border-r border-gray-700 text-right tabular-nums">
                          {horoscopeData.ascendant.ChartPosition.Ecliptic.DecimalDegrees.toFixed(4)}
                        </td>
                        <td className="p-2 border-r border-gray-700">{getLocalizedSignLabel(horoscopeData.ascendant.sign.label, language)}</td>
                        <td className="p-2 border-r border-gray-700 text-center">1</td>
                        <td className="p-2 border-r border-gray-700">
                          {horoscopeData.ascendant.ChartPosition.Ecliptic.ArcDegreesFormatted30}
                        </td>
                        <td className="p-2 border-r border-gray-700 text-right tabular-nums">—</td>
                        <td className="p-2 text-center">—</td>
                      </tr>
                      <tr className={(horoscopeData.planets.length + 1) % 2 === 0 ? "bg-black" : "bg-gray-900"}>
                        <td className="p-2 border-r border-gray-700 text-center text-base">
                          <span
                            style={{
                              paintOrder: "stroke fill",
                              WebkitTextStroke: "0.3px white",
                            }}
                          >
                            MC
                          </span>
                        </td>
                        <td className="p-2 border-r border-gray-700 text-right tabular-nums">
                          {horoscopeData.mc.ChartPosition.Ecliptic.DecimalDegrees.toFixed(4)}
                        </td>
                        <td className="p-2 border-r border-gray-700">{getLocalizedSignLabel(horoscopeData.mc.Sign.label, language)}</td>
                        <td className="p-2 border-r border-gray-700 text-center">10</td>
                        <td className="p-2 border-r border-gray-700">
                          {horoscopeData.mc.ChartPosition.Ecliptic.ArcDegreesFormatted30}
                        </td>
                        <td className="p-2 border-r border-gray-700 text-right tabular-nums">—</td>
                        <td className="p-2 text-center">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {showAspects && horoscopeData.aspects.length > 0 && (
              <div className={playbackUiShellClassName}>
                <div className="bg-white text-black p-3 font-mono flex items-center justify-between">
                  <div>
                    <h2 className="text-[10px] uppercase tracking-wider">{ui.astrologicalAspects}</h2>
                    <p className="text-[9px] mt-1 opacity-60">{ui.majorAspects}</p>
                  </div>
                  <div className="text-right text-[9px] opacity-60">
                    <div>
                      {ui.total}:{" "}
                      {
                        horoscopeData.aspects.filter((a) => {
                          const mainPlanets = [
                            "sun",
                            "moon",
                            "mercury",
                            "venus",
                            "mars",
                            "jupiter",
                            "saturn",
                            "uranus",
                            "neptune",
                            "pluto",
                            "asc",
                            "mc",
                          ]
                          return mainPlanets.includes(a.point1.name) && mainPlanets.includes(a.point2.name)
                        }).length
                      }
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-[9px]">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="text-center p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.planet1}
                        </th>
                        <th className="text-center p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.aspect}
                        </th>
                        <th className="text-center p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.planet2}
                        </th>
                        <th className="text-right p-2 font-normal uppercase tracking-wide border-r border-gray-600">
                          {ui.angle}
                        </th>
                        <th className="text-right p-2 font-normal uppercase tracking-wide">{ui.orb}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {horoscopeData.aspects
                        .filter((aspect) => {
                          const mainPlanets = [
                            "sun",
                            "moon",
                            "mercury",
                            "venus",
                            "mars",
                            "jupiter",
                            "saturn",
                            "uranus",
                            "neptune",
                            "pluto",
                            "asc",
                            "mc",
                          ]
                          return (
                            mainPlanets.includes(aspect.point1.name) &&
                            mainPlanets.includes(aspect.point2.name) &&
                            isMajorAspectType(aspect.aspectType)
                          )
                        })
                        .map((aspect, index) => {
                          const aspectSymbol = getMajorAspectSymbol(aspect.aspectType)

                          // Check if it's MC or ASC for small font
                          const isSmallFont =
                            aspect.point1.name === "mc" ||
                            aspect.point1.name === "asc" ||
                            aspect.point2.name === "mc" ||
                            aspect.point2.name === "asc"

                          return (
                            <tr key={index} className={index % 2 === 0 ? "bg-black" : "bg-gray-900"}>
                              <td className="p-2 border-r border-gray-700 text-center">
                                {PLANET_GLYPH_SVGS[aspect.point1.name] ? (
                                  <img
                                    src={PLANET_GLYPH_SVGS[aspect.point1.name]}
                                    alt={getLocalizedPlanetLabel(aspect.point1.name || aspect.point1.label, language)}
                                    className="inline-block w-5 h-5 mx-auto align-middle select-none"
                                    draggable={false}
                                  />
                                ) : (
                                  <span
                                    className={`${isSmallFont && (aspect.point1.name === "mc" || aspect.point1.name === "asc") ? "text-sm" : "text-base"}`}
                                    style={{
                                      paintOrder: "stroke fill",
                                      WebkitTextStroke: "0.3px white",
                                    }}
                                  >
                                    {PLANET_GLYPH_FALLBACK_LABELS[aspect.point1.name] ||
                                      getLocalizedPlanetLabel(aspect.point1.name || aspect.point1.label, language)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 border-r border-gray-700 text-center">
                                <span className="text-lg" title={getMajorAspectLabel(aspect.aspectType, language)}>
                                  {aspectSymbol}
                                </span>
                              </td>
                              <td className="p-2 border-r border-gray-700 text-center">
                                {PLANET_GLYPH_SVGS[aspect.point2.name] ? (
                                  <img
                                    src={PLANET_GLYPH_SVGS[aspect.point2.name]}
                                    alt={getLocalizedPlanetLabel(aspect.point2.name || aspect.point2.label, language)}
                                    className="inline-block w-5 h-5 mx-auto align-middle select-none"
                                    draggable={false}
                                  />
                                ) : (
                                  <span
                                    className={`${isSmallFont && (aspect.point2.name === "mc" || aspect.point2.name === "asc") ? "text-sm" : "text-base"}`}
                                    style={{
                                      paintOrder: "stroke fill",
                                      WebkitTextStroke: "0.3px white",
                                    }}
                                  >
                                    {PLANET_GLYPH_FALLBACK_LABELS[aspect.point2.name] ||
                                      getLocalizedPlanetLabel(aspect.point2.name || aspect.point2.label, language)}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 border-r border-gray-700 text-right tabular-nums">
                                {aspect.angle?.toFixed(2) || "—"}
                              </td>
                              <td className="p-2 text-right tabular-nums">{aspect.orb?.toFixed(2) || "—"}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Aspect Box: Rendered based on showAspectBox state */}
            {showAspectBox && (
              <div
                className={`${playbackUiShellClassName} crt-tooltip absolute bottom-4 left-4 p-2 max-w-xs`}
                style={{ pointerEvents: "auto" }}
              >
                {Object.entries(activePlanetAspectsMap).length > 0 &&
                  Object.entries(activePlanetAspectsMap).map(([planetName, { aspects, opacity }]) => (
                    <div
                      key={`aspects-${planetName}`}
                      style={{
                        opacity: opacity,
                        transition: "opacity 0.1s linear",
                      }}
                    >
                      <h2 className="text-[10px] uppercase tracking-wider mb-1">
                        {ui.aspectsOf} {getLocalizedPlanetLabel(planetName, language).toUpperCase()}
                      </h2>
                      {aspects.map((aspect, index) => {
                        const aspectKey = getMajorAspectKey(aspect.aspectType)
                        if (!aspectKey) return null

                        const aspectSymbol = getMajorAspectSymbol(aspect.aspectType)
                        let aspectColor = "text-white"
                        let brightness = "brightness-75"

                        if (aspectKey === "opposition") {
                          aspectColor = "text-red-400"
                          brightness = "brightness-100"
                        } else if (aspectKey === "square") {
                          aspectColor = "text-violet-400"
                          brightness = "brightness-100"
                        } else if (aspectKey === "conjunction") {
                          aspectColor = "text-yellow-300"
                        } else if (aspectKey === "trine") {
                          aspectColor = "text-green-400"
                        } else if (aspectKey === "sextile") {
                          aspectColor = "text-blue-400"
                        }

                        return (
                          <div
                            key={`${planetName}-aspect-${index}`}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="inline-flex items-center justify-center min-w-[14px]">
                              {PLANET_GLYPH_SVGS[aspect.point1.name] ? (
                                <img
                                  src={PLANET_GLYPH_SVGS[aspect.point1.name]}
                                  alt={getLocalizedPlanetLabel(aspect.point1.name || aspect.point1.label, language)}
                                  className="w-3.5 h-3.5 select-none"
                                  draggable={false}
                                />
                              ) : (
                                PLANET_GLYPH_FALLBACK_LABELS[aspect.point1.name] ||
                                getLocalizedPlanetLabel(aspect.point1.name || aspect.point1.label, language)
                              )}
                            </span>
                            <span
                              className={`text-lg ${aspectColor} ${brightness}`}
                              title={getMajorAspectLabel(aspect.aspectType, language)}
                            >
                              {aspectSymbol}
                            </span>
                            <span className="inline-flex items-center justify-center min-w-[14px]">
                              {PLANET_GLYPH_SVGS[aspect.point2.name] ? (
                                <img
                                  src={PLANET_GLYPH_SVGS[aspect.point2.name]}
                                  alt={getLocalizedPlanetLabel(aspect.point2.name || aspect.point2.label, language)}
                                  className="w-3.5 h-3.5 select-none"
                                  draggable={false}
                                />
                              ) : (
                                PLANET_GLYPH_FALLBACK_LABELS[aspect.point2.name] ||
                                getLocalizedPlanetLabel(aspect.point2.name || aspect.point2.label, language)
                              )}
                            </span>
                            <span className="text-gray-400 text-xs">{aspect.angle.toFixed(1)}°</span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {horoscopeData && !showSubject && (
        <div className={`${playbackUiShellClassName} fixed bottom-0 inset-x-0 z-40 pointer-events-none`}>
          <div className="mx-auto w-full max-w-[calc(1400px+2rem)] md:max-w-[calc(1400px+4rem)] px-4 md:px-8">
            <div className="pb-[calc(env(safe-area-inset-bottom)+8px)] space-y-[2px] md:space-y-[3px]">
              <div className="relative !mb-[4px] !mt-0 border-b border-white/90">
                <span
                  className={`absolute bottom-[-1px] h-[10px] w-px bg-white transition-opacity duration-200 ${
                    isPlaybackActive ? "opacity-100" : "opacity-0"
                  }`}
                  style={{ left: `${Math.max(0, Math.min(100, playbackProgress * 100))}%` }}
                />
              </div>
              {/* Row 1 — Modes (large, 3 cols) */}
              <div className="grid grid-cols-3 gap-1 md:gap-1.5 pointer-events-auto">
                {TOP_PANEL_MODE_ORDER.map((mode) => {
                  const isActiveMode = navigationMode === mode
                  const isModePlaybackActive = isPlaybackActive && isActiveMode
                  const modeHoverKey = `mode:${mode}`
                  const playHoverKey = `play:${mode}`
                  const downloadHoverKey = `download:${mode}`
                  const isModeHoverActive = topPanelHoverKey === modeHoverKey
                  const isPlayHoverActive = topPanelHoverKey === playHoverKey
                  const isDownloadHoverActive = topPanelHoverKey === downloadHoverKey
                  const isModeHovering = isModeHoverActive || isPlayHoverActive || isDownloadHoverActive
                  const playTooltipText = isModePlaybackActive ? ui.stop : navModeActionLabel[mode]
                  const tooltipViewportClass =
                    "fixed left-1/2 -translate-x-1/2 bottom-[126px] md:bottom-[106px] z-[60] inline-block w-fit max-w-[calc(100vw-20px)]"
                  const tooltipText = isPlayHoverActive
                    ? playTooltipText
                    : isDownloadHoverActive
                      ? TOP_PANEL_DOWNLOAD_TOOLTIP_TEXT
                      : isModeHoverActive
                        ? navModeInstructionByMode[mode]
                        : null

                  return (
                    <div key={`top-nav-${mode}`} className="relative">
                      <div
                        className={`relative flex h-[40px] overflow-hidden border transition-colors md:h-[48px] ${
                          isModePlaybackActive
                            ? "border-white bg-white/80 text-black"
                            : isModeHovering
                              ? "border-white/80 bg-white/20 text-white"
                              : "border-white/50 bg-transparent text-white/80"
                        }`}
                      >
                        <button
                          onClick={() => {
                            showTopPanelHint(modeHoverKey)
                            if (isModePlaybackActive) {
                              stopCurrentPerformance()
                              return
                            }
                            setNavigationMode(mode)
                            if (horoscopeData) {
                              startNavigationMode(mode)
                            } else {
                              setShowSubject(true)
                              void launchModeFromSubject(mode)
                            }
                          }}
                          onMouseEnter={() => showTopPanelHint(modeHoverKey)}
                          onFocus={() => showTopPanelHint(modeHoverKey)}
                          className={`relative flex-1 px-1 font-mono font-bold text-[8px] leading-none uppercase tracking-[0.1em] transition-colors md:text-[10px] ${
                            isModePlaybackActive ? "text-black" : "hover:bg-white/12 hover:text-white"
                          }`}
                          title={playTooltipText}
                        >
                          <span
                            className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-25"
                            aria-hidden="true"
                          >
                            {isModePlaybackActive ? (
                              <svg width="28" height="28" viewBox="0 0 20 20" fill="currentColor">
                                <rect x="5" y="5" width="10" height="10" />
                              </svg>
                            ) : (
                              <svg width="28" height="28" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M6 4 L16 10 L6 16 Z" />
                              </svg>
                            )}
                          </span>
                          <span className="relative">{navModeHintLabel[mode]}</span>
                        </button>
                        <button
                          onClick={() => handleDownloadButtonPress(mode)}
                          onMouseEnter={() => showTopPanelHint(downloadHoverKey)}
                          onFocus={() => showTopPanelHint(downloadHoverKey)}
                          disabled={!horoscopeData || isExportingMp3}
                          className={`flex h-full w-[24%] min-w-[24px] items-center justify-center border-l transition-colors ${
                            !horoscopeData || isExportingMp3
                              ? "border-white/20 text-white/20 cursor-not-allowed"
                              : isModePlaybackActive
                                ? "border-black/25 text-black"
                                : "border-white/30 hover:bg-white/12 hover:text-white"
                          }`}
                          title={TOP_PANEL_DOWNLOAD_TOOLTIP_TEXT}
                        >
                          <svg
                            width="19"
                            height="19"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.65"
                            aria-hidden="true"
                          >
                            <path d="M3 8.8V12.4H13V8.8" />
                            <path d="M8 2.8V9.1" />
                            <path d="M5.9 7L8 9.1L10.1 7" />
                          </svg>
                        </button>
                        <span
                          className={`pointer-events-none ${tooltipViewportClass} whitespace-normal md:whitespace-nowrap crt-tooltip px-1.5 md:px-3 py-1.5 md:py-2 text-left font-mono text-[7px] md:text-[16px] normal-case leading-tight text-white transition-opacity duration-500 ${
                            tooltipText ? "opacity-100" : "opacity-0"
                          }`}
                        >
                          {tooltipText || ""}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Row 2 — Tools (small, 4 cols) */}
              <div className="grid grid-cols-4 gap-1 md:gap-1.5 pointer-events-auto">
                <div className="relative">
                  <button
                    ref={(node) => {
                      mobileMenuButtonRef.current = node
                      desktopMenuButtonRef.current = node
                    }}
                    onClick={() => setMenuOpen((prev) => !prev)}
                    onMouseEnter={() => showTopPanelHint("menu")}
                    onFocus={() => showTopPanelHint("menu")}
                    className={`flex h-[40px] w-full items-center justify-center border px-1 py-0 transition-colors md:h-[48px] ${
                      menuOpen
                        ? "border-white/80 bg-white/20 text-white"
                        : "border-white/50 bg-transparent text-white/80 hover:border-white/80 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M2.5 5H13.5" />
                      <path d="M2.5 8H13.5" />
                      <path d="M2.5 11H13.5" />
                    </svg>
                  </button>
                  <span
                    className={`pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-[126px] md:bottom-[106px] z-[60] inline-block w-fit max-w-[calc(100vw-20px)] whitespace-normal md:whitespace-nowrap crt-tooltip px-1.5 md:px-3 py-1.5 md:py-2 text-left font-mono text-[7px] md:text-[16px] normal-case leading-tight text-white transition-opacity duration-500 ${
                      topPanelHoverKey === "menu" ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {TOP_PANEL_MENU_TOOLTIP_TEXT}
                  </span>
                </div>
                <div className="relative">
                  <button
                    onClick={openInfoOverlay}
                    onMouseEnter={() => setTopPanelHoverKey("reset:info")}
                    onMouseLeave={() => setTopPanelHoverKey((current) => (current === "reset:info" ? null : current))}
                    onFocus={() => setTopPanelHoverKey("reset:info")}
                    onBlur={() => setTopPanelHoverKey((current) => (current === "reset:info" ? null : current))}
                    className={`h-[40px] w-full border px-1 py-0 font-mono text-[7px] font-bold leading-none uppercase tracking-[0.11em] transition-colors md:h-[48px] md:text-[9px] ${
                      topPanelHoverKey === "reset:info"
                        ? "border-white/80 bg-white/20 text-white"
                        : "border-white/50 bg-transparent text-white/80 hover:border-white/80 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    {ui.info}
                  </button>
                </div>
                <div className="relative">
                  <button
                    onClick={resetToInitialState}
                    onMouseEnter={() => setTopPanelHoverKey("reset:main")}
                    onMouseLeave={() => setTopPanelHoverKey((current) => (current === "reset:main" ? null : current))}
                    onFocus={() => setTopPanelHoverKey("reset:main")}
                    onBlur={() => setTopPanelHoverKey((current) => (current === "reset:main" ? null : current))}
                    className={`h-[40px] w-full border px-1 py-0 font-mono text-[7px] font-bold leading-none uppercase tracking-[0.11em] transition-colors md:h-[48px] md:text-[9px] ${
                      topPanelHoverKey === "reset:main"
                        ? "border-white/80 bg-white/20 text-white"
                        : "border-white/50 bg-transparent text-white/80 hover:border-white/80 hover:bg-white/20 hover:text-white"
                    }`}
                  >
                    {ui.reset}
                  </button>
                </div>
                <div className="relative">
                  <button
                    onClick={() => {
                      showTopPanelHint("photo:single")
                      void downloadChartSnapshotJpg()
                    }}
                    onMouseEnter={() => showTopPanelHint("photo:single")}
                    onFocus={() => showTopPanelHint("photo:single")}
                    disabled={!horoscopeData || isExportingJpg}
                    className={`flex h-[40px] w-full items-center justify-center border px-1 py-0 transition-colors md:h-[48px] ${
                      !horoscopeData || isExportingJpg
                        ? "border-white/20 bg-transparent text-white/20 cursor-not-allowed"
                        : topPanelHoverKey === "photo:single"
                          ? "border-white/80 bg-white/20 text-white"
                          : "border-white/50 bg-transparent text-white/80 hover:border-white/80 hover:bg-white/20 hover:text-white"
                    }`}
                    title={photoTooltipText}
                  >
                    <svg
                      width="19"
                      height="19"
                      viewBox="0 0 18 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      aria-hidden="true"
                    >
                      <rect x="2.3" y="4.4" width="13.4" height="9.2" rx="1.4" />
                      <path d="M5.5 4.4L6.8 2.9H11.2L12.5 4.4" />
                      <circle cx="9" cy="9" r="2.5" />
                    </svg>
                  </button>
                  <span
                    className={`pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-[126px] md:bottom-[106px] z-[60] inline-block w-fit max-w-[calc(100vw-20px)] whitespace-normal md:whitespace-nowrap crt-tooltip px-1.5 md:px-3 py-1.5 md:py-2 text-left font-mono text-[7px] md:text-[16px] normal-case leading-tight text-white transition-opacity duration-500 ${
                      topPanelHoverKey === "photo:single" ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {photoTooltipText}
                  </span>
                </div>
              </div>

              {/* Row 3 — Data Input (full width) */}
              <div className="pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    stopCurrentPerformance()
                    setShowSubject(true)
                    setMenuOpen(false)
                  }}
                  className="h-[40px] w-full border border-white/60 bg-transparent px-2 py-0 font-mono text-[9px] font-bold uppercase tracking-[0.18em] leading-none text-white transition-colors hover:border-white hover:bg-white/20 md:h-[48px] md:text-[11px]"
                >
                  {ui.dataInput}
                </button>
              </div>
              {isExportingMp3 && (
                <div className="mt-1.5 text-center font-mono text-[7px] md:text-[11px] uppercase tracking-wide text-white/70">
                  {ui.renderMp3}
                </div>
              )}
              {pendingMp3Download && !isExportingMp3 && (
                <a
                  href={pendingMp3Download.url}
                  download={pendingMp3Download.fileName}
                  className="mt-1.5 block w-full text-center font-mono text-[7px] md:text-[11px] uppercase tracking-wide border border-white px-3 py-1.5 hover:bg-white hover:text-black transition-colors pointer-events-auto"
                >
                  {ui.saveMp3}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {showInfoOverlay && (
        <div className="fixed inset-0 z-50 bg-black/92">
          <div className="h-full flex items-center justify-center px-4 md:px-8">
            <div className="crt-panel relative w-full max-w-[1200px] min-h-[420px] md:min-h-[520px] px-10 py-4 md:px-14 md:py-5 flex flex-col">
              <button
                onClick={retreatInfoParagraph}
                className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 font-mono text-[26px] md:text-[34px] leading-none text-white/60 hover:text-white transition-colors z-10"
                style={{ fontFamily: MONOTYPE_FONT_STACK }}
                aria-label={language === "es" ? "Parrafo anterior" : "Previous info page"}
              >
                {"<"}
              </button>
              <button
                onClick={advanceInfoParagraph}
                className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 font-mono text-[26px] md:text-[34px] leading-none text-white/60 hover:text-white transition-colors z-10"
                style={{ fontFamily: MONOTYPE_FONT_STACK }}
                aria-label={language === "es" ? "Parrafo siguiente" : "Next info page"}
              >
                {">"}
              </button>
              <div
                className="flex-1 flex items-center justify-center font-mono text-[10px] md:text-[24px] leading-[1.58] text-white/88 whitespace-pre-line text-center"
              >
                {renderInfoParagraph(language, infoParagraphs, infoParagraphIndex)}
              </div>
              <div className="mt-5 flex items-center justify-center gap-2.5">
                {infoParagraphs.map((_, index) => {
                  const isActive = index === infoParagraphIndex
                  return (
                    <button
                      key={`info-dot-${index}`}
                      type="button"
                      onClick={() => setInfoParagraphIndex(index)}
                      className="group/dot p-0.5"
                      aria-label={language === "es" ? `Ir al parrafo ${index + 1}` : `Go to paragraph ${index + 1}`}
                    >
                      <span
                        className={`block h-2.5 w-2.5 rounded-full border border-white/80 transition-opacity duration-200 group-hover/dot:opacity-100 ${
                          isActive ? "bg-white opacity-100" : "bg-white/15 opacity-45"
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              <div className="mt-5 flex items-center justify-between gap-2">
                <a
                  href="https://astrologio.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] md:text-[12px] uppercase tracking-wide text-white/70 hover:text-white underline underline-offset-2 transition-colors"
                >
                  astrologio.org
                </a>
                <button
                  onClick={closeInfoOverlay}
                  className="border border-white/70 px-2 py-1 font-mono text-[10px] md:text-[12px] uppercase tracking-wide text-white/85 hover:bg-white hover:text-black transition-colors"
                >
                  {ui.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
