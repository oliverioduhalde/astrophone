"use client"

import { useEffect, useRef } from "react"

// [T-76] Instalación: capa de input para el controlador físico USB
// "SIDE-KEYBOARD" (SDINNOVATION, VID 0x6d7b / PID 0xdcfa, controller M951)
// — 3 botones + 1 dial con push. El dispositivo emula un teclado HID
// estándar; este hook traduce las teclas crudas que manda a eventos
// semánticos A/B/C/D + rotación de dial, para que el resto de la app nunca
// tenga que conocer las teclas reales.
//
// Mapeo reconfigurado desde el propio dispositivo (sdcx-tech.com,
// Profile 1 / Main Layer, 2026-09-14) — YA NO es el mapeo original
// confirmado por prueba física, el usuario lo cambió con el configurador:
//   Botón A (izquierdo)        -> "ArrowLeft"
//   Botón B (centro)           -> "ArrowRight"
//   Botón C (derecho)          -> "Enter"
//   Dial, giro antihorario     -> ","
//   Dial, giro horario         -> "."
//   Push del dial              -> "Enter"  (= D)
//
// OJO: el push del dial y el botón C mandan la MISMA tecla ("Enter") —
// el propio configurador del dispositivo los mapeó igual, así que desde
// software son indistinguibles. onD nunca se dispara solo: cualquier uso
// del dial-push cae en onC. Si hace falta diferenciarlos, hay que
// reconfigurar el dispositivo (asignarle al push una tecla propia).
//
// Si en algún momento se reprograma el dispositivo de nuevo, alcanza con
// tocar KEY_MAP acá — el resto de la app queda intacto.

const KEY_MAP = {
  ArrowLeft: "A",
  ArrowRight: "B",
  Enter: "C",
  ",": "dialLeft",
  ".": "dialRight",
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

      // Evita que ArrowLeft/ArrowRight hagan scroll de página, Enter
      // active un botón enfocado, etc.
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
          // El push del dial manda la misma tecla que este botón (ver
          // nota arriba) — no hay forma de distinguirlos, así que onD
          // nunca se llama solo.
          h.onC?.()
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
