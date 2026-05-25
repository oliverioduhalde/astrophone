"use client"

import { useEffect, useRef, useCallback, useState } from "react"

interface AudioTrack {
  audioContext: AudioContext
  source: AudioBufferSourceNode
  startTime: number
  endTime: number
  planetName: string
  basePlaybackRate?: number
  baseGain?: number
  gainNode?: GainNode
  kind?: "planet" | "aspect" | "element"
  panner?: any
}

type AudioEngineMode = "samples" | "hybrid" | "fm_pad" | "tibetan_bowls" | "tibetan_samples"

// [T-30] User-toggleable phases of the render/playback pipeline.
// Defined here (next to the renderer) so consumers can import a
// single canonical shape and so the hook can gate behavior without
// the consumer needing to know how it's wired internally.
export interface RenderPhases {
  planets: boolean
  background: boolean
  element: boolean
  fmPad: boolean
  normalizePerLayer: boolean
  renormalizeMix: boolean
  finalCompression: boolean
}
export const DEFAULT_RENDER_PHASES_INTERNAL: RenderPhases = {
  planets: true,
  background: true,
  element: true,
  fmPad: false,
  normalizePerLayer: true,
  renormalizeMix: false,
  finalCompression: false,
}

interface AudioEnvelope {
  fadeIn: number
  fadeOut: number
  backgroundVolume?: number
  aspectsSoundVolume?: number
  masterVolume?: number
  tuningCents?: number
  elementSoundVolume?: number
  dynAspectsFadeIn?: number
  dynAspectsSustain?: number
  dynAspectsFadeOut?: number
  modalEnabled?: boolean
  modalSunSignIndex?: number | null
  audioEngineMode?: AudioEngineMode
  synthVolume?: number
  vuEnabled?: boolean
  isChordMode?: boolean
  reverbMixPercent?: number
  chordReverbMixPercent?: number
  renderPhases?: RenderPhases
}

interface Position3D {
  x: number
  y: number
  z: number
}

type Mp3Chunk = Int8Array | Uint8Array | number[]

interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Mp3Chunk
  flush(): Mp3Chunk
}

interface PreparedOfflinePlayback {
  buffer: AudioBuffer
  durationSec: number
  renderMs: number
  fromCache: boolean
}

interface PlanetData {
  name: string
  ChartPosition: {
    Ecliptic: {
      DecimalDegrees: number
    }
    Horizon: {
      DecimalDegrees: number
    }
  }
  declination?: number
}

export interface OfflineMp3AspectEvent {
  planetName: string
  angleDeg: number
  declinationDeg: number
  aspectType: string
}

export interface OfflineMp3PlanetEvent {
  planetName: string
  angleDeg: number
  declinationDeg: number
  startSec: number
  fadeInSec: number
  fadeOutSec: number
  aspects?: OfflineMp3AspectEvent[]
  aspectFadeInSec?: number
  aspectSustainSec?: number
  aspectFadeOutSec?: number
  aspectVolumePercent?: number
}

export interface OfflineMp3RenderOptions {
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

function polarToCartesian3D(azimuthDeg: number, elevationDeg: number): Position3D {
  const distance = 5
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const elevationRad = (elevationDeg * Math.PI) / 180

  return {
    x: distance * Math.sin(azimuthRad) * Math.cos(elevationRad),
    z: distance * Math.cos(azimuthRad) * Math.cos(elevationRad),
    y: distance * Math.sin(elevationRad),
  }
}

const LEGACY_PLANET_SEMITONE_OFFSETS: Record<string, number> = {
  pluto: 0, // C4
  saturn: 2, // D4
  neptune: 4, // E4
  jupiter: 5, // F4
  moon: 9, // A4
  venus: 11, // B4
  sun: 12, // C5
  mars: 14, // D5
  mercury: 16, // E5
  uranus: 19, // G5
}

// Sign index: Aries=0 ... Pisces=11
const SIGN_MODE_PCS: Record<number, number[]> = {
  0: [0, 1, 4, 5, 7, 8, 10], // Aries - Frigio dominante
  1: [0, 2, 3, 5, 7, 9, 10], // Tauro - Dórico
  2: [0, 2, 4, 6, 7, 9, 11], // Géminis - Lidio
  3: [0, 2, 3, 5, 7, 8, 10], // Cáncer - Eólico
  4: [0, 2, 4, 5, 7, 9, 11], // Leo - Jónico
  5: [0, 2, 3, 5, 7, 8, 10], // Virgo - Eólico
  6: [0, 2, 4, 5, 7, 9, 11], // Libra - Jónico
  7: [0, 1, 3, 5, 7, 8, 10], // Escorpio - Frigio
  8: [0, 2, 4, 5, 7, 9, 10], // Sagitario - Mixolidio
  9: [0, 2, 3, 5, 7, 8, 11], // Capricornio - Menor armónico
  10: [0, 2, 4, 6, 7, 9, 10], // Acuario - Lidio dominante
  11: [0, 1, 3, 5, 6, 8, 10], // Piscis - Locrio
}

const SIGN_PLANET_PROXIMITY: Record<number, string[]> = {
  0: ["mars", "pluto", "sun", "jupiter", "mercury", "venus", "uranus", "saturn", "moon", "neptune"], // Aries
  1: ["venus", "moon", "saturn", "mercury", "jupiter", "mars", "neptune", "pluto", "uranus", "sun"], // Tauro
  2: ["mercury", "uranus", "jupiter", "venus", "moon", "mars", "neptune", "saturn", "pluto", "sun"], // Géminis
  3: ["moon", "neptune", "venus", "jupiter", "mercury", "pluto", "saturn", "mars", "uranus", "sun"], // Cáncer
  4: ["sun", "jupiter", "mars", "venus", "mercury", "saturn", "pluto", "uranus", "neptune", "moon"], // Leo
  5: ["mercury", "saturn", "moon", "venus", "jupiter", "mars", "neptune", "uranus", "pluto", "sun"], // Virgo
  6: ["venus", "saturn", "moon", "mercury", "jupiter", "neptune", "mars", "uranus", "pluto", "sun"], // Libra
  7: ["mars", "pluto", "neptune", "saturn", "venus", "moon", "mercury", "jupiter", "uranus", "sun"], // Escorpio
  8: ["jupiter", "mars", "sun", "mercury", "uranus", "venus", "saturn", "moon", "neptune", "pluto"], // Sagitario
  9: ["saturn", "mars", "pluto", "venus", "mercury", "jupiter", "moon", "neptune", "uranus", "sun"], // Capricornio
  10: ["saturn", "uranus", "mercury", "jupiter", "venus", "mars", "moon", "neptune", "pluto", "sun"], // Acuario
  11: ["jupiter", "neptune", "moon", "venus", "mercury", "pluto", "saturn", "mars", "uranus", "sun"], // Piscis
}

// Proximity -> harmonic target interval (semitones from fundamental)
const INTERVAL_TARGET_BY_PROXIMITY = [0, 7, 5, 4, 3, 9, 8, 2, 10, 11, 1, 6]
const CONSONANCE_PRIORITY = INTERVAL_TARGET_BY_PROXIMITY
const DEFAULT_SYSTEM_OCTAVE_SHIFT_SEMITONES = -24 // Two octaves down by default
const VENUS_PRINCIPAL_OCTAVE_BOOST_SEMITONES = 12
const FM_PAD_OCTAVE_SHIFT_SEMITONES = 12 // One octave up vs current FM baseline
const FM_PAD_GAIN_BOOST_FACTOR = 4 // +300% (4x total)
const BOWL_SYNTH_OCTAVE_SHIFT_SEMITONES = 0
const BOWL_GAIN_BOOST_FACTOR = 3
const GLOBAL_REVERB_RETURN_GAIN = 1.8
const ORBITAL_STAR_BACKGROUND_DURATION_SEC = 240
const ORBITAL_STAR_BACKGROUND_FADE_IN_SEC = 8
const ORBITAL_STAR_BACKGROUND_FADE_OUT_SEC = 10
const ORBITAL_STAR_BACKGROUND_RENDER_PEAK_GAIN = 0.45
const ORBITAL_STAR_BACKGROUND_PLANET_GAIN_BY_INDEX = [1, 0.9, 0.82]
const ORBITAL_STAR_BACKGROUND_PAN_BY_INDEX = [-0.55, 0, 0.55]
const ORBITAL_STAR_BACKGROUND_STAGGER_SEC = [0, 0.9, 1.8]
const ASPECT_SEMITONE_OFFSETS: Record<string, number> = {
  Conjunción: 0,
  Conjunction: 0,
  conjunction: 0,
  Oposición: 14,
  Opposition: 14,
  opposition: 14,
  Cuadrado: 6,
  Square: 6,
  square: 6,
  Cuadratura: 6,
  Trígono: 7,
  Trine: 7,
  trine: 7,
  Sextil: 5,
  Sextile: 5,
  sextile: 5,
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12
}

function getLegacyPlanetSemitoneOffset(planetName: string): number {
  return LEGACY_PLANET_SEMITONE_OFFSETS[planetName] ?? 0
}

function getConsonanceRank(pc: number): number {
  const idx = CONSONANCE_PRIORITY.indexOf(mod12(pc))
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
}

function circularDistancePc(a: number, b: number): number {
  const diff = Math.abs(mod12(a) - mod12(b))
  return Math.min(diff, 12 - diff)
}

function findClosestPitchClassByConsonance(targetPc: number, pcs: number[]): number {
  if (!pcs || pcs.length === 0) return mod12(targetPc)

  const normalizedTarget = mod12(targetPc)
  return pcs
    .map((pc) => mod12(pc))
    .sort((a, b) => {
      const da = circularDistancePc(a, normalizedTarget)
      const db = circularDistancePc(b, normalizedTarget)
      if (da !== db) return da - db

      // Tie-break toward the most consonant option
      const ca = getConsonanceRank(a)
      const cb = getConsonanceRank(b)
      if (ca !== cb) return ca - cb

      return a - b
    })[0]
}

function getModalPlanetSemitoneOffset(planetName: string, sunSignIndex: number): number {
  const signIdx = mod12(sunSignIndex)
  const proximity = SIGN_PLANET_PROXIMITY[signIdx]
  const pcs = SIGN_MODE_PCS[signIdx]
  if (!proximity || !pcs) return getLegacyPlanetSemitoneOffset(planetName)

  const normalizedPlanet = planetName.toLowerCase()
  const proximityIndex = proximity.indexOf(normalizedPlanet)
  if (proximityIndex === -1) return getLegacyPlanetSemitoneOffset(normalizedPlanet)

  const targetInterval = INTERVAL_TARGET_BY_PROXIMITY[proximityIndex] ?? INTERVAL_TARGET_BY_PROXIMITY[0]
  const resolvedInterval = pcs.includes(targetInterval)
    ? targetInterval
    : findClosestPitchClassByConsonance(targetInterval, pcs)

  // Root is fixed by sign; keep planet legacy octave register to preserve spacing.
  const legacySemitone = getLegacyPlanetSemitoneOffset(normalizedPlanet)
  const legacyOctave = Math.floor(legacySemitone / 12)
  const signRootPc = signIdx
  return signRootPc + resolvedInterval + legacyOctave * 12
}

function getPlanetPrincipalSemitoneOffset(planetName: string, modalEnabled: boolean, sunSignIndex: number | null): number {
  const normalized = planetName.toLowerCase()
  const baseSemitoneOffset =
    modalEnabled && sunSignIndex !== null
      ? getModalPlanetSemitoneOffset(normalized, sunSignIndex)
      : getLegacyPlanetSemitoneOffset(normalized)
  if (normalized === "venus") {
    return baseSemitoneOffset + VENUS_PRINCIPAL_OCTAVE_BOOST_SEMITONES
  }
  return baseSemitoneOffset
}

function getPlanetPrincipalPlaybackRate(planetName: string, modalEnabled: boolean, sunSignIndex: number | null): number {
  const semitones = getPlanetPrincipalSemitoneOffset(planetName, modalEnabled, sunSignIndex)

  return Math.pow(2, (semitones + DEFAULT_SYSTEM_OCTAVE_SHIFT_SEMITONES) / 12)
}

function getSignRulerPlanetName(sunSignIndex: number | null): string {
  if (sunSignIndex === null) return "sun"
  const proximity = SIGN_PLANET_PROXIMITY[mod12(sunSignIndex)]
  return proximity?.[0] ?? "sun"
}

function getTopRegencyPlanetsForSign(sunSignIndex: number | null): string[] {
  if (sunSignIndex === null) {
    return ["sun", "moon", "jupiter"]
  }

  const proximity = SIGN_PLANET_PROXIMITY[mod12(sunSignIndex)] || []
  const topThree = proximity.slice(0, 3).map((name) => name.toLowerCase())
  const fallback = [getSignRulerPlanetName(sunSignIndex), "moon", "sun"].map((name) => name.toLowerCase())
  return Array.from(new Set([...topThree, ...fallback])).slice(0, 3)
}

function getPlanetVolumeMultiplier(planetName: string): number {
  const normalized = planetName.toLowerCase()
  const volumeMultipliers: Record<string, number> = {
    sun: 1.2, // +20%
    pluto: 1.25, // +25%
    mercury: 0.8, // -20%
    mars: 0.6, // -40%
    neptune: 1.44, // +20% adicional sobre el ajuste previo
  }

  return volumeMultipliers[normalized] ?? 1
}

function getTibetanSampleKey(planetName: string): string {
  const normalized = planetName.toLowerCase()
  const map: Record<string, string> = {
    sun: "bowl_high",
    moon: "bowl_mid",
    mercury: "bowl_high",
    venus: "bowl_mid",
    mars: "bowl_low",
    jupiter: "bowl_low",
    saturn: "bowl_low",
    uranus: "bowl_mid",
    neptune: "bowl_high",
    pluto: "bowl_low",
    asc: "bowl_mid",
    mc: "bowl_mid",
  }
  return map[normalized] ?? "bowl_mid"
}

function getFmPadGainValue(masterVolume: number, synthVolume: number): number {
  return Math.max(0, (masterVolume / 100) * 0.22 * FM_PAD_GAIN_BOOST_FACTOR * (synthVolume / 100))
}

function getBowlGainValue(masterVolume: number, synthVolume: number): number {
  return Math.max(0, (masterVolume / 100) * 0.18 * BOWL_GAIN_BOOST_FACTOR * (synthVolume / 100))
}

function getReverbWetMix(
  isChordMode: boolean,
  reverbMixPercent = 20,
  chordReverbMixPercent = 40,
): number {
  const mixPercent = isChordMode ? chordReverbMixPercent : reverbMixPercent
  return Math.max(0, Math.min(1, mixPercent / 100))
}

function getReverbDecaySeconds(isChordMode: boolean): number {
  return isChordMode ? 5 : 3
}

/**
 * Peak-normalize an AudioBuffer in-place so the loudest sample sits at
 * targetDbfs (default -1 dBFS). Skips normalization if the buffer is
 * already louder than the target or if the peak is essentially silence.
 */
function normalizeBufferPeak(buffer: AudioBuffer, targetDbfs = -1): AudioBuffer {
  if (!buffer) return buffer
  const targetLinear = Math.pow(10, targetDbfs / 20)
  let peak = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  if (peak < 1e-5) return buffer
  const gain = targetLinear / peak
  if (gain <= 1.0001) return buffer // already at or above target, leave it
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.max(-1, Math.min(1, data[i] * gain))
    }
  }
  return buffer
}

/**
 * Anti-click stop. Ramps `gainNode` to 0 over fadeMs, schedules source.stop()
 * after the ramp finishes, and disconnects nodes. Safe to call when source
 * is already stopped or nodes are already disconnected.
 *
 * Why: AudioBufferSourceNode.stop() is sample-accurate but produces an audible
 * click when the signal level is non-zero at the cut point. A short gain
 * ramp eliminates the discontinuity.
 */
function rampGainToZeroAndStop(
  source: AudioBufferSourceNode | null | undefined,
  gainNode: GainNode | null | undefined,
  ctx: AudioContext | BaseAudioContext | null | undefined,
  fadeMs = 30,
  extraDisconnects: (AudioNode | null | undefined)[] = [],
): void {
  if (!ctx) return
  const safeFadeSec = Math.max(0.005, fadeMs / 1000)
  const now = ctx.currentTime
  if (gainNode) {
    try {
      gainNode.gain.cancelScheduledValues(now)
      gainNode.gain.setValueAtTime(gainNode.gain.value, now)
      gainNode.gain.linearRampToValueAtTime(0, now + safeFadeSec)
    } catch {
      // gain already torn down — ignore
    }
  }
  const stopAt = now + safeFadeSec
  if (source) {
    try {
      // Disable onended so callers using it for state cleanup don't fire twice
      ;(source as AudioBufferSourceNode).onended = null
    } catch {
      // ignore
    }
    try {
      source.stop(stopAt)
    } catch {
      // already stopped
    }
  }
  // Disconnect nodes after the ramp window so the tail plays cleanly
  setTimeout(() => {
    if (source) {
      try {
        source.disconnect()
      } catch {
        // ignore
      }
    }
    if (gainNode) {
      try {
        gainNode.disconnect()
      } catch {
        // ignore
      }
    }
    for (const node of extraDisconnects) {
      if (!node) continue
      try {
        node.disconnect()
      } catch {
        // ignore
      }
    }
  }, fadeMs + 10)
}

function createLowDiffusionReverbImpulse(ctx: BaseAudioContext, durationSeconds = 3): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.floor(sampleRate * durationSeconds))
  const impulse = ctx.createBuffer(1, length, sampleRate)
  const data = impulse.getChannelData(0)

  for (let i = 0; i < length; i++) {
    data[i] = 0
  }

  // Sparse taps for low diffusion + linear decay envelope over requested duration.
  const tapSpacingSamples = Math.max(1, Math.floor(sampleRate * 0.011))
  for (let i = 0; i < length; i += tapSpacingSamples) {
    const t = i / (length - 1)
    const linearDecay = 1 - t
    const noise = (Math.random() * 2 - 1) * 0.32
    data[i] = noise * linearDecay
    if (i + 1 < length) {
      data[i + 1] = noise * 0.5 * linearDecay
    }
  }

  return impulse
}

function createSCurveFadeOutValues(peakGain: number, points = 128): Float32Array {
  const totalPoints = Math.max(8, points)
  const curve = new Float32Array(totalPoints)
  for (let i = 0; i < totalPoints; i++) {
    const t = i / (totalPoints - 1)
    const smooth = t * t * (3 - 2 * t)
    curve[i] = peakGain * (1 - smooth)
  }
  return curve
}

function centsToPlaybackRate(cents: number): number {
  return Math.pow(2, cents / 1200)
}

function floatToInt16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }
  return output
}

function toUint8Array(chunk: Mp3Chunk): Uint8Array {
  return Uint8Array.from(chunk as ArrayLike<number>, (value) => value & 0xff)
}

function roundOfflineKeyValue(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(digits))
}

export function usePlanetAudio(
  envelope: AudioEnvelope = { fadeIn: 7, fadeOut: 7, backgroundVolume: 20, aspectsSoundVolume: 11, masterVolume: 20 },
) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBuffersRef = useRef<Record<string, AudioBuffer>>({})
  const activeTracksRef = useRef<Map<string, AudioTrack>>(new Map())
  const playingPlanetsRef = useRef<Set<string>>(new Set())
  const initPromiseRef = useRef<Promise<void> | null>(null)
  const resonanceSceneRef = useRef<any>(null)

  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingLabel, setLoadingLabel] = useState("Inicializando audio")
  const [audioLevelLeftPre, setAudioLevelLeftPre] = useState(0)
  const [audioLevelRightPre, setAudioLevelRightPre] = useState(0)
  const [audioLevelLeftPost, setAudioLevelLeftPost] = useState(0)
  const [audioLevelRightPost, setAudioLevelRightPost] = useState(0)
  const [compressionReductionDb, setCompressionReductionDb] = useState(0)
  const preLeftAnalyserRef = useRef<AnalyserNode | null>(null)
  const preRightAnalyserRef = useRef<AnalyserNode | null>(null)
  const postLeftAnalyserRef = useRef<AnalyserNode | null>(null)
  const postRightAnalyserRef = useRef<AnalyserNode | null>(null)
  const preLeftDataArrayRef = useRef<Uint8Array | null>(null)
  const preRightDataArrayRef = useRef<Uint8Array | null>(null)
  const postLeftDataArrayRef = useRef<Uint8Array | null>(null)
  const postRightDataArrayRef = useRef<Uint8Array | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)

  const backgroundSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const backgroundGainRef = useRef<GainNode | null>(null)
  const backgroundBufferRef = useRef<AudioBuffer | null>(null)
  const backgroundRenderPromiseRef = useRef<Promise<AudioBuffer | null> | null>(null)
  const backgroundRenderRequestIdRef = useRef(0)
  const backgroundSignIndexRef = useRef<number | null>(null)
  const elementBackgroundSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const elementBackgroundGainRef = useRef<GainNode | null>(null)
  const elementBackgroundNextSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const elementBackgroundNextGainRef = useRef<GainNode | null>(null)
  const elementBackgroundTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const backgroundVolumeRef = useRef(envelope.backgroundVolume ?? 20)
  const aspectsSoundVolumeRef = useRef(envelope.aspectsSoundVolume ?? 11)
  const masterVolumeRef = useRef(envelope.masterVolume ?? 20)
  const tuningCentsRef = useRef(envelope.tuningCents ?? 0)
  const elementSoundVolumeRef = useRef(envelope.elementSoundVolume ?? 40)
  const synthVolumeRef = useRef(envelope.synthVolume ?? 450)
  const masterGainNodeRef = useRef<GainNode | null>(null)
  const planetReverbImpulseRef = useRef<AudioBuffer | null>(null)
  const globalReverbSendRef = useRef<GainNode | null>(null)
  const globalReverbConvolverRef = useRef<ConvolverNode | null>(null)
  const isChordModeRef = useRef(envelope.isChordMode ?? false)
  const reverbMixPercentRef = useRef(envelope.reverbMixPercent ?? 20)
  const chordReverbMixPercentRef = useRef(envelope.chordReverbMixPercent ?? 40)
  const reverbDecaySecondsRef = useRef(getReverbDecaySeconds(envelope.isChordMode ?? false))
  const dynAspectsFadeInRef = useRef(envelope.dynAspectsFadeIn ?? 3)
  const dynAspectsSustainRef = useRef(envelope.dynAspectsSustain ?? 2)
  const dynAspectsFadeOutRef = useRef(envelope.dynAspectsFadeOut ?? 15)
  const modalEnabledRef = useRef(envelope.modalEnabled ?? true)
  const modalSunSignIndexRef = useRef<number | null>(
    typeof envelope.modalSunSignIndex === "number" ? envelope.modalSunSignIndex : null,
  )
  const audioEngineModeRef = useRef<AudioEngineMode>(envelope.audioEngineMode || "samples")
  // [T-30-b] Mirror render-phase toggles so the offline-render and
  // live-playback callbacks can read current values without us
  // threading them through every dependency array.
  const renderPhasesRef = useRef<RenderPhases>(envelope.renderPhases || DEFAULT_RENDER_PHASES_INTERNAL)
  const toneModuleRef = useRef<any>(null)
  const fmPadSynthRef = useRef<any>(null)
  const fmPadGainRef = useRef<any>(null)
  const bowlSynthRef = useRef<any>(null)
  const bowlGainRef = useRef<any>(null)
  const offlinePlaybackCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
  const offlinePlaybackPromiseCacheRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map())
  const activeOfflinePlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const activeOfflinePlaybackGainRef = useRef<GainNode | null>(null)
  const activeOfflinePlaybackStartedAtRef = useRef(0)
  const activeOfflinePlaybackOffsetSecRef = useRef(0)
  const activeOfflinePlaybackDurationSecRef = useRef(0)

  useEffect(() => {
    backgroundVolumeRef.current = envelope.backgroundVolume ?? 20
    if (backgroundGainRef.current) {
      backgroundGainRef.current.gain.value = (envelope.backgroundVolume ?? 20) / 100
    }
  }, [envelope.backgroundVolume])

  useEffect(() => {
    tuningCentsRef.current = envelope.tuningCents ?? 0
  }, [envelope.tuningCents])

  useEffect(() => {
    elementSoundVolumeRef.current = envelope.elementSoundVolume ?? 40
  }, [envelope.elementSoundVolume])

  useEffect(() => {
    const elementGain = elementSoundVolumeRef.current / 100
    if (elementBackgroundGainRef.current && audioContextRef.current) {
      elementBackgroundGainRef.current.gain.setTargetAtTime(elementGain, audioContextRef.current.currentTime, 0.05)
    }
    if (elementBackgroundNextGainRef.current && audioContextRef.current) {
      elementBackgroundNextGainRef.current.gain.setTargetAtTime(elementGain, audioContextRef.current.currentTime, 0.05)
    }
  }, [envelope.elementSoundVolume])

  useEffect(() => {
    const tunedRate = centsToPlaybackRate(tuningCentsRef.current)
    activeTracksRef.current.forEach((track) => {
      if (track.basePlaybackRate !== undefined) {
        track.source.playbackRate.value = track.basePlaybackRate * tunedRate
      }
    })
  }, [envelope.tuningCents])

  useEffect(() => {
    aspectsSoundVolumeRef.current = envelope.aspectsSoundVolume ?? 11
  }, [envelope.aspectsSoundVolume])

  useEffect(() => {
    dynAspectsFadeInRef.current = envelope.dynAspectsFadeIn ?? 3
    dynAspectsSustainRef.current = envelope.dynAspectsSustain ?? 2
    dynAspectsFadeOutRef.current = envelope.dynAspectsFadeOut ?? 15
  }, [envelope.dynAspectsFadeIn, envelope.dynAspectsSustain, envelope.dynAspectsFadeOut])

  useEffect(() => {
    synthVolumeRef.current = envelope.synthVolume ?? 450
    if (fmPadGainRef.current?.gain) {
      const fmGain = getFmPadGainValue(masterVolumeRef.current, synthVolumeRef.current)
      if (typeof fmPadGainRef.current.gain.rampTo === "function") {
        fmPadGainRef.current.gain.rampTo(fmGain, 0.05)
      } else {
        fmPadGainRef.current.gain.value = fmGain
      }
    }
    if (bowlGainRef.current?.gain) {
      const bowlGain = getBowlGainValue(masterVolumeRef.current, synthVolumeRef.current)
      if (typeof bowlGainRef.current.gain.rampTo === "function") {
        bowlGainRef.current.gain.rampTo(bowlGain, 0.05)
      } else {
        bowlGainRef.current.gain.value = bowlGain
      }
    }
  }, [envelope.synthVolume])

  useEffect(() => {
    modalEnabledRef.current = envelope.modalEnabled ?? true
  }, [envelope.modalEnabled])

  useEffect(() => {
    modalSunSignIndexRef.current =
      typeof envelope.modalSunSignIndex === "number" ? envelope.modalSunSignIndex : null
  }, [envelope.modalSunSignIndex])

  useEffect(() => {
    audioEngineModeRef.current = envelope.audioEngineMode || "samples"
  }, [envelope.audioEngineMode])

  // [T-30-b] Keep renderPhasesRef in sync with prop. We do not
  // invalidate the cache here — the parent component is responsible
  // for calling clearOfflinePlaybackCache() when a render-affecting
  // toggle flips. This lets the parent batch invalidations and skip
  // them for the compression toggle (which is post-buffer).
  useEffect(() => {
    if (envelope.renderPhases) {
      renderPhasesRef.current = envelope.renderPhases
    }
  }, [envelope.renderPhases])

  useEffect(() => {
    reverbMixPercentRef.current = envelope.reverbMixPercent ?? 20
  }, [envelope.reverbMixPercent])

  useEffect(() => {
    chordReverbMixPercentRef.current = envelope.chordReverbMixPercent ?? 40
  }, [envelope.chordReverbMixPercent])

  useEffect(() => {
    const isChordMode = envelope.isChordMode ?? false
    isChordModeRef.current = isChordMode
    const nextDecaySeconds = getReverbDecaySeconds(isChordMode)

    if (
      audioContextRef.current &&
      globalReverbConvolverRef.current &&
      reverbDecaySecondsRef.current !== nextDecaySeconds
    ) {
      planetReverbImpulseRef.current = createLowDiffusionReverbImpulse(audioContextRef.current, nextDecaySeconds)
      globalReverbConvolverRef.current.buffer = planetReverbImpulseRef.current
      reverbDecaySecondsRef.current = nextDecaySeconds
    }
  }, [envelope.isChordMode])

  useEffect(() => {
    const vol = envelope.masterVolume !== undefined ? envelope.masterVolume : 20
    masterVolumeRef.current = vol
    if (masterGainNodeRef.current) {
      // [T-36] Pre-amp recortado de 28 → 18 dB. Devuelve rango útil a
      // los faders de bg/element/aspect; el master sube ~10 dB menos
      // por unidad, así "20%" deja de saturar.
      const baseGain = Math.pow(10, 18 / 20) // 18 dB ≈ 7.94x
      masterGainNodeRef.current.gain.value = baseGain * (vol / 100)
    }
    if (fmPadGainRef.current?.gain) {
      const fmGain = getFmPadGainValue(vol, synthVolumeRef.current)
      if (typeof fmPadGainRef.current.gain.rampTo === "function") {
        fmPadGainRef.current.gain.rampTo(fmGain, 0.05)
      } else {
        fmPadGainRef.current.gain.value = fmGain
      }
    }
    if (bowlGainRef.current?.gain) {
      const bowlGain = getBowlGainValue(vol, synthVolumeRef.current)
      if (typeof bowlGainRef.current.gain.rampTo === "function") {
        bowlGainRef.current.gain.rampTo(bowlGain, 0.05)
      } else {
        bowlGainRef.current.gain.value = bowlGain
      }
    }
  }, [envelope.masterVolume])

  // VU Meter update loop - 50ms refresh rate, pre/post compression
  useEffect(() => {
    const vuEnabled = envelope.vuEnabled ?? false
    let intervalId: NodeJS.Timeout | undefined

    if (!vuEnabled) {
      setAudioLevelLeftPre(0)
      setAudioLevelRightPre(0)
      setAudioLevelLeftPost(0)
      setAudioLevelRightPost(0)
      setCompressionReductionDb(0)
      return () => {
        if (intervalId) clearTimeout(intervalId)
      }
    }

    const updateVuMeter = () => {
      if (
        preLeftAnalyserRef.current &&
        preRightAnalyserRef.current &&
        postLeftAnalyserRef.current &&
        postRightAnalyserRef.current &&
        preLeftDataArrayRef.current &&
        preRightDataArrayRef.current &&
        postLeftDataArrayRef.current &&
        postRightDataArrayRef.current
      ) {
        const toDbfsPercent = (avg: number) => {
          const normalizedLevel = avg / 255
          const dbfs = normalizedLevel > 0 ? 20 * Math.log10(normalizedLevel) : -60
          return Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100))
        }

        preLeftAnalyserRef.current.getByteFrequencyData(preLeftDataArrayRef.current)
        preRightAnalyserRef.current.getByteFrequencyData(preRightDataArrayRef.current)
        postLeftAnalyserRef.current.getByteFrequencyData(postLeftDataArrayRef.current)
        postRightAnalyserRef.current.getByteFrequencyData(postRightDataArrayRef.current)

        const preLeftSum = preLeftDataArrayRef.current.reduce((acc, val) => acc + val, 0)
        const preRightSum = preRightDataArrayRef.current.reduce((acc, val) => acc + val, 0)
        const postLeftSum = postLeftDataArrayRef.current.reduce((acc, val) => acc + val, 0)
        const postRightSum = postRightDataArrayRef.current.reduce((acc, val) => acc + val, 0)

        const preLeftAverage = preLeftSum / preLeftDataArrayRef.current.length
        const preRightAverage = preRightSum / preRightDataArrayRef.current.length
        const postLeftAverage = postLeftSum / postLeftDataArrayRef.current.length
        const postRightAverage = postRightSum / postRightDataArrayRef.current.length

        setAudioLevelLeftPre(toDbfsPercent(preLeftAverage))
        setAudioLevelRightPre(toDbfsPercent(preRightAverage))
        setAudioLevelLeftPost(toDbfsPercent(postLeftAverage))
        setAudioLevelRightPost(toDbfsPercent(postRightAverage))

        if (compressorRef.current) {
          const reduction = Math.max(0, -compressorRef.current.reduction)
          setCompressionReductionDb(reduction)
        }
      }
      intervalId = setTimeout(updateVuMeter, 50)
    }

    updateVuMeter()

    return () => {
      if (intervalId) {
        clearTimeout(intervalId)
      }
    }
  }, [envelope.vuEnabled])

  const initializeAudio = useCallback(async () => {
    if (initPromiseRef.current) return initPromiseRef.current

    initPromiseRef.current = (async () => {
      try {
        setLoadingLabel("Inicializando audio")
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
          console.log("[v0] AudioContext created")

          if (!(window as any).ResonanceAudio) {
            setLoadingLabel("Cargando motor 3D")
            const script = document.createElement("script")
            script.src = "https://cdn.jsdelivr.net/npm/resonance-audio/build/resonance-audio.min.js"
            script.async = true
            document.head.appendChild(script)

            await new Promise((resolve) => {
              script.onload = resolve
            })
          }

          resonanceSceneRef.current = new (window as any).ResonanceAudio(audioContextRef.current)

          const masterGainNode = audioContextRef.current.createGain()
          const baseGain = Math.pow(10, 18 / 20) // [T-36] 18 dB ≈ 7.94x (recortado desde 28 dB)
          masterGainNode.gain.value = baseGain * (masterVolumeRef.current / 100)
          masterGainNodeRef.current = masterGainNode

          const initialReverbDecaySeconds = getReverbDecaySeconds(isChordModeRef.current)
          if (!planetReverbImpulseRef.current || reverbDecaySecondsRef.current !== initialReverbDecaySeconds) {
            planetReverbImpulseRef.current = createLowDiffusionReverbImpulse(
              audioContextRef.current,
              initialReverbDecaySeconds,
            )
            reverbDecaySecondsRef.current = initialReverbDecaySeconds
          }

          // Shared reverb bus to avoid creating convolver/filter nodes per note.
          const globalReverbSend = audioContextRef.current.createGain()
          globalReverbSend.gain.value = 1
          const globalReverbConvolver = audioContextRef.current.createConvolver()
          globalReverbConvolver.buffer = planetReverbImpulseRef.current
          const globalReverbShelf = audioContextRef.current.createBiquadFilter()
          globalReverbShelf.type = "highshelf"
          globalReverbShelf.frequency.value = 800
          globalReverbShelf.gain.value = -6
          const globalReverbReturn = audioContextRef.current.createGain()
          globalReverbReturn.gain.value = GLOBAL_REVERB_RETURN_GAIN

          globalReverbSend.connect(globalReverbConvolver)
          globalReverbConvolver.connect(globalReverbShelf)
          globalReverbShelf.connect(globalReverbReturn)
          globalReverbReturn.connect(masterGainNode)
          globalReverbSendRef.current = globalReverbSend
          globalReverbConvolverRef.current = globalReverbConvolver

          const dynamicsCompressor = audioContextRef.current.createDynamicsCompressor()
          dynamicsCompressor.threshold.value = -1
          dynamicsCompressor.knee.value = 0
          dynamicsCompressor.ratio.value = 4
          dynamicsCompressor.attack.value = 0.003
          dynamicsCompressor.release.value = 0.25

          const preLeftAnalyser = audioContextRef.current.createAnalyser()
          const preRightAnalyser = audioContextRef.current.createAnalyser()
          const postLeftAnalyser = audioContextRef.current.createAnalyser()
          const postRightAnalyser = audioContextRef.current.createAnalyser()
          preLeftAnalyser.fftSize = 256
          preRightAnalyser.fftSize = 256
          postLeftAnalyser.fftSize = 256
          postRightAnalyser.fftSize = 256
          preLeftAnalyserRef.current = preLeftAnalyser
          preRightAnalyserRef.current = preRightAnalyser
          postLeftAnalyserRef.current = postLeftAnalyser
          postRightAnalyserRef.current = postRightAnalyser
          preLeftDataArrayRef.current = new Uint8Array(preLeftAnalyser.frequencyBinCount)
          preRightDataArrayRef.current = new Uint8Array(preRightAnalyser.frequencyBinCount)
          postLeftDataArrayRef.current = new Uint8Array(postLeftAnalyser.frequencyBinCount)
          postRightDataArrayRef.current = new Uint8Array(postRightAnalyser.frequencyBinCount)

          const preSplitter = audioContextRef.current.createChannelSplitter(2)
          const postSplitter = audioContextRef.current.createChannelSplitter(2)

          resonanceSceneRef.current.output.connect(masterGainNode)
          masterGainNode.connect(dynamicsCompressor)
          masterGainNode.connect(preSplitter)
          compressorRef.current = dynamicsCompressor
          dynamicsCompressor.connect(audioContextRef.current.destination)
          dynamicsCompressor.connect(postSplitter)
          preSplitter.connect(preLeftAnalyser, 0)
          preSplitter.connect(preRightAnalyser, 1)
          postSplitter.connect(postLeftAnalyser, 0)
          postSplitter.connect(postRightAnalyser, 1)

          resonanceSceneRef.current.setListenerPosition(0, 0, 0)
          console.log("[v0] Resonance Audio scene initialized with 18dB gain and limiter")
        }

        const planetAudioMap = {
          sun: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/01%20SUN%20ADN-J5pCD5YXQM03r4vktr2y5yUh3W7Jz4.mp3",
          moon: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/02%20MOON%20ADN-r0bDnTr3lRhOnV5lNFRDGPDocVBiSd.mp3",
          mercury: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/03%20MERCURY%20ADN-tEr5fQwvG8YwEAicwfsXbLOeRxW0id.mp3",
          venus: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/04%20VENUS%20ADN-v47D1k0TcHtR49kwHs7MAjkqPQIiMr.mp3",
          mars: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/05%20MARS%20ADN-oClVSlw80vrzmakuJsdtpUnWX4VTHg.mp3",
          jupiter: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/06%20JUPITER%20ADN-DMMtzeboD1m7HeiXKhjT5u47Oo61Pr.mp3",
          saturn: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/07%20SATURN%20ADN-f7b2UIOtjEzzFqVXefAShqNYROgBuy.mp3",
          uranus: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/08%20URANUS%20ADN-Io0XOWbtZuFDRjWLnbDGZ6dKe3nkOm.mp3",
          neptune: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/09%20NEPTUNE%20ADN-EwwPfIaUulNxd9IU3Gd31VCrWZFL1H.mp3",
          pluto: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/10%20PLUTO%20ADN-OhFEfWgCc2b4F9eEtzAvTNh0No6129.mp3",
        }

        const elementAudioMap = {
          fire: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/01%20FIRE-8eUGRrVxNyhSJ1b36TFi2k8M85hiup.mp3",
          earth: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/02%20EARTH-OcMQF04mhLvN00VAVJukOGlFOruvnP.mp3",
          air: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/03%20AIR-CU33ZNjx6mwjmMXUkdxAvKlOGk4B1t.mp3",
          water: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/04%20WATER-GNcvuoJGsQNHQkZ6Z8Ta7ww3Gtzb1P.mp3",
        }

        const tibetanSampleAudioMap = {
          bowl_low:
            "https://upload.wikimedia.org/wikipedia/commons/transcoded/1/17/Small_tibetan_singing_bowl.ogg/Small_tibetan_singing_bowl.ogg.mp3",
          bowl_mid:
            "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/25/SingingBowl1.ogg/SingingBowl1.ogg.mp3",
          bowl_high:
            "https://upload.wikimedia.org/wikipedia/commons/transcoded/6/64/SingingBowl2.ogg/SingingBowl2.ogg.mp3",
        }

        const allAudios = [
          ...Object.entries(planetAudioMap),
          ...Object.entries(elementAudioMap),
          ...Object.entries(tibetanSampleAudioMap),
        ]

        const audioLabels: Record<string, string> = {
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
          fire: "Fuego",
          earth: "Tierra",
          air: "Aire",
          water: "Agua",
          bowl_low: "Tibetan Bowl Low",
          bowl_mid: "Tibetan Bowl Mid",
          bowl_high: "Tibetan Bowl High",
        }

        let loadedCount = 0

        const loadAudioPromises = allAudios.map(async ([name, url]) => {
          try {
            setLoadingLabel(`Cargando ${audioLabels[name] || name}`)
            console.log(`[v0] Fetching audio: ${name} from URL: ${url}`)
            let response = await fetch(url, { mode: 'cors' })
            
            // If CORS fails, try without mode
            if (!response.ok) {
              console.log(`[v0] First fetch attempt failed with status ${response.status}, retrying...`)
              response = await fetch(url)
            }
            
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            console.log(`[v0] Downloaded ${name} - buffer size: ${arrayBuffer.byteLength} bytes`)

            if (arrayBuffer.byteLength === 0) {
              throw new Error("Empty audio file")
            }

            const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer)
            audioBuffersRef.current[name] = audioBuffer
            console.log(`[v0] Successfully loaded audio for ${name} - duration: ${audioBuffer.duration}s`)

            loadedCount++
            setLoadingProgress(Math.round((loadedCount / allAudios.length) * 100))
          } catch (error) {
            console.error(`[v0] Failed to load audio for ${name}:`, error)
            loadedCount++
            setLoadingProgress(Math.round((loadedCount / allAudios.length) * 100))
          }
        })

        await Promise.all(loadAudioPromises)

        backgroundBufferRef.current = null

        setLoadingLabel("Finalizando")
        setLoadingProgress(100)
      } catch (error) {
        console.error("[v0] Audio initialization failed:", error)
        setLoadingLabel("Listo")
        setLoadingProgress(100)
      }
    })()

    return initPromiseRef.current
  }, [])

  const prepareOrbitalStarBackground = useCallback(
    async (
      sunSignIndex: number | null = modalSunSignIndexRef.current,
      options?: {
        modalEnabled?: boolean
        force?: boolean
      },
    ): Promise<AudioBuffer | null> => {
      await initializeAudio()

      const ctx = audioContextRef.current
      if (!ctx) return null

      const normalizedSignIndex = typeof sunSignIndex === "number" ? mod12(sunSignIndex) : null
      const resolvedModalEnabled = options?.modalEnabled ?? modalEnabledRef.current
      const forceRender = options?.force ?? false

      if (
        !forceRender &&
        backgroundBufferRef.current &&
        backgroundSignIndexRef.current === normalizedSignIndex
      ) {
        return backgroundBufferRef.current
      }

      if (!forceRender && backgroundRenderPromiseRef.current && backgroundSignIndexRef.current === normalizedSignIndex) {
        return backgroundRenderPromiseRef.current
      }

      const requestId = backgroundRenderRequestIdRef.current + 1
      backgroundRenderRequestIdRef.current = requestId
      backgroundSignIndexRef.current = normalizedSignIndex

      const renderPromise = (async (): Promise<AudioBuffer | null> => {
        const liveCtx = audioContextRef.current
        if (!liveCtx) return null

        const sampleRate = liveCtx.sampleRate || 48000
        const totalFrames = Math.max(1, Math.ceil(ORBITAL_STAR_BACKGROUND_DURATION_SEC * sampleRate))
        const offlineContext = new OfflineAudioContext(2, totalFrames, sampleRate)

        const masterGainNode = offlineContext.createGain()
        masterGainNode.gain.setValueAtTime(0, 0)
        masterGainNode.gain.linearRampToValueAtTime(
          ORBITAL_STAR_BACKGROUND_RENDER_PEAK_GAIN,
          Math.min(ORBITAL_STAR_BACKGROUND_FADE_IN_SEC, ORBITAL_STAR_BACKGROUND_DURATION_SEC),
        )
        const fadeOutStartSec = Math.max(
          ORBITAL_STAR_BACKGROUND_FADE_IN_SEC,
          ORBITAL_STAR_BACKGROUND_DURATION_SEC - ORBITAL_STAR_BACKGROUND_FADE_OUT_SEC,
        )
        masterGainNode.gain.setValueAtTime(ORBITAL_STAR_BACKGROUND_RENDER_PEAK_GAIN, fadeOutStartSec)
        masterGainNode.gain.linearRampToValueAtTime(0, ORBITAL_STAR_BACKGROUND_DURATION_SEC)
        masterGainNode.connect(offlineContext.destination)

        const topRegencyPlanets = getTopRegencyPlanetsForSign(normalizedSignIndex)
        const tuningRate = centsToPlaybackRate(tuningCentsRef.current)
        let scheduledSources = 0

        topRegencyPlanets.forEach((planetName, index) => {
          const normalizedPlanetName = planetName.toLowerCase()
          const planetBuffer = audioBuffersRef.current[normalizedPlanetName]
          if (!planetBuffer) return

          const source = offlineContext.createBufferSource()
          source.buffer = planetBuffer
          source.loop = true

          const startOffsetSec = planetBuffer.duration > 30.1 ? 30 : 0
          if (planetBuffer.duration - startOffsetSec > 0.05) {
            source.loopStart = startOffsetSec
            source.loopEnd = planetBuffer.duration
          }

          const playbackRate =
            getPlanetPrincipalPlaybackRate(normalizedPlanetName, resolvedModalEnabled, normalizedSignIndex) * tuningRate
          source.playbackRate.setValueAtTime(Math.max(0.05, playbackRate), 0)

          const planetGainNode = offlineContext.createGain()
          planetGainNode.gain.value =
            ORBITAL_STAR_BACKGROUND_PLANET_GAIN_BY_INDEX[index] ??
            ORBITAL_STAR_BACKGROUND_PLANET_GAIN_BY_INDEX[ORBITAL_STAR_BACKGROUND_PLANET_GAIN_BY_INDEX.length - 1]

          const stereoPanner = offlineContext.createStereoPanner()
          stereoPanner.pan.value =
            ORBITAL_STAR_BACKGROUND_PAN_BY_INDEX[index] ??
            ORBITAL_STAR_BACKGROUND_PAN_BY_INDEX[ORBITAL_STAR_BACKGROUND_PAN_BY_INDEX.length - 1]

          source.connect(planetGainNode)
          planetGainNode.connect(stereoPanner)
          stereoPanner.connect(masterGainNode)

          const startSec = ORBITAL_STAR_BACKGROUND_STAGGER_SEC[index] ?? 0
          source.start(startSec, startOffsetSec)
          source.stop(ORBITAL_STAR_BACKGROUND_DURATION_SEC)
          scheduledSources += 1
        })

        if (scheduledSources === 0) {
          return null
        }

        const renderedBuffer = normalizeBufferPeak(await offlineContext.startRendering(), -1)
        if (backgroundRenderRequestIdRef.current !== requestId) return null

        backgroundBufferRef.current = renderedBuffer
        backgroundSignIndexRef.current = normalizedSignIndex
        return renderedBuffer
      })()

      backgroundRenderPromiseRef.current = renderPromise

      try {
        return await renderPromise
      } catch (error) {
        if (backgroundRenderRequestIdRef.current === requestId) {
          backgroundBufferRef.current = null
        }
        console.error("[v0] Error preparing orbital star background:", error)
        return null
      } finally {
        if (backgroundRenderPromiseRef.current === renderPromise) {
          backgroundRenderPromiseRef.current = null
        }
      }
    },
    [initializeAudio],
  )

  const playBackgroundSound = useCallback(async (
    options?: {
      sunSignIndex?: number | null
      modalEnabled?: boolean
      forceRegenerate?: boolean
    },
  ) => {
    await initializeAudio()
    const ctx = audioContextRef.current
    if (!ctx) return

    const requestedSignIndex =
      typeof options?.sunSignIndex === "number" ? mod12(options.sunSignIndex) : modalSunSignIndexRef.current
    const shouldForceRegenerate = options?.forceRegenerate ?? false
    let backgroundBuffer = backgroundBufferRef.current

    if (
      shouldForceRegenerate ||
      !backgroundBuffer ||
      backgroundSignIndexRef.current !== (typeof requestedSignIndex === "number" ? mod12(requestedSignIndex) : null)
    ) {
      backgroundBuffer = await prepareOrbitalStarBackground(requestedSignIndex, {
        modalEnabled: options?.modalEnabled,
        force: shouldForceRegenerate,
      })
    }

    if (!backgroundBuffer) {
      console.log("[v0] Orbital star background is not ready")
      return
    }

    if (backgroundSourceRef.current) {
      try {
        backgroundSourceRef.current.stop()
      } catch (e) {
        // Already stopped
      }
      backgroundSourceRef.current = null
    }
    backgroundGainRef.current = null

    try {
      backgroundGainRef.current = ctx.createGain()
      const targetGain = (backgroundVolumeRef.current ?? 0) / 100
      const now = ctx.currentTime
      backgroundGainRef.current.gain.setValueAtTime(0, now)
      backgroundGainRef.current.gain.linearRampToValueAtTime(targetGain, now + ORBITAL_STAR_BACKGROUND_FADE_IN_SEC)

      backgroundSourceRef.current = ctx.createBufferSource()
      backgroundSourceRef.current.buffer = backgroundBuffer
      backgroundSourceRef.current.loop = true

      backgroundSourceRef.current.connect(backgroundGainRef.current)
      const masterNode = masterGainNodeRef.current || ctx.destination
      backgroundGainRef.current.connect(masterNode)

      backgroundSourceRef.current.start(0)
      console.log("[v0] Background sound started")
    } catch (error) {
      console.error("[v0] Error playing background sound:", error)
    }
  }, [initializeAudio, prepareOrbitalStarBackground])

  const stopBackgroundSound = useCallback(() => {
    if (backgroundSourceRef.current && backgroundGainRef.current) {
      try {
        const ctx = audioContextRef.current
        if (!ctx) return

        const FADE_OUT_TIME = ORBITAL_STAR_BACKGROUND_FADE_OUT_SEC
        const currentTime = ctx.currentTime

        backgroundGainRef.current.gain.setValueAtTime(backgroundGainRef.current.gain.value, currentTime)
        backgroundGainRef.current.gain.linearRampToValueAtTime(0, currentTime + FADE_OUT_TIME)

        setTimeout(() => {
          if (backgroundSourceRef.current) {
            try {
              backgroundSourceRef.current.stop()
              backgroundSourceRef.current = null
              console.log("[v0] Background sound stopped after fade out")
            } catch (e) {
              // Already stopped
            }
          }
        }, FADE_OUT_TIME * 1000)
      } catch (error) {
        console.error("[v0] Error stopping background sound:", error)
      }
    }
  }, [])

  const playElementBackground = useCallback(
    async (
      primaryElement: "fire" | "earth" | "air" | "water",
      secondaryElement?: "fire" | "earth" | "air" | "water",
      crossfadeDelaySeconds = 0,
      crossfadeDurationSeconds = 30,
      pedalOptions?: { modalEnabled?: boolean; sunSignIndex?: number | null },
      gainOverridePercent?: number,
    ) => {
      await initializeAudio()

      const ctx = audioContextRef.current
      if (!ctx) return

      const primaryBuffer = audioBuffersRef.current[primaryElement]
      if (!primaryBuffer) {
        console.log(`[v0] No element buffer for ${primaryElement}`)
        return
      }

      if (elementBackgroundTimeoutRef.current) {
        clearTimeout(elementBackgroundTimeoutRef.current)
        elementBackgroundTimeoutRef.current = null
      }

      if (elementBackgroundSourceRef.current) {
        try {
          elementBackgroundSourceRef.current.stop()
        } catch (e) {
          // Already stopped
        }
      }
      if (elementBackgroundNextSourceRef.current) {
        try {
          elementBackgroundNextSourceRef.current.stop()
        } catch (e) {
          // Already stopped
        }
      }

      const elementGainPercent =
        typeof gainOverridePercent === "number"
          ? Math.max(0, Math.min(100, gainOverridePercent))
          : elementSoundVolumeRef.current
      const elementGain = elementGainPercent / 100
      if (elementGain <= 0) {
        return
      }
      const pedalModalEnabled = pedalOptions?.modalEnabled ?? modalEnabledRef.current
      const pedalSunSignIndex =
        typeof pedalOptions?.sunSignIndex === "number" ? pedalOptions.sunSignIndex : modalSunSignIndexRef.current
      const rulerPlanetName = getSignRulerPlanetName(pedalSunSignIndex)
      const pedalBasePlaybackRate = getPlanetPrincipalPlaybackRate(rulerPlanetName, pedalModalEnabled, pedalSunSignIndex)
      const pedalTunedPlaybackRate = pedalBasePlaybackRate * centsToPlaybackRate(tuningCentsRef.current)

      const primaryGain = ctx.createGain()
      primaryGain.gain.value = elementGain

      const primarySource = ctx.createBufferSource()
      primarySource.buffer = primaryBuffer
      primarySource.loop = true
      primarySource.playbackRate.value = pedalTunedPlaybackRate

      primarySource.connect(primaryGain)
      const masterNode = masterGainNodeRef.current || ctx.destination
      primaryGain.connect(masterNode)
      primarySource.start(0)

      elementBackgroundSourceRef.current = primarySource
      elementBackgroundGainRef.current = primaryGain
      elementBackgroundNextSourceRef.current = null
      elementBackgroundNextGainRef.current = null

      if (secondaryElement) {
        const secondaryBuffer = audioBuffersRef.current[secondaryElement]
        if (!secondaryBuffer) {
          console.log(`[v0] No element buffer for ${secondaryElement}`)
          return
        }

        const startTime = ctx.currentTime + Math.max(0, crossfadeDelaySeconds)

        const secondaryGain = ctx.createGain()
        secondaryGain.gain.setValueAtTime(0, startTime)
        secondaryGain.gain.linearRampToValueAtTime(elementGain, startTime + crossfadeDurationSeconds)

        const secondarySource = ctx.createBufferSource()
        secondarySource.buffer = secondaryBuffer
        secondarySource.loop = true
        secondarySource.playbackRate.value = pedalTunedPlaybackRate
        secondarySource.connect(secondaryGain)
        const masterNode = masterGainNodeRef.current || ctx.destination
        secondaryGain.connect(masterNode)
        secondarySource.start(startTime)

        primaryGain.gain.setValueAtTime(primaryGain.gain.value, startTime)
        primaryGain.gain.linearRampToValueAtTime(0, startTime + crossfadeDurationSeconds)

        elementBackgroundNextSourceRef.current = secondarySource
        elementBackgroundNextGainRef.current = secondaryGain

        elementBackgroundTimeoutRef.current = setTimeout(() => {
          try {
            primarySource.stop()
          } catch (e) {
            // Already stopped
          }
          elementBackgroundSourceRef.current = secondarySource
          elementBackgroundGainRef.current = secondaryGain
          elementBackgroundNextSourceRef.current = null
          elementBackgroundNextGainRef.current = null
        }, (crossfadeDelaySeconds + crossfadeDurationSeconds) * 1000)
      }
    },
    [initializeAudio],
  )

  const stopElementBackground = useCallback(() => {
    const ctx = audioContextRef.current
    if (!ctx) return

    const FADE_OUT_TIME = 5
    const currentTime = ctx.currentTime

    if (elementBackgroundGainRef.current) {
      elementBackgroundGainRef.current.gain.setValueAtTime(elementBackgroundGainRef.current.gain.value, currentTime)
      elementBackgroundGainRef.current.gain.linearRampToValueAtTime(0, currentTime + FADE_OUT_TIME)
    }
    if (elementBackgroundNextGainRef.current) {
      elementBackgroundNextGainRef.current.gain.setValueAtTime(
        elementBackgroundNextGainRef.current.gain.value,
        currentTime,
      )
      elementBackgroundNextGainRef.current.gain.linearRampToValueAtTime(0, currentTime + FADE_OUT_TIME)
    }

    setTimeout(() => {
      if (elementBackgroundSourceRef.current) {
        try {
          elementBackgroundSourceRef.current.stop()
        } catch (e) {
          // Already stopped
        }
        elementBackgroundSourceRef.current = null
      }
      if (elementBackgroundNextSourceRef.current) {
        try {
          elementBackgroundNextSourceRef.current.stop()
        } catch (e) {
          // Already stopped
        }
        elementBackgroundNextSourceRef.current = null
      }
      elementBackgroundGainRef.current = null
      elementBackgroundNextGainRef.current = null
    }, FADE_OUT_TIME * 1000)
  }, [])

  const buildOfflinePlaybackCacheKey = useCallback((options: OfflineMp3RenderOptions): string => {
    return JSON.stringify({
      audioMode: audioEngineModeRef.current || "samples",
      durationSec: roundOfflineKeyValue(options.durationSec),
      masterVolumePercent: roundOfflineKeyValue(options.masterVolumePercent),
      tuningCents: roundOfflineKeyValue(
        typeof options.tuningCents === "number" ? options.tuningCents : tuningCentsRef.current,
      ),
      modalEnabled: options.modalEnabled ?? modalEnabledRef.current,
      modalSunSignIndex:
        typeof options.modalSunSignIndex === "number" ? options.modalSunSignIndex : modalSunSignIndexRef.current,
      includeBackground: options.includeBackground ?? false,
      backgroundVolumePercent: roundOfflineKeyValue(options.backgroundVolumePercent ?? backgroundVolumeRef.current),
      includeElement: options.includeElement ?? false,
      elementName: options.elementName ?? null,
      elementVolumePercent: roundOfflineKeyValue(options.elementVolumePercent ?? elementSoundVolumeRef.current),
      isChordMode: options.isChordMode ?? false,
      reverbMixPercent: roundOfflineKeyValue(options.reverbMixPercent ?? reverbMixPercentRef.current),
      synthVolume: roundOfflineKeyValue(synthVolumeRef.current),
      events: (options.events || []).map((event) => ({
        planetName: event.planetName.toLowerCase(),
        angleDeg: roundOfflineKeyValue(event.angleDeg),
        declinationDeg: roundOfflineKeyValue(event.declinationDeg),
        startSec: roundOfflineKeyValue(event.startSec),
        fadeInSec: roundOfflineKeyValue(event.fadeInSec),
        fadeOutSec: roundOfflineKeyValue(event.fadeOutSec),
        aspectFadeInSec: roundOfflineKeyValue(event.aspectFadeInSec ?? dynAspectsFadeInRef.current),
        aspectSustainSec: roundOfflineKeyValue(event.aspectSustainSec ?? dynAspectsSustainRef.current),
        aspectFadeOutSec: roundOfflineKeyValue(event.aspectFadeOutSec ?? dynAspectsFadeOutRef.current),
        aspectVolumePercent: roundOfflineKeyValue(event.aspectVolumePercent ?? aspectsSoundVolumeRef.current),
        aspects: (event.aspects || []).map((aspect) => ({
          planetName: aspect.planetName.toLowerCase(),
          angleDeg: roundOfflineKeyValue(aspect.angleDeg),
          declinationDeg: roundOfflineKeyValue(aspect.declinationDeg),
          aspectType: aspect.aspectType,
        })),
      })),
    })
  }, [])

  const mixOfflineBuffers = useCallback(
    async (buffers: Array<AudioBuffer | null>): Promise<AudioBuffer | null> => {
      const validBuffers = buffers.filter((buffer): buffer is AudioBuffer => Boolean(buffer))
      if (validBuffers.length === 0) return null

      await initializeAudio()
      const ctx = audioContextRef.current
      if (!ctx) return null

      const sampleRate = validBuffers[0].sampleRate || ctx.sampleRate || 48000
      const length = validBuffers.reduce((maxLength, buffer) => Math.max(maxLength, buffer.length), 0)
      const mixedBuffer = ctx.createBuffer(2, length, sampleRate)

      for (let channel = 0; channel < 2; channel += 1) {
        const output = mixedBuffer.getChannelData(channel)
        validBuffers.forEach((buffer) => {
          const sourceChannelIndex = Math.min(channel, buffer.numberOfChannels - 1)
          const source = buffer.getChannelData(sourceChannelIndex)
          for (let index = 0; index < source.length; index += 1) {
            output[index] += source[index]
          }
        })

        for (let index = 0; index < output.length; index += 1) {
          output[index] = Math.max(-1, Math.min(1, output[index]))
        }
      }

      return mixedBuffer
    },
    [initializeAudio],
  )

  const stopOfflinePlayback = useCallback(() => {
    const source = activeOfflinePlaybackSourceRef.current
    const gain = activeOfflinePlaybackGainRef.current
    const ctx = audioContextRef.current
    if (source || gain) {
      rampGainToZeroAndStop(source ?? null, gain ?? null, ctx ?? null, 40)
    }
    activeOfflinePlaybackSourceRef.current = null
    activeOfflinePlaybackGainRef.current = null
    activeOfflinePlaybackStartedAtRef.current = 0
    activeOfflinePlaybackOffsetSecRef.current = 0
    activeOfflinePlaybackDurationSecRef.current = 0
  }, [])

  const getOfflinePlaybackElapsedSec = useCallback(() => {
    const ctx = audioContextRef.current
    if (!ctx || !activeOfflinePlaybackSourceRef.current) {
      return activeOfflinePlaybackOffsetSecRef.current
    }

    const elapsed = activeOfflinePlaybackOffsetSecRef.current + Math.max(0, ctx.currentTime - activeOfflinePlaybackStartedAtRef.current)
    return Math.min(activeOfflinePlaybackDurationSecRef.current, elapsed)
  }, [])

  const renderOfflineSampleBuffer = useCallback(
    async (
      options: OfflineMp3RenderOptions,
      renderAudioMode: "samples" | "tibetan_samples",
      includePlanetEvents = true,
    ): Promise<AudioBuffer | null> => {
      const durationSec = Math.max(0.5, options.durationSec)
      // [T-30-b] Apply user phase toggles. Each "effective*" flag is
      // the AND of the per-call option and the global phase. This
      // keeps the rest of the function untouched: it just consults
      // effective* instead of options.include* in three places below.
      const phases = renderPhasesRef.current
      const effectivePlanetEvents = includePlanetEvents && phases.planets
      const effectiveBackground = Boolean(options.includeBackground) && phases.background
      const effectiveElement = Boolean(options.includeElement) && phases.element
      const hasPlanetEvents = effectivePlanetEvents && Boolean(options.events?.length)
      const hasAmbientLayers = Boolean(effectiveBackground || (effectiveElement && options.elementName))
      if (!hasPlanetEvents && !hasAmbientLayers) return null

      try {
        await initializeAudio()
        const liveContext = audioContextRef.current
        if (!liveContext) return null

        const sampleRate = 48000
        const totalFrames = Math.max(1, Math.ceil(durationSec * sampleRate))
        const offlineContext = new OfflineAudioContext(2, totalFrames, sampleRate)

        const masterGainNode = offlineContext.createGain()
        const baseGain = Math.pow(10, 18 / 20) // [T-36] 18 dB pre-amp (recortado desde 28 dB)
        masterGainNode.gain.value = baseGain * Math.max(0, options.masterVolumePercent / 100)

        const dynamicsCompressor = offlineContext.createDynamicsCompressor()
        dynamicsCompressor.threshold.value = -1
        dynamicsCompressor.knee.value = 0
        dynamicsCompressor.ratio.value = 4
        dynamicsCompressor.attack.value = 0.003
        dynamicsCompressor.release.value = 0.25
        masterGainNode.connect(dynamicsCompressor)
        dynamicsCompressor.connect(offlineContext.destination)

        const isChordMode = options.isChordMode ?? false
        const reverbDecaySeconds = getReverbDecaySeconds(isChordMode)
        const fallbackReverbWetMix = getReverbWetMix(
          isChordMode,
          reverbMixPercentRef.current,
          chordReverbMixPercentRef.current,
        )
        const reverbWetMix =
          typeof options.reverbMixPercent === "number"
            ? Math.max(0, Math.min(1, options.reverbMixPercent / 100))
            : fallbackReverbWetMix
        const impulseBuffer = createLowDiffusionReverbImpulse(offlineContext, reverbDecaySeconds)
        const globalReverbSend = offlineContext.createGain()
        globalReverbSend.gain.value = 1
        const globalReverbConvolver = offlineContext.createConvolver()
        globalReverbConvolver.buffer = impulseBuffer
        const globalReverbShelf = offlineContext.createBiquadFilter()
        globalReverbShelf.type = "highshelf"
        globalReverbShelf.frequency.value = 800
        globalReverbShelf.gain.value = -6
        const globalReverbReturn = offlineContext.createGain()
        globalReverbReturn.gain.value = GLOBAL_REVERB_RETURN_GAIN
        globalReverbSend.connect(globalReverbConvolver)
        globalReverbConvolver.connect(globalReverbShelf)
        globalReverbShelf.connect(globalReverbReturn)
        globalReverbReturn.connect(masterGainNode)

        const tuningRate = centsToPlaybackRate(
          typeof options.tuningCents === "number" ? options.tuningCents : tuningCentsRef.current,
        )
        const modalEnabled = options.modalEnabled ?? modalEnabledRef.current
        const modalSunSignIndex =
          typeof options.modalSunSignIndex === "number"
            ? options.modalSunSignIndex
            : modalSunSignIndexRef.current

        let orbitalStarBackgroundBuffer: AudioBuffer | null = null
        if (effectiveBackground) {
          orbitalStarBackgroundBuffer = await prepareOrbitalStarBackground(modalSunSignIndex, {
            modalEnabled,
            force: false,
          })
        }

        const resolveBufferKey = (name: string) =>
          renderAudioMode === "tibetan_samples" ? getTibetanSampleKey(name) : name.toLowerCase()

        const scheduleSample = (params: {
          bufferKey: string
          startSec: number
          angleDeg: number
          declinationDeg: number
          fadeInSec: number
          sustainSec: number
          fadeOutSec: number
          peakGain: number
          playbackRate: number
        }) => {
          const buffer = audioBuffersRef.current[params.bufferKey]
          if (!buffer) return

          const startTime = Math.max(0, params.startSec)
          if (startTime >= durationSec) return

          const source = offlineContext.createBufferSource()
          source.buffer = buffer
          source.playbackRate.setValueAtTime(Math.max(0.05, params.playbackRate), startTime)

          const gainNode = offlineContext.createGain()
          const dryGainNode = offlineContext.createGain()
          const wetSendGainNode = offlineContext.createGain()
          dryGainNode.gain.value = Math.max(0, 1 - reverbWetMix)
          wetSendGainNode.gain.value = reverbWetMix

          const panner = offlineContext.createPanner()
          panner.panningModel = "HRTF"
          panner.distanceModel = "inverse"
          panner.refDistance = 1
          panner.maxDistance = 50
          panner.rolloffFactor = 1
          const elevation = params.declinationDeg * 5
          const position = polarToCartesian3D(params.angleDeg, elevation)
          if (typeof panner.positionX !== "undefined") {
            panner.positionX.setValueAtTime(position.x, startTime)
            panner.positionY.setValueAtTime(position.y, startTime)
            panner.positionZ.setValueAtTime(position.z, startTime)
          } else {
            panner.setPosition(position.x, position.y, position.z)
          }

          source.connect(gainNode)
          gainNode.connect(panner)
          panner.connect(dryGainNode)
          panner.connect(wetSendGainNode)
          dryGainNode.connect(masterGainNode)
          wetSendGainNode.connect(globalReverbSend)

          const startOffsetSec = renderAudioMode === "tibetan_samples" ? 0 : 30
          const availableDurationSec = Math.max(
            0,
            (buffer.duration - startOffsetSec) / Math.max(0.05, params.playbackRate),
          )
          if (availableDurationSec <= 0) return

          const fadeInSec = Math.max(0.01, params.fadeInSec)
          const sustainSec = Math.max(0, params.sustainSec)
          const fadeOutSec = Math.max(0.01, params.fadeOutSec)
          const requestedDurationSec = fadeInSec + sustainSec + fadeOutSec
          const maxRemainingSec = Math.max(0.01, durationSec - startTime)
          const effectiveDurationSec = Math.min(requestedDurationSec, availableDurationSec, maxRemainingSec)
          const endTime = startTime + effectiveDurationSec
          const fadeInEnd = Math.min(endTime, startTime + fadeInSec)
          const sustainEnd = Math.min(endTime, fadeInEnd + sustainSec)

          gainNode.gain.setValueAtTime(0, startTime)
          gainNode.gain.linearRampToValueAtTime(params.peakGain, fadeInEnd)
          gainNode.gain.setValueAtTime(params.peakGain, sustainEnd)
          gainNode.gain.linearRampToValueAtTime(0, endTime)

          source.start(startTime, startOffsetSec)
          source.stop(endTime)
        }

        if (effectiveBackground && orbitalStarBackgroundBuffer) {
          const backgroundSource = offlineContext.createBufferSource()
          const backgroundGainNode = offlineContext.createGain()
          const backgroundTargetGain = Math.max(0, (options.backgroundVolumePercent ?? backgroundVolumeRef.current) / 100)
          const backgroundFadeInSec = Math.max(0.01, Math.min(ORBITAL_STAR_BACKGROUND_FADE_IN_SEC, durationSec))
          const backgroundFadeOutSec = Math.max(0.01, Math.min(ORBITAL_STAR_BACKGROUND_FADE_OUT_SEC, durationSec))
          const backgroundFadeOutStart = Math.max(backgroundFadeInSec, durationSec - backgroundFadeOutSec)

          backgroundSource.buffer = orbitalStarBackgroundBuffer
          backgroundSource.loop = true

          backgroundGainNode.gain.setValueAtTime(0, 0)
          backgroundGainNode.gain.linearRampToValueAtTime(backgroundTargetGain, backgroundFadeInSec)
          backgroundGainNode.gain.setValueAtTime(backgroundTargetGain, backgroundFadeOutStart)
          backgroundGainNode.gain.linearRampToValueAtTime(0, durationSec)

          backgroundSource.connect(backgroundGainNode)
          backgroundGainNode.connect(masterGainNode)
          backgroundSource.start(0)
          backgroundSource.stop(durationSec)
        }

        if (effectiveElement && options.elementName) {
          const elementBuffer = audioBuffersRef.current[options.elementName]
          if (elementBuffer) {
            const rulerPlanet = getSignRulerPlanetName(modalSunSignIndex)
            const elementPlaybackRate =
              getPlanetPrincipalPlaybackRate(rulerPlanet, modalEnabled, modalSunSignIndex) * tuningRate
            const elementSource = offlineContext.createBufferSource()
            const elementGainNode = offlineContext.createGain()
            elementSource.buffer = elementBuffer
            elementSource.loop = true
            elementSource.playbackRate.value = elementPlaybackRate
            elementGainNode.gain.value = Math.max(0, (options.elementVolumePercent ?? elementSoundVolumeRef.current) / 100)
            elementSource.connect(elementGainNode)
            elementGainNode.connect(masterGainNode)
            elementSource.start(0)
            elementSource.stop(durationSec)
          }
        }

        if (hasPlanetEvents) {
          for (const event of options.events) {
            const planetName = event.planetName.toLowerCase()
            const principalPlaybackRate =
              getPlanetPrincipalPlaybackRate(planetName, modalEnabled, modalSunSignIndex) * tuningRate
            const principalPeakGain =
              getPlanetVolumeMultiplier(planetName) * (renderAudioMode === "tibetan_samples" ? 0.92 : 1)

            scheduleSample({
              bufferKey: resolveBufferKey(planetName),
              startSec: event.startSec,
              angleDeg: event.angleDeg,
              declinationDeg: event.declinationDeg,
              fadeInSec: event.fadeInSec,
              sustainSec: 0,
              fadeOutSec: event.fadeOutSec,
              peakGain: principalPeakGain,
              playbackRate: principalPlaybackRate,
            })

            const aspectFadeInSec = Math.max(0.01, event.aspectFadeInSec ?? dynAspectsFadeInRef.current)
            const aspectSustainSec = Math.max(0, event.aspectSustainSec ?? dynAspectsSustainRef.current)
            const aspectFadeOutSec = Math.max(0.01, event.aspectFadeOutSec ?? dynAspectsFadeOutRef.current)
            const aspectVolumePercent = Math.max(0, event.aspectVolumePercent ?? aspectsSoundVolumeRef.current)

            for (const aspect of event.aspects || []) {
              const aspectPlanetName = aspect.planetName.toLowerCase()
              const aspectSemitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? 0
              const aspectTransposeRate = Math.pow(2, aspectSemitoneOffset / 12)
              const aspectPlaybackRate = principalPlaybackRate * aspectTransposeRate
              const aspectPeakGain =
                0.33 *
                (aspectVolumePercent / 100) *
                getPlanetVolumeMultiplier(aspectPlanetName) *
                (renderAudioMode === "tibetan_samples" ? 0.9 : 1)

              scheduleSample({
                bufferKey: resolveBufferKey(aspectPlanetName),
                startSec: event.startSec,
                angleDeg: aspect.angleDeg,
                declinationDeg: aspect.declinationDeg,
                fadeInSec: aspectFadeInSec,
                sustainSec: aspectSustainSec,
                fadeOutSec: aspectFadeOutSec,
                peakGain: aspectPeakGain,
                playbackRate: aspectPlaybackRate,
              })
            }
          }
        }

        // [T-30-b] Per-layer peak normalize, gated by phases.normalizePerLayer.
        // [T-36] Skip the normalize when the buffer is AMBIENT-ONLY
        // (no planet events). Otherwise the bg/element peak gets
        // pushed to -1 dBFS, which made the bg/element faders feel
        // dead in fm_pad mode and when the user disables the
        // "planets" phase. With ambient-only buffers we now return
        // the raw render, letting the faders set the absolute level.
        const renderedSampleBuffer = await offlineContext.startRendering()
        const shouldNormalize = phases.normalizePerLayer && hasPlanetEvents
        return shouldNormalize
          ? normalizeBufferPeak(renderedSampleBuffer, -1)
          : renderedSampleBuffer
      } catch (error) {
        console.error("[v0] Error rendering offline sample buffer:", error)
        return null
      }
    },
    [initializeAudio, prepareOrbitalStarBackground],
  )

  const renderOfflineFmPadBuffer = useCallback(async (options: OfflineMp3RenderOptions): Promise<AudioBuffer | null> => {
    const durationSec = Math.max(0.5, options.durationSec)
    if (!options.events || options.events.length === 0) return null

    try {
      const Tone = toneModuleRef.current || (await import("tone"))
      toneModuleRef.current = Tone

      const toneBuffer = await Tone.Offline(async () => {
        const synth = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 1.8,
          modulationIndex: 6,
          oscillator: { type: "sine" },
          envelope: {
            attack: 0.9,
            decay: 0.8,
            sustain: 0.65,
            release: 3.2,
          },
          modulation: { type: "triangle" },
          modulationEnvelope: {
            attack: 1.2,
            decay: 1.0,
            sustain: 0.55,
            release: 2.6,
          },
        })
        synth.volume.value = -8
        ;(synth as any).maxPolyphony = 16

        const filter = new Tone.Filter({ type: "lowpass", frequency: 2200, rolloff: -24 })
        const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 2.2, depth: 0.25, wet: 0.22 }).start()
        const reverb = new Tone.Reverb({ decay: 3, preDelay: 0.008, wet: 0.2 })
        await reverb.generate()
        const reverbShelf = new Tone.Filter({ type: "highshelf", frequency: 800, gain: -6 })
        const gain = new Tone.Gain(getFmPadGainValue(options.masterVolumePercent, synthVolumeRef.current))

        synth.connect(filter)
        filter.connect(chorus)
        chorus.connect(reverb)
        reverb.connect(reverbShelf)
        reverbShelf.connect(gain)
        gain.toDestination()

        const tunedRate = centsToPlaybackRate(
          typeof options.tuningCents === "number" ? options.tuningCents : tuningCentsRef.current,
        )
        const pitchShiftFromTuning = 12 * Math.log2(tunedRate)
        const modalEnabled = options.modalEnabled ?? modalEnabledRef.current
        const modalSunSignIndex =
          typeof options.modalSunSignIndex === "number"
            ? options.modalSunSignIndex
            : modalSunSignIndexRef.current

        options.events.forEach((event) => {
          const normalizedPlanetName = event.planetName.toLowerCase()
          const principalSemitoneOffset = getPlanetPrincipalSemitoneOffset(
            normalizedPlanetName,
            modalEnabled,
            modalSunSignIndex,
          )
          const baseMidi =
            60 +
            principalSemitoneOffset +
            DEFAULT_SYSTEM_OCTAVE_SHIFT_SEMITONES +
            FM_PAD_OCTAVE_SHIFT_SEMITONES +
            pitchShiftFromTuning
          const principalDuration = Math.max(0.8, event.fadeInSec + event.fadeOutSec)
          const principalNote = Tone.Frequency(baseMidi, "midi").toNote()
          synth.triggerAttackRelease(principalNote, principalDuration, event.startSec)

          const aspectVolume =
            typeof event.aspectVolumePercent === "number" ? event.aspectVolumePercent : aspectsSoundVolumeRef.current
          const aspectGainFactor = Math.max(0.1, Math.min(1, aspectVolume / 100))
          const aspectDuration = Math.max(
            0.6,
            (event.aspectFadeInSec ?? dynAspectsFadeInRef.current) +
              (event.aspectSustainSec ?? dynAspectsSustainRef.current) +
              (event.aspectFadeOutSec ?? dynAspectsFadeOutRef.current),
          )

          ;(event.aspects || []).forEach((aspect, aspectIndex) => {
            const semitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? null
            if (semitoneOffset === null) return

            const aspectMidi = baseMidi + semitoneOffset
            const aspectNote = Tone.Frequency(aspectMidi, "midi").toNote()
            const velocity = Math.max(0.08, Math.min(0.7, 0.45 * aspectGainFactor))
            synth.triggerAttackRelease(aspectNote, aspectDuration, event.startSec + aspectIndex * 0.03, velocity)
          })
        })
      }, durationSec, 2, 48000)

      return toneBuffer.get() ?? null
    } catch (error) {
      console.error("[v0] Error rendering offline FM pad buffer:", error)
      return null
    }
  }, [])

  const prepareOfflinePlayback = useCallback(
    async (options: OfflineMp3RenderOptions): Promise<PreparedOfflinePlayback | null> => {
      const hasPlanetEvents = Boolean(options.events?.length)
      const hasAmbientLayers = Boolean(options.includeBackground || (options.includeElement && options.elementName))
      if (!hasPlanetEvents && !hasAmbientLayers) return null

      const cacheKey = buildOfflinePlaybackCacheKey(options)
      const cachedBuffer = offlinePlaybackCacheRef.current.get(cacheKey)
      if (cachedBuffer) {
        return {
          buffer: cachedBuffer,
          durationSec: cachedBuffer.duration,
          renderMs: 0,
          fromCache: true,
        }
      }

      const pendingRender = offlinePlaybackPromiseCacheRef.current.get(cacheKey)
      if (pendingRender) {
        const startedAt = performance.now()
        const buffer = await pendingRender
        if (!buffer) return null
        return {
          buffer,
          durationSec: buffer.duration,
          renderMs: performance.now() - startedAt,
          fromCache: false,
        }
      }

      const renderStartedAt = performance.now()
      const renderPromise = (async () => {
        const audioMode = audioEngineModeRef.current || "samples"
        const phases = renderPhasesRef.current

        // [T-30-b] Gate per-phase. When fmPad is OFF in fm_pad/hybrid
        // modes we still need the ambient/samples buffer so playback
        // is not empty. When renormalizeMix is ON we apply a final
        // peak-normalize after the mix.
        const finalize = async (buffer: AudioBuffer | null): Promise<AudioBuffer | null> => {
          if (!buffer) return null
          if (phases.renormalizeMix) return normalizeBufferPeak(buffer, -1)
          return buffer
        }

        if (audioMode === "fm_pad") {
          const [ambientBuffer, synthBuffer] = await Promise.all([
            renderOfflineSampleBuffer(options, "samples", false),
            phases.fmPad ? renderOfflineFmPadBuffer(options) : Promise.resolve(null),
          ])
          if (!ambientBuffer && !synthBuffer) return null
          if (!synthBuffer) return await finalize(ambientBuffer)
          if (!ambientBuffer) return await finalize(synthBuffer)
          return await finalize(await mixOfflineBuffers([ambientBuffer, synthBuffer]))
        }

        if (audioMode === "hybrid") {
          const [sampleBuffer, synthBuffer] = await Promise.all([
            renderOfflineSampleBuffer(options, "samples", true),
            phases.fmPad ? renderOfflineFmPadBuffer(options) : Promise.resolve(null),
          ])
          if (!sampleBuffer && !synthBuffer) return null
          if (!synthBuffer) return await finalize(sampleBuffer)
          if (!sampleBuffer) return await finalize(synthBuffer)
          return await finalize(await mixOfflineBuffers([sampleBuffer, synthBuffer]))
        }

        if (audioMode === "tibetan_samples") {
          return await finalize(await renderOfflineSampleBuffer(options, "tibetan_samples", true))
        }

        return await finalize(await renderOfflineSampleBuffer(options, "samples", true))
      })()

      offlinePlaybackPromiseCacheRef.current.set(cacheKey, renderPromise)

      try {
        const buffer = await renderPromise
        if (!buffer) return null

        offlinePlaybackCacheRef.current.set(cacheKey, buffer)
        return {
          buffer,
          durationSec: buffer.duration,
          renderMs: performance.now() - renderStartedAt,
          fromCache: false,
        }
      } finally {
        if (offlinePlaybackPromiseCacheRef.current.get(cacheKey) === renderPromise) {
          offlinePlaybackPromiseCacheRef.current.delete(cacheKey)
        }
      }
    },
    [buildOfflinePlaybackCacheKey, mixOfflineBuffers, renderOfflineFmPadBuffer, renderOfflineSampleBuffer],
  )

  const startOfflinePlayback = useCallback(
    async (options: OfflineMp3RenderOptions, startOffsetSec = 0): Promise<PreparedOfflinePlayback | null> => {
      await initializeAudio()
      const ctx = audioContextRef.current
      if (!ctx) return null

      if (ctx.state === "suspended") {
        await ctx.resume()
      }

      const prepared = await prepareOfflinePlayback(options)
      if (!prepared) return null

      stopOfflinePlayback()

      const safeOffsetSec = Math.max(0, Math.min(startOffsetSec, Math.max(0, prepared.durationSec - 0.05)))
      const source = ctx.createBufferSource()
      const gainNode = ctx.createGain()
      gainNode.gain.value = 1
      source.buffer = prepared.buffer
      source.connect(gainNode)

      // [T-30-b] Optional transparent final compressor (ratio 1.2:1).
      // Inserted in the live-playback chain when phases.finalCompression
      // is ON. Designed to be near-inaudible: only catches sharp peaks,
      // soft knee, gentle attack/release. Bypasses to direct destination
      // when OFF. No cache invalidation: this is post-buffer.
      if (renderPhasesRef.current.finalCompression) {
        const finalCompressor = ctx.createDynamicsCompressor()
        finalCompressor.threshold.value = -6
        finalCompressor.knee.value = 40
        finalCompressor.ratio.value = 1.2
        finalCompressor.attack.value = 0.010
        finalCompressor.release.value = 0.200
        gainNode.connect(finalCompressor)
        finalCompressor.connect(ctx.destination)
      } else {
        gainNode.connect(ctx.destination)
      }

      source.onended = () => {
        if (activeOfflinePlaybackSourceRef.current === source) {
          activeOfflinePlaybackSourceRef.current = null
          activeOfflinePlaybackGainRef.current = null
          activeOfflinePlaybackStartedAtRef.current = 0
          activeOfflinePlaybackOffsetSecRef.current = 0
          activeOfflinePlaybackDurationSecRef.current = 0
        }
      }

      activeOfflinePlaybackSourceRef.current = source
      activeOfflinePlaybackGainRef.current = gainNode
      activeOfflinePlaybackStartedAtRef.current = ctx.currentTime
      activeOfflinePlaybackOffsetSecRef.current = safeOffsetSec
      activeOfflinePlaybackDurationSecRef.current = prepared.durationSec

      source.start(0, safeOffsetSec)
      return {
        ...prepared,
        durationSec: prepared.durationSec,
      }
    },
    [initializeAudio, prepareOfflinePlayback, stopOfflinePlayback],
  )

  const initializeFmPadSynth = useCallback(async () => {
    if (fmPadSynthRef.current && toneModuleRef.current) {
      return
    }

    const Tone = await import("tone")
    toneModuleRef.current = Tone

    await Tone.start()

    // Larger scheduling buffer to reduce crackles/dropouts on FM pad bursts.
    const toneContext: any = Tone.getContext?.() ?? (Tone as any).context
    if (toneContext) {
      try {
        toneContext.lookAhead = 0.25
        toneContext.updateInterval = 0.05
        toneContext.latencyHint = "playback"
      } catch (e) {
        // ignore context tuning issues
      }
    }

    const synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.8,
      modulationIndex: 6,
      oscillator: { type: "sine" },
      envelope: {
        attack: 0.9,
        decay: 0.8,
        sustain: 0.65,
        release: 3.2,
      },
      modulation: { type: "triangle" },
      modulationEnvelope: {
        attack: 1.2,
        decay: 1.0,
        sustain: 0.55,
        release: 2.6,
      },
    })
    synth.volume.value = -8
    ;(synth as any).maxPolyphony = 12

    const filter = new Tone.Filter({ type: "lowpass", frequency: 2200, rolloff: -24 })
    const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 2.2, depth: 0.25, wet: 0.22 }).start()
    const reverb = new Tone.Reverb({ decay: 3, preDelay: 0.008, wet: 0.2 })
    await reverb.generate()
    const reverbShelf = new Tone.Filter({ type: "highshelf", frequency: 800, gain: -6 })

    const gain = new Tone.Gain(getFmPadGainValue(masterVolumeRef.current, synthVolumeRef.current))

    synth.connect(filter)
    filter.connect(chorus)
    chorus.connect(reverb)
    reverb.connect(reverbShelf)
    reverbShelf.connect(gain)
    gain.toDestination()

    fmPadSynthRef.current = synth
    fmPadGainRef.current = gain
  }, [])

  const triggerFmPadNotes = useCallback(
    async (
      principalSemitoneOffset: number,
      aspects: any[] = [],
      aspectVolumeOverride?: number,
    ) => {
      await initializeFmPadSynth()
      if (!toneModuleRef.current || !fmPadSynthRef.current) return

      const Tone = toneModuleRef.current
      const synth = fmPadSynthRef.current
      const tunedRate = centsToPlaybackRate(tuningCentsRef.current)
      const pitchShiftFromTuning = 12 * Math.log2(tunedRate)
      const baseMidi =
        60 +
        principalSemitoneOffset +
        DEFAULT_SYSTEM_OCTAVE_SHIFT_SEMITONES +
        FM_PAD_OCTAVE_SHIFT_SEMITONES +
        pitchShiftFromTuning

      const principalDuration = Math.max(
        0.8,
        (Number.isFinite(envelope.fadeIn) ? envelope.fadeIn : 7) + (Number.isFinite(envelope.fadeOut) ? envelope.fadeOut : 7),
      )
      const principalNote = Tone.Frequency(baseMidi, "midi").toNote()
      synth.triggerAttackRelease(principalNote, principalDuration)

      if (!aspects || aspects.length === 0) return

      const aspectVolume =
        typeof aspectVolumeOverride === "number" ? aspectVolumeOverride : aspectsSoundVolumeRef.current
      const aspectGainFactor = Math.max(0.1, Math.min(1, aspectVolume / 100))
      const aspectDuration = Math.max(0.6, dynAspectsFadeInRef.current + dynAspectsSustainRef.current + dynAspectsFadeOutRef.current)

      aspects.forEach((aspect, index) => {
        const semitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? null
        if (semitoneOffset === null) return
        const aspectMidi = baseMidi + semitoneOffset
        const aspectNote = Tone.Frequency(aspectMidi, "midi").toNote()
        const velocity = Math.max(0.08, Math.min(0.7, 0.45 * aspectGainFactor))
        synth.triggerAttackRelease(aspectNote, aspectDuration, `+${index * 0.03}`, velocity)
      })
    },
    [envelope.fadeIn, envelope.fadeOut, initializeFmPadSynth],
  )

  const initializeTibetanBowlSynth = useCallback(async () => {
    if (bowlSynthRef.current && toneModuleRef.current) {
      return
    }

    const Tone = toneModuleRef.current || (await import("tone"))
    toneModuleRef.current = Tone

    await Tone.start()

    const toneContext: any = Tone.getContext?.() ?? (Tone as any).context
    if (toneContext) {
      try {
        toneContext.lookAhead = 0.25
        toneContext.updateInterval = 0.05
        toneContext.latencyHint = "playback"
      } catch (e) {
        // ignore context tuning issues
      }
    }

    const synth = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 1.6,
      oscillator: { type: "sine" },
      envelope: {
        attack: 0.015,
        decay: 3.2,
        sustain: 0.22,
        release: 8.4,
      },
      modulation: { type: "sine" },
      modulationEnvelope: {
        attack: 0.03,
        decay: 2.4,
        sustain: 0.18,
        release: 7.2,
      },
    })
    synth.volume.value = -6
    ;(synth as any).maxPolyphony = 10

    const highpass = new Tone.Filter({ type: "highpass", frequency: 90, rolloff: -24 })
    const resonatorA = new Tone.Filter({ type: "bandpass", frequency: 430, Q: 12 })
    const resonatorB = new Tone.Filter({ type: "bandpass", frequency: 860, Q: 10 })
    const resonatorC = new Tone.Filter({ type: "bandpass", frequency: 1290, Q: 8 })
    const resonatorMix = new Tone.Gain(1)
    const vibrato = new Tone.Vibrato({ frequency: 4.2, depth: 0.08 })
    const reverb = new Tone.Reverb({ decay: 5.5, preDelay: 0.01, wet: 0.28 })
    await reverb.generate()
    const reverbShelf = new Tone.Filter({ type: "highshelf", frequency: 2500, gain: -4 })
    const gain = new Tone.Gain(getBowlGainValue(masterVolumeRef.current, synthVolumeRef.current))

    synth.connect(highpass)
    highpass.connect(resonatorA)
    highpass.connect(resonatorB)
    highpass.connect(resonatorC)
    resonatorA.connect(resonatorMix)
    resonatorB.connect(resonatorMix)
    resonatorC.connect(resonatorMix)
    resonatorMix.connect(vibrato)
    vibrato.connect(reverb)
    reverb.connect(reverbShelf)
    reverbShelf.connect(gain)
    gain.toDestination()

    bowlSynthRef.current = synth
    bowlGainRef.current = gain
  }, [])

  const triggerTibetanBowlNotes = useCallback(
    async (
      principalSemitoneOffset: number,
      aspects: any[] = [],
      aspectVolumeOverride?: number,
    ) => {
      await initializeTibetanBowlSynth()
      if (!toneModuleRef.current || !bowlSynthRef.current) return

      const Tone = toneModuleRef.current
      const synth = bowlSynthRef.current
      const tunedRate = centsToPlaybackRate(tuningCentsRef.current)
      const pitchShiftFromTuning = 12 * Math.log2(tunedRate)
      const baseMidi =
        60 +
        principalSemitoneOffset +
        DEFAULT_SYSTEM_OCTAVE_SHIFT_SEMITONES +
        BOWL_SYNTH_OCTAVE_SHIFT_SEMITONES +
        pitchShiftFromTuning

      const principalDuration = Math.max(
        2.4,
        (Number.isFinite(envelope.fadeIn) ? envelope.fadeIn : 7) +
          (Number.isFinite(envelope.fadeOut) ? envelope.fadeOut : 7) +
          2,
      )
      const principalNote = Tone.Frequency(baseMidi, "midi").toNote()
      synth.triggerAttackRelease(principalNote, principalDuration, undefined, 0.9)

      if (!aspects || aspects.length === 0) return

      const aspectVolume =
        typeof aspectVolumeOverride === "number" ? aspectVolumeOverride : aspectsSoundVolumeRef.current
      const aspectGainFactor = Math.max(0.1, Math.min(1, aspectVolume / 100))
      const aspectDuration = Math.max(
        1.8,
        dynAspectsFadeInRef.current + dynAspectsSustainRef.current + dynAspectsFadeOutRef.current + 1.2,
      )

      aspects.forEach((aspect, index) => {
        const semitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? null
        if (semitoneOffset === null) return
        const aspectMidi = baseMidi + semitoneOffset
        const aspectNote = Tone.Frequency(aspectMidi, "midi").toNote()
        const velocity = Math.max(0.06, Math.min(0.6, 0.35 * aspectGainFactor))
        synth.triggerAttackRelease(aspectNote, aspectDuration, `+${index * 0.06}`, velocity)
      })
    },
    [envelope.fadeIn, envelope.fadeOut, initializeTibetanBowlSynth],
  )

  const playPlanetSound = useCallback(
    async (
      planetName: string,
      pointerAngleDeg = 180,
      planetDeclinationDeg = 0,
      aspects: any[] = [],
      planets: PlanetData[] = [],
      ascendantDegrees = 0,
      mcDegrees = 0,
      aspectVolumeOverride?: number,
      reverbProfileOverride?: {
        wetMix?: number
        decaySeconds?: number
        gainMultiplier?: number
        fadeOutScale?: number
        fadeOutCurve?: "linear" | "s"
      },
    ) => {
      await initializeAudio()
      const normalizedPlanetName = planetName.toLowerCase()
      const audioMode = audioEngineModeRef.current || "samples"
      const resolveBufferKey = (name: string) =>
        audioMode === "tibetan_samples" ? getTibetanSampleKey(name) : name.toLowerCase()
      const resolvedReverbWetMix = Math.max(
        0,
        Math.min(
          1,
          reverbProfileOverride?.wetMix ??
            getReverbWetMix(isChordModeRef.current, reverbMixPercentRef.current, chordReverbMixPercentRef.current),
        ),
      )
      const resolvedReverbDecaySeconds = Math.max(
        0.5,
        reverbProfileOverride?.decaySeconds ?? getReverbDecaySeconds(isChordModeRef.current),
      )
      const resolvedGainMultiplier = Math.max(0, reverbProfileOverride?.gainMultiplier ?? 1)
      const resolvedFadeOutScale = Math.max(0.1, reverbProfileOverride?.fadeOutScale ?? 1)
      const useSCurveFadeOut = reverbProfileOverride?.fadeOutCurve === "s"

      if (
        audioContextRef.current &&
        globalReverbConvolverRef.current &&
        reverbDecaySecondsRef.current !== resolvedReverbDecaySeconds
      ) {
        planetReverbImpulseRef.current = createLowDiffusionReverbImpulse(
          audioContextRef.current,
          resolvedReverbDecaySeconds,
        )
        globalReverbConvolverRef.current.buffer = planetReverbImpulseRef.current
        reverbDecaySecondsRef.current = resolvedReverbDecaySeconds
      }

      if (playingPlanetsRef.current.has(normalizedPlanetName)) {
        console.log(`[v0] Planet ${planetName} is already playing`)
        return
      }

      const principalSemitoneOffset = getPlanetPrincipalSemitoneOffset(
        normalizedPlanetName,
        modalEnabledRef.current,
        modalSunSignIndexRef.current,
      )
      const basePlaybackRate = getPlanetPrincipalPlaybackRate(
        normalizedPlanetName,
        modalEnabledRef.current,
        modalSunSignIndexRef.current,
      )
      const fmTotalDuration =
        (Number.isFinite(envelope.fadeIn) ? envelope.fadeIn : 7) +
        (Number.isFinite(envelope.fadeOut) ? envelope.fadeOut : 7) * resolvedFadeOutScale
      const bowlTotalDuration = fmTotalDuration + 2

      if (audioMode === "hybrid" || audioMode === "fm_pad") {
        await triggerFmPadNotes(principalSemitoneOffset, aspects, aspectVolumeOverride)
      }
      if (audioMode === "tibetan_bowls") {
        await triggerTibetanBowlNotes(principalSemitoneOffset, aspects, aspectVolumeOverride)
      }

      if (audioMode === "fm_pad" || audioMode === "tibetan_bowls") {
        playingPlanetsRef.current.add(normalizedPlanetName)
        setTimeout(() => {
          playingPlanetsRef.current.delete(normalizedPlanetName)
        }, Math.max(200, (audioMode === "tibetan_bowls" ? bowlTotalDuration : fmTotalDuration) * 1000))
        return
      }

      if (activeTracksRef.current.size >= 15) {
        console.log(`[v0] Max polyphony reached (15 sounds)`)
        return
      }

      const primaryBufferKey = resolveBufferKey(normalizedPlanetName)
      const audioBuffer = audioBuffersRef.current[primaryBufferKey]
      if (!audioBuffer || !audioContextRef.current) {
        console.log(`[v0] No audio buffer for ${planetName} (key=${primaryBufferKey})`)
        return
      }

      const ctx = audioContextRef.current

      const startOffset = audioMode === "tibetan_samples" ? 0 : 30

      if (startOffset >= audioBuffer.duration) {
        console.log(`[v0] Start offset ${startOffset}s exceeds buffer duration ${audioBuffer.duration}s`)
        return
      }

      try {
        const azimuth = (pointerAngleDeg + 90) % 360 // Adjust for ambisonics coordinate system
        const elevation = planetDeclinationDeg * 5

        console.log(`[v0] Playing sound for ${planetName} at azimuth ${azimuth}°, elevation ${elevation}°`)

        const source = ctx.createBufferSource() as AudioBufferSourceNode
        source.buffer = audioBuffer

        source.playbackRate.value = basePlaybackRate

        if (!resonanceSceneRef.current || !resonanceSceneRef.current.output) {
          console.error("[v0] Resonance Audio scene not properly initialized")
          return
        }

        const panner = resonanceSceneRef.current.createSource()

        const gainNode = ctx.createGain()
        const dryGainNode = ctx.createGain()
        const wetSendGainNode = ctx.createGain()
        dryGainNode.gain.value = Math.max(0, 1 - resolvedReverbWetMix)
        wetSendGainNode.gain.value = resolvedReverbWetMix

        source.connect(gainNode)
        gainNode.connect(dryGainNode)
        gainNode.connect(wetSendGainNode)
        dryGainNode.connect(panner.input)
        if (globalReverbSendRef.current) {
          wetSendGainNode.connect(globalReverbSendRef.current)
        } else {
          wetSendGainNode.connect(panner.input)
        }

        const position = polarToCartesian3D(azimuth, elevation)
        panner.setPosition(position.x, position.y, position.z)

        console.log(
          `[v0] 3D position - x: ${position.x.toFixed(2)}, y: ${position.y.toFixed(2)}, z: ${position.z.toFixed(2)}`,
        )

        const fadeInTime = Number.isFinite(envelope.fadeIn) ? envelope.fadeIn : 7
        const fadeOutTime = (Number.isFinite(envelope.fadeOut) ? envelope.fadeOut : 7) * resolvedFadeOutScale

        if (!Number.isFinite(fadeInTime) || !Number.isFinite(fadeOutTime)) {
          console.error(`[v0] Invalid envelope times for ${planetName}: fadeIn=${fadeInTime}, fadeOut=${fadeOutTime}`)
          return
        }

        const totalDuration = fadeInTime + fadeOutTime

        const currentTime = ctx.currentTime
        const planetVolumeMultiplier =
          getPlanetVolumeMultiplier(planetName) * (audioMode === "tibetan_samples" ? 0.92 : 1) * resolvedGainMultiplier

        gainNode.gain.setValueAtTime(0, currentTime)
        gainNode.gain.linearRampToValueAtTime(planetVolumeMultiplier, currentTime + fadeInTime)
        const fadeOutStartTime = currentTime + fadeInTime
        gainNode.gain.setValueAtTime(planetVolumeMultiplier, fadeOutStartTime)
        if (useSCurveFadeOut && fadeOutTime > 0.01) {
          gainNode.gain.setValueCurveAtTime(
            createSCurveFadeOutValues(planetVolumeMultiplier),
            fadeOutStartTime,
            fadeOutTime,
          )
        } else {
          gainNode.gain.linearRampToValueAtTime(0, currentTime + totalDuration)
        }

        const safeEndTime = Math.max(currentTime + 0.01, currentTime + totalDuration)
        const trackId = `${planetName}-${currentTime}`
        source.onended = () => {
          activeTracksRef.current.delete(trackId)
          playingPlanetsRef.current.delete(normalizedPlanetName)
          source.onended = null
        }
        source.start(currentTime, startOffset)
        source.stop(safeEndTime)

        activeTracksRef.current.set(trackId, {
          audioContext: ctx,
          source,
          startTime: currentTime,
          endTime: safeEndTime,
          planetName,
          basePlaybackRate,
          gainNode,
          kind: "planet",
          panner,
        })

        playingPlanetsRef.current.add(normalizedPlanetName)

        if (aspects && aspects.length > 0) {
          // Play aspects with inherited zodiacal playbackRate plus aspect transposition
          for (const aspect of aspects) {
            const otherPlanetName = aspect.point1.name === planetName ? aspect.point2.name : aspect.point1.name
            const normalizedOtherPlanetName = otherPlanetName.toLowerCase()

            // Do not retrigger a planet as aspect while its principal voice is still fading out.
            if (playingPlanetsRef.current.has(normalizedOtherPlanetName)) continue

            const otherAudioBuffer = audioBuffersRef.current[resolveBufferKey(otherPlanetName)]
            if (!otherAudioBuffer) continue

            let otherPlanetDegrees: number | null = null
            let otherPlanetDeclination = 0

            if (otherPlanetName.toLowerCase() === "asc") {
              otherPlanetDegrees = ascendantDegrees
            } else if (otherPlanetName.toLowerCase() === "mc") {
              otherPlanetDegrees = mcDegrees
            } else {
              const otherPlanet = planets.find((p) => p.name.toLowerCase() === otherPlanetName.toLowerCase())
              if (otherPlanet) {
                otherPlanetDegrees = otherPlanet.ChartPosition.Ecliptic.DecimalDegrees
                otherPlanetDeclination = otherPlanet.declination || 0
              }
            }

            if (otherPlanetDegrees === null) continue

            const aspectSemitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? 0
            const aspectTransposeRate = Math.pow(2, aspectSemitoneOffset / 12)
            const aspectPlaybackRate = basePlaybackRate * aspectTransposeRate

            const aspectSource = ctx.createBufferSource() as AudioBufferSourceNode
            aspectSource.buffer = otherAudioBuffer
            aspectSource.playbackRate.value = aspectPlaybackRate

            const aspectPanner = resonanceSceneRef.current.createSource()
            const aspectPosition = polarToCartesian3D(otherPlanetDegrees, otherPlanetDeclination * 5)
            aspectPanner.setPosition(aspectPosition.x, aspectPosition.y, aspectPosition.z)

            const aspectGainNode = ctx.createGain()
            const aspectDryGainNode = ctx.createGain()
            const aspectWetSendGainNode = ctx.createGain()
            aspectDryGainNode.gain.value = Math.max(0, 1 - resolvedReverbWetMix)
            aspectWetSendGainNode.gain.value = resolvedReverbWetMix
            aspectSource.connect(aspectGainNode)
            aspectGainNode.connect(aspectDryGainNode)
            aspectGainNode.connect(aspectWetSendGainNode)
            aspectDryGainNode.connect(aspectPanner.input)
            if (globalReverbSendRef.current) {
              aspectWetSendGainNode.connect(globalReverbSendRef.current)
            } else {
              aspectWetSendGainNode.connect(aspectPanner.input)
            }

            const aspectVolume =
              typeof aspectVolumeOverride === "number" ? aspectVolumeOverride : aspectsSoundVolumeRef.current
            const aspectPlanetVolumeMultiplier = getPlanetVolumeMultiplier(otherPlanetName)
            const baseVolume =
              0.33 *
              (aspectVolume / 100) *
              aspectPlanetVolumeMultiplier *
              (audioMode === "tibetan_samples" ? 0.9 : 1) *
              resolvedGainMultiplier

            // Use dynAspects times instead of planet times
            const aspectFadeInTime = dynAspectsFadeInRef.current
            const aspectSustainTime = dynAspectsSustainRef.current
            const aspectFadeOutTime = dynAspectsFadeOutRef.current * resolvedFadeOutScale
            
            const aspectStartTime = currentTime
            const aspectFadeInEnd = aspectStartTime + aspectFadeInTime
            const aspectSustainEnd = aspectFadeInEnd + aspectSustainTime
            const aspectFadeOutEnd = aspectSustainEnd + aspectFadeOutTime
            
            const aspectEndTime = Math.max(aspectStartTime + 0.01, aspectFadeOutEnd)

            aspectGainNode.gain.setValueAtTime(0, aspectStartTime)
            aspectGainNode.gain.linearRampToValueAtTime(baseVolume, aspectFadeInEnd)
            aspectGainNode.gain.setValueAtTime(baseVolume, aspectSustainEnd)
            if (useSCurveFadeOut && aspectFadeOutTime > 0.01) {
              aspectGainNode.gain.setValueCurveAtTime(
                createSCurveFadeOutValues(baseVolume),
                aspectSustainEnd,
                aspectFadeOutTime,
              )
            } else {
              aspectGainNode.gain.linearRampToValueAtTime(0, aspectFadeOutEnd)
            }

            const aspectTrackId = `${planetName}-aspect-${otherPlanetName}-${currentTime}`
            aspectSource.onended = () => {
              activeTracksRef.current.delete(aspectTrackId)
              aspectSource.onended = null
            }
            activeTracksRef.current.set(aspectTrackId, {
              audioContext: ctx,
              source: aspectSource,
              startTime: aspectStartTime,
              endTime: aspectEndTime,
              planetName: `${planetName}-aspect`,
              basePlaybackRate,
              gainNode: aspectGainNode,
              kind: "aspect",
              panner: aspectPanner,
            })
            aspectSource.start(aspectStartTime, startOffset)
            aspectSource.stop(aspectEndTime)

          }
        }
      } catch (error) {
        console.error(`[v0] Error playing sound for ${planetName}:`, error)
      }
    },
    [envelope.fadeIn, envelope.fadeOut, initializeAudio, triggerFmPadNotes, triggerTibetanBowlNotes],
  )

  const stopAll = useCallback(() => {
    stopOfflinePlayback()
    const ctx = audioContextRef.current
    activeTracksRef.current.forEach((track) => {
      if (track.gainNode && ctx) {
        rampGainToZeroAndStop(track.source, track.gainNode, ctx, 30)
      } else {
        // No gain node available — fall back to immediate stop
        try {
          track.source.stop()
        } catch {
          // already stopped
        }
      }
    })
    activeTracksRef.current.clear()
    playingPlanetsRef.current.clear()
    if (fmPadSynthRef.current && typeof fmPadSynthRef.current.releaseAll === "function") {
      // Tone synths already have a release envelope from their ADSR config
      fmPadSynthRef.current.releaseAll()
    }
    if (bowlSynthRef.current && typeof bowlSynthRef.current.releaseAll === "function") {
      bowlSynthRef.current.releaseAll()
    }
  }, [stopOfflinePlayback])

  const renderOfflineMp3 = useCallback(
    async (options: OfflineMp3RenderOptions): Promise<Blob | null> => {
      const durationSec = Math.max(0.5, options.durationSec)
      if (!options.events || options.events.length === 0) return null

      try {
        await initializeAudio()
        const liveContext = audioContextRef.current
        if (!liveContext) return null

        const sampleRate = 48000
        const totalFrames = Math.max(1, Math.ceil(durationSec * sampleRate))
        const offlineContext = new OfflineAudioContext(2, totalFrames, sampleRate)

        const masterGainNode = offlineContext.createGain()
        const baseGain = Math.pow(10, 18 / 20) // [T-36] 18 dB pre-amp (recortado desde 28 dB)
        masterGainNode.gain.value = baseGain * Math.max(0, options.masterVolumePercent / 100)

        const dynamicsCompressor = offlineContext.createDynamicsCompressor()
        dynamicsCompressor.threshold.value = -1
        dynamicsCompressor.knee.value = 0
        dynamicsCompressor.ratio.value = 4
        dynamicsCompressor.attack.value = 0.003
        dynamicsCompressor.release.value = 0.25
        masterGainNode.connect(dynamicsCompressor)
        dynamicsCompressor.connect(offlineContext.destination)

        const isChordMode = options.isChordMode ?? false
        const reverbDecaySeconds = getReverbDecaySeconds(isChordMode)
        const fallbackReverbWetMix = getReverbWetMix(
          isChordMode,
          reverbMixPercentRef.current,
          chordReverbMixPercentRef.current,
        )
        const reverbWetMix =
          typeof options.reverbMixPercent === "number"
            ? Math.max(0, Math.min(1, options.reverbMixPercent / 100))
            : fallbackReverbWetMix
        const impulseBuffer = createLowDiffusionReverbImpulse(offlineContext, reverbDecaySeconds)
        const globalReverbSend = offlineContext.createGain()
        globalReverbSend.gain.value = 1
        const globalReverbConvolver = offlineContext.createConvolver()
        globalReverbConvolver.buffer = impulseBuffer
        const globalReverbShelf = offlineContext.createBiquadFilter()
        globalReverbShelf.type = "highshelf"
        globalReverbShelf.frequency.value = 800
        globalReverbShelf.gain.value = -6
        const globalReverbReturn = offlineContext.createGain()
        globalReverbReturn.gain.value = GLOBAL_REVERB_RETURN_GAIN
        globalReverbSend.connect(globalReverbConvolver)
        globalReverbConvolver.connect(globalReverbShelf)
        globalReverbShelf.connect(globalReverbReturn)
        globalReverbReturn.connect(masterGainNode)

        const tuningRate = centsToPlaybackRate(
          typeof options.tuningCents === "number" ? options.tuningCents : tuningCentsRef.current,
        )
        const modalEnabled = options.modalEnabled ?? modalEnabledRef.current
        const modalSunSignIndex =
          typeof options.modalSunSignIndex === "number"
            ? options.modalSunSignIndex
            : modalSunSignIndexRef.current
        let orbitalStarBackgroundBuffer: AudioBuffer | null = null
        if (options.includeBackground) {
          orbitalStarBackgroundBuffer = await prepareOrbitalStarBackground(modalSunSignIndex, {
            modalEnabled,
            force: false,
          })
        }

        const scheduleSample = (params: {
          bufferKey: string
          startSec: number
          angleDeg: number
          declinationDeg: number
          fadeInSec: number
          sustainSec: number
          fadeOutSec: number
          peakGain: number
          playbackRate: number
        }) => {
          const buffer = audioBuffersRef.current[params.bufferKey]
          if (!buffer) return

          const startTime = Math.max(0, params.startSec)
          if (startTime >= durationSec) return

          const source = offlineContext.createBufferSource()
          source.buffer = buffer
          source.playbackRate.setValueAtTime(Math.max(0.05, params.playbackRate), startTime)

          const gainNode = offlineContext.createGain()
          const dryGainNode = offlineContext.createGain()
          const wetSendGainNode = offlineContext.createGain()
          dryGainNode.gain.value = Math.max(0, 1 - reverbWetMix)
          wetSendGainNode.gain.value = reverbWetMix

          const panner = offlineContext.createPanner()
          panner.panningModel = "HRTF"
          panner.distanceModel = "inverse"
          panner.refDistance = 1
          panner.maxDistance = 50
          panner.rolloffFactor = 1
          const elevation = params.declinationDeg * 5
          const position = polarToCartesian3D(params.angleDeg, elevation)
          if (typeof panner.positionX !== "undefined") {
            panner.positionX.setValueAtTime(position.x, startTime)
            panner.positionY.setValueAtTime(position.y, startTime)
            panner.positionZ.setValueAtTime(position.z, startTime)
          } else {
            panner.setPosition(position.x, position.y, position.z)
          }

          source.connect(gainNode)
          gainNode.connect(panner)
          panner.connect(dryGainNode)
          panner.connect(wetSendGainNode)
          dryGainNode.connect(masterGainNode)
          wetSendGainNode.connect(globalReverbSend)

          const startOffsetSec = 30
          const availableDurationSec = Math.max(0, (buffer.duration - startOffsetSec) / Math.max(0.05, params.playbackRate))
          if (availableDurationSec <= 0) return

          const fadeInSec = Math.max(0.01, params.fadeInSec)
          const sustainSec = Math.max(0, params.sustainSec)
          const fadeOutSec = Math.max(0.01, params.fadeOutSec)
          const requestedDurationSec = fadeInSec + sustainSec + fadeOutSec
          const maxRemainingSec = Math.max(0.01, durationSec - startTime)
          const effectiveDurationSec = Math.min(requestedDurationSec, availableDurationSec, maxRemainingSec)
          const endTime = startTime + effectiveDurationSec
          const fadeInEnd = Math.min(endTime, startTime + fadeInSec)
          const sustainEnd = Math.min(endTime, fadeInEnd + sustainSec)

          gainNode.gain.setValueAtTime(0, startTime)
          gainNode.gain.linearRampToValueAtTime(params.peakGain, fadeInEnd)
          gainNode.gain.setValueAtTime(params.peakGain, sustainEnd)
          gainNode.gain.linearRampToValueAtTime(0, endTime)

          source.start(startTime, startOffsetSec)
          source.stop(endTime)
        }

        if (options.includeBackground && orbitalStarBackgroundBuffer) {
          const backgroundSource = offlineContext.createBufferSource()
          const backgroundGainNode = offlineContext.createGain()
          const backgroundTargetGain = Math.max(0, (options.backgroundVolumePercent ?? backgroundVolumeRef.current) / 100)
          const backgroundFadeInSec = Math.max(0.01, Math.min(ORBITAL_STAR_BACKGROUND_FADE_IN_SEC, durationSec))
          const backgroundFadeOutSec = Math.max(0.01, Math.min(ORBITAL_STAR_BACKGROUND_FADE_OUT_SEC, durationSec))
          const backgroundFadeOutStart = Math.max(backgroundFadeInSec, durationSec - backgroundFadeOutSec)

          backgroundSource.buffer = orbitalStarBackgroundBuffer
          backgroundSource.loop = true

          backgroundGainNode.gain.setValueAtTime(0, 0)
          backgroundGainNode.gain.linearRampToValueAtTime(backgroundTargetGain, backgroundFadeInSec)
          backgroundGainNode.gain.setValueAtTime(backgroundTargetGain, backgroundFadeOutStart)
          backgroundGainNode.gain.linearRampToValueAtTime(0, durationSec)

          backgroundSource.connect(backgroundGainNode)
          backgroundGainNode.connect(masterGainNode)
          backgroundSource.start(0)
          backgroundSource.stop(durationSec)
        }

        if (options.includeElement && options.elementName) {
          const elementBuffer = audioBuffersRef.current[options.elementName]
          if (elementBuffer) {
            const rulerPlanet = getSignRulerPlanetName(modalSunSignIndex)
            const elementPlaybackRate =
              getPlanetPrincipalPlaybackRate(rulerPlanet, modalEnabled, modalSunSignIndex) * tuningRate
            const elementSource = offlineContext.createBufferSource()
            const elementGainNode = offlineContext.createGain()
            elementSource.buffer = elementBuffer
            elementSource.loop = true
            elementSource.playbackRate.value = elementPlaybackRate
            elementGainNode.gain.value = Math.max(0, (options.elementVolumePercent ?? elementSoundVolumeRef.current) / 100)
            elementSource.connect(elementGainNode)
            elementGainNode.connect(masterGainNode)
            elementSource.start(0)
            elementSource.stop(durationSec)
          }
        }

        for (const event of options.events) {
          const planetName = event.planetName.toLowerCase()
          const principalPlaybackRate = getPlanetPrincipalPlaybackRate(planetName, modalEnabled, modalSunSignIndex) * tuningRate
          const principalPeakGain = getPlanetVolumeMultiplier(planetName)

          scheduleSample({
            bufferKey: planetName,
            startSec: event.startSec,
            angleDeg: event.angleDeg,
            declinationDeg: event.declinationDeg,
            fadeInSec: event.fadeInSec,
            sustainSec: 0,
            fadeOutSec: event.fadeOutSec,
            peakGain: principalPeakGain,
            playbackRate: principalPlaybackRate,
          })

          const aspectFadeInSec = Math.max(0.01, event.aspectFadeInSec ?? dynAspectsFadeInRef.current)
          const aspectSustainSec = Math.max(0, event.aspectSustainSec ?? dynAspectsSustainRef.current)
          const aspectFadeOutSec = Math.max(0.01, event.aspectFadeOutSec ?? dynAspectsFadeOutRef.current)
          const aspectVolumePercent = Math.max(0, event.aspectVolumePercent ?? aspectsSoundVolumeRef.current)

          for (const aspect of event.aspects || []) {
            const aspectPlanetName = aspect.planetName.toLowerCase()
            const aspectSemitoneOffset = ASPECT_SEMITONE_OFFSETS[aspect.aspectType] ?? 0
            const aspectTransposeRate = Math.pow(2, aspectSemitoneOffset / 12)
            const aspectPlaybackRate = principalPlaybackRate * aspectTransposeRate
            const aspectPeakGain = 0.33 * (aspectVolumePercent / 100) * getPlanetVolumeMultiplier(aspectPlanetName)

            scheduleSample({
              bufferKey: aspectPlanetName,
              startSec: event.startSec,
              angleDeg: aspect.angleDeg,
              declinationDeg: aspect.declinationDeg,
              fadeInSec: aspectFadeInSec,
              sustainSec: aspectSustainSec,
              fadeOutSec: aspectFadeOutSec,
              peakGain: aspectPeakGain,
              playbackRate: aspectPlaybackRate,
            })
          }
        }

        const renderedBuffer = normalizeBufferPeak(await offlineContext.startRendering(), -1)
        const leftChannel = renderedBuffer.getChannelData(0)
        const rightChannel = renderedBuffer.numberOfChannels > 1 ? renderedBuffer.getChannelData(1) : leftChannel

        const lameModule = (await import("@breezystack/lamejs")) as {
          Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance
        }
        const encoder = new lameModule.Mp3Encoder(2, sampleRate, 160)
        const mp3Chunks: Uint8Array[] = []
        const chunkSize = 1152
        for (let i = 0; i < leftChannel.length; i += chunkSize) {
          const leftChunk = floatToInt16(leftChannel.subarray(i, i + chunkSize))
          const rightChunk = floatToInt16(rightChannel.subarray(i, i + chunkSize))
          const encoded = toUint8Array(encoder.encodeBuffer(leftChunk, rightChunk))
          if (encoded.length > 0) {
            mp3Chunks.push(encoded)
          }
        }
        if (mp3Chunks.length === 0) {
          const leftAll = floatToInt16(leftChannel)
          const rightAll = floatToInt16(rightChannel)
          const encodedAll = toUint8Array(encoder.encodeBuffer(leftAll, rightAll))
          if (encodedAll.length > 0) {
            mp3Chunks.push(encodedAll)
          }
        }
        const flushChunk = toUint8Array(encoder.flush())
        if (flushChunk.length > 0) {
          mp3Chunks.push(flushChunk)
        }
        if (mp3Chunks.length === 0) return null
        const blob = new Blob(mp3Chunks, { type: "audio/mpeg" })
        if (blob.size === 0) return null
        return blob
      } catch (error) {
        console.error("[v0] Error rendering offline MP3:", error)
        return null
      }
    },
    [initializeAudio, prepareOrbitalStarBackground],
  )

  useEffect(() => {
    initializeAudio()
  }, [initializeAudio])

  useEffect(() => {
    return () => {
      stopAll()
      stopBackgroundSound()
      stopElementBackground()
      if (fmPadSynthRef.current) {
        try {
          fmPadSynthRef.current.dispose()
        } catch (e) {
          // ignore
        }
        fmPadSynthRef.current = null
      }
      if (fmPadGainRef.current) {
        try {
          fmPadGainRef.current.dispose()
        } catch (e) {
          // ignore
        }
        fmPadGainRef.current = null
      }
      if (bowlSynthRef.current) {
        try {
          bowlSynthRef.current.dispose()
        } catch (e) {
          // ignore
        }
        bowlSynthRef.current = null
      }
      if (bowlGainRef.current) {
        try {
          bowlGainRef.current.dispose()
        } catch (e) {
          // ignore
        }
        bowlGainRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
      backgroundRenderRequestIdRef.current += 1
      backgroundRenderPromiseRef.current = null
      backgroundBufferRef.current = null
      backgroundSignIndexRef.current = null
      globalReverbSendRef.current = null
      offlinePlaybackCacheRef.current.clear()
      offlinePlaybackPromiseCacheRef.current.clear()
    }
  }, [stopAll, stopBackgroundSound, stopElementBackground])

  // [T-30-b] Nuke the offline render cache. Called by the parent
  // when a render-affecting phase toggle flips, so the next playback
  // reflects the new phase configuration. Safe to call repeatedly.
  const clearOfflinePlaybackCache = useCallback(() => {
    offlinePlaybackCacheRef.current.clear()
    offlinePlaybackPromiseCacheRef.current.clear()
  }, [])

  return {
    playPlanetSound,
    stopAll,
    prepareOfflinePlayback,
    startOfflinePlayback,
    stopOfflinePlayback,
    getOfflinePlaybackElapsedSec,
    playBackgroundSound,
    stopBackgroundSound,
    prepareOrbitalStarBackground,
    playElementBackground,
    stopElementBackground,
    loadingProgress,
    loadingLabel,
    audioLevelLeftPre,
    audioLevelRightPre,
    audioLevelLeftPost,
    audioLevelRightPost,
    compressionReductionDb,
    renderOfflineMp3,
    clearOfflinePlaybackCache,
  }
}
