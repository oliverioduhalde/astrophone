"use client"

import { useEffect } from "react"

// [T-53] Instalación: modo kiosco.
// - Pide pantalla completa apenas hay un gesto real del usuario (click,
//   toque, o la primera tecla del controlador físico) — los navegadores
//   exigen que requestFullscreen() se dispare desde un gesto, así que no
//   se puede pedir directo al montar.
// - Oculta el cursor del mouse tras un rato sin moverse (la instalación
//   se maneja con el controlador de 3 botones + dial, no con mouse), y lo
//   vuelve a mostrar apenas hay movimiento real (para seguir pudiendo
//   depurar con mouse en desarrollo).
// - Bloquea el menú contextual (click derecho / long-press) para que no
//   aparezcan menús del navegador sobre la instalación.
export function useKioskMode(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    if (typeof document === "undefined") return

    const requestFullscreenIfPossible = () => {
      if (document.fullscreenElement) return
      const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void
      }
      const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root)
      if (!request) return
      // Algunos navegadores rechazan la promesa si el gesto no se considera
      // "reciente" — no pasa nada, se reintenta en la próxima interacción.
      void Promise.resolve(request()).catch(() => {})
    }

    const handleFirstGesture = () => requestFullscreenIfPossible()
    window.addEventListener("keydown", handleFirstGesture, { once: true })
    window.addEventListener("pointerdown", handleFirstGesture, { once: true })

    const handleContextMenu = (event: Event) => event.preventDefault()
    document.addEventListener("contextmenu", handleContextMenu)

    return () => {
      window.removeEventListener("keydown", handleFirstGesture)
      window.removeEventListener("pointerdown", handleFirstGesture)
      document.removeEventListener("contextmenu", handleContextMenu)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    if (typeof document === "undefined") return

    const IDLE_MS = 3000
    let idleTimeoutId: ReturnType<typeof setTimeout> | null = null

    const showCursor = () => {
      document.body.style.cursor = ""
      if (idleTimeoutId) clearTimeout(idleTimeoutId)
      idleTimeoutId = setTimeout(() => {
        document.body.style.cursor = "none"
      }, IDLE_MS)
    }

    showCursor()
    window.addEventListener("mousemove", showCursor)
    window.addEventListener("pointerdown", showCursor)

    return () => {
      if (idleTimeoutId) clearTimeout(idleTimeoutId)
      window.removeEventListener("mousemove", showCursor)
      window.removeEventListener("pointerdown", showCursor)
      document.body.style.cursor = ""
    }
  }, [enabled])
}
