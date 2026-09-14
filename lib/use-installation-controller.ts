"use client"

import { useEffect, useRef } from "react"

// [T-51] Instalación: capa de input para el controlador físico USB
// "SIDE-KEYBOARD" (SDINNOVATION, VID 0x6d7b / PID 0xdcfa) — 3 botones + 1 dial
// con push. El dispositivo emula un teclado HID estándar; este hook traduce
// las teclas crudas que manda a eventos semánticos A/B/C/D + rotación de dial,
// para que el resto de la app nunca tenga que conocer las teclas reales.
//
// Mapeo confirmado por prueba física (2026-09-14):
//   Botón A         -> "3"
//   Botón B         -> ","
//   Botón C         -> "."
//   Push del dial   -> " " (space)  = D
//   Dial ← (1 click) -> "1"
//   Dial → (1 click) -> "2"
//
// Si en algún momento se reprograma el dispositivo o se cambia de hardware,
// alcanza con tocar KEY_MAP acá — el resto de la app queda intacto.

const KEY_MAP = {
  "3": "A",
  ",": "B",
  ".": "C",
  " ": "D",
  "1": "dialLeft",
  "2": "dialRight",
} as const

type ControllerKey = keyof typeof KEY_MAP
type ControllerAction = (typeof KEY_MAP)[ControllerKey]

export interface InstallationControllerHandlers {
  onA?: () => void
  onB?: () => void
  onC?: () => void
  onD?: () => void
  onDialLeft?: () => void
  onDialRight?: () => void
}

/**
 * Escucha el controlador físico de la instalación (3 botones + dial) y
 * dispara los callbacks semánticos correspondientes. No hace nada si no
 * hay handlers registrados. Ignora el evento por completo (no hace
 * preventDefault ni actualiza nada) si el foco está en un input/textarea,
 * para no romper el uso normal de teclado en formularios.
 */
export function useInstallationController(handlers: InstallationControllerHandlers, enabled = true) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return
    if (typeof window === "undefined") return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditableTarget =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if (isEditableTarget) return

      const action = KEY_MAP[event.key as ControllerKey] as ControllerAction | undefined
      if (!action) return

      // Evita que "3", "," "." " " etc. hagan scroll de página, activen
      // botones enfocados, o cualquier efecto por defecto del navegador.
      event.preventDefault()

      const h = handlersRef.current
      switch (action) {
        case "A":
          h.onA?.()
          break
        case "B":
          h.onB?.()
          break
        case "C":
          h.onC?.()
          break
        case "D":
          h.onD?.()
          break
        case "dialLeft":
          h.onDialLeft?.()
          break
        case "dialRight":
          h.onDialRight?.()
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [enabled])
}
