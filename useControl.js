import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ref, onValue, update } from 'firebase/database'
import { db } from '../firebase/config'

export const H_MAX = 50 // cm  (Hmax del Arduino)
export const H_SEG = 47 // cm  (corte de seguridad del Arduino)
export const VALVE_V = 24 // V  (alimentación de la bobina)

const PATH_LIVE = 'tanque/live' // Python escribe aquí: sensor + estado del PID (claves planas)
const PATH_CMD = 'tanque/cmd' // la web escribe aquí; Python lo reenvía por serial
const MAX_POINTS = 900 // ~4.5 min a 0.3 s por muestra
const MOCK = !db

// Métricas del transitorio desde el último cambio de setpoint
function calcMetrics(hist, step) {
  if (!step || hist.length < 5 || hist[0].t > step.t + 1) return null
  const pts = hist.filter((p) => p.t >= step.t)
  const A = Math.abs(step.sp - step.h0)
  if (pts.length < 5 || A < 2) return null
  const s = Math.sign(step.sp - step.h0)
  const frac = (p) => ((p.h - step.h0) * s) / A
  const cruce = (x) => pts.find((p) => frac(p) >= x)
  const t10 = cruce(0.1)
  const t90 = cruce(0.9)
  const band = Math.max(0.02 * A, 0.3) // ±2 % del escalón (mínimo 0.3 cm por ruido)
  const fuera = pts.filter((p) => Math.abs(p.h - step.sp) > band)
  const last = pts[pts.length - 1]
  const tFuera = fuera.length ? fuera[fuera.length - 1].t : step.t
  const asentado = Math.abs(last.h - step.sp) <= band && last.t - tFuera > 5
  const fin = pts.slice(-10)
  let iae = 0
  for (let i = 1; i < pts.length; i++) iae += Math.abs(step.sp - pts[i].h) * (pts[i].t - pts[i - 1].t)
  return {
    overshoot: Math.max(0, (Math.max(...pts.map(frac)) - 1) * 100),
    tr: t10 && t90 ? t90.t - t10.t : null,
    ts: asentado ? tFuera - step.t : null,
    ess: step.sp - fin.reduce((a, p) => a + p.h, 0) / fin.length,
    iae,
  }
}

export function useControl() {
  const [live, setLive] = useState({ h: 0, sp: 0, u: 0, pwm: 0, modo: 0, kp: 0, ki: 0, kd: 0, seg: 0 })
  const [hist, setHist] = useState([])
  const [online, setOnline] = useState(false)
  const t0 = useRef(Date.now())
  const lastRx = useRef(0)
  const step = useRef(null)
  const cfg = useRef({ sp: 25, kp: 2, ki: 0.05, kd: 0, modo: 0, uManual: 0 }) // solo simulación
  const sim = useRef({ h: 5, I: 0, dF: 0, hPrev: 5 })

  const push = useCallback((d) => {
    const t = (Date.now() - t0.current) / 1000
    lastRx.current = Date.now()
    if (!step.current || Math.abs(d.sp - step.current.sp) > 0.05) step.current = { t, h0: d.h, sp: d.sp }
    setLive(d)
    setHist((h) => [...h.slice(-(MAX_POINTS - 1)), { t, h: d.h, sp: d.sp, u: d.u }])
  }, [])

  // ---- Datos reales: Firebase RTDB ----
  useEffect(() => {
    if (MOCK) return
    return onValue(ref(db, PATH_LIVE), (snap) => {
      const d = snap.val()
      if (d) push(d)
    })
  }, [push])

  // ---- Simulación (solo para ver la interfaz sin hardware). Espeja el PID del firmware ----
  useEffect(() => {
    if (!MOCK) return
    const dt = 0.3
    const id = setInterval(() => {
      const s = sim.current
      const c = cfg.current
      const e = c.sp - s.h
      const seg = s.h >= H_SEG ? 1 : 0
      s.dF += (dt / (1 + dt)) * (-(s.h - s.hPrev) / dt - s.dF)
      s.hPrev = s.h
      let u
      if (seg) {
        u = 0
        s.I = 0
      } else if (!c.modo) {
        u = c.uManual
        s.I = u - c.kp * e
      } else {
        const uPre = c.kp * e + s.I + c.kd * s.dF
        if (!((uPre >= 100 && e > 0) || (uPre <= 0 && e < 0))) s.I += c.ki * e * dt
        s.I = Math.min(100, Math.max(0, s.I))
        u = c.kp * e + s.I + c.kd * s.dF
      }
      u = Math.min(100, Math.max(0, u))
      s.h = Math.min(H_MAX, Math.max(0, s.h + dt * ((2 * u) / 100 - 1.2 * Math.sqrt(s.h / 50))))
      push({
        h: s.h + (Math.random() - 0.5) * 0.2,
        sp: c.sp, u, pwm: Math.round(u * 2.55), modo: c.modo, kp: c.kp, ki: c.ki, kd: c.kd, seg,
      })
    }, dt * 1000)
    return () => clearInterval(id)
  }, [push])

  // ---- Estado del enlace ----
  useEffect(() => {
    const id = setInterval(() => setOnline(Date.now() - lastRx.current < 3000), 1000)
    return () => clearInterval(id)
  }, [])

  // cmd admite: sp, kp, ki, kd, modo (0/1), uManual (%)
  const send = useCallback((cmd) => {
    if (MOCK) Object.assign(cfg.current, cmd)
    else update(ref(db, PATH_CMD), { ...cmd, ts: Date.now() })
  }, [])

  const metrics = useMemo(() => calcMetrics(hist, step.current), [hist])
  return { live, hist, online, metrics, send, mock: MOCK }
}
