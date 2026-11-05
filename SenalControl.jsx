import { useState } from 'react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { Target, Gauge, Activity, SlidersHorizontal, ShieldAlert, Hand, Bot, Zap, Timer } from 'lucide-react'
import { useControl, H_MAX, H_SEG, VALVE_V } from '../hooks/useControl'

const f = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d))
const axis = { stroke: '#475569', tick: { fill: '#94a3b8', fontSize: 11 } }
const tip = {
  contentStyle: { background: '#050d1f', border: '1px solid rgba(34,211,238,.2)', borderRadius: 8, fontSize: 12 },
  labelFormatter: (t) => `t = ${Number(t).toFixed(1)} s`,
}

const Card = ({ title, icon: Icon, children, className = '' }) => (
  <section className={`rounded-2xl border border-cyan-400/10 bg-[#08122a]/90 p-4 ${className}`}>
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
      {Icon && <Icon size={14} className="text-cyan-300" />}
      {title}
    </h3>
    {children}
  </section>
)

const Kpi = ({ title, icon, value, unit, sub, color = 'text-white', children }) => (
  <Card title={title} icon={icon}>
    <div className={`font-mono text-4xl font-semibold tabular-nums ${color}`}>
      {value}
      <span className="ml-1 text-lg text-slate-400">{unit}</span>
    </div>
    <div className="mt-1 text-xs text-slate-400">{sub}</div>
    {children}
  </Card>
)

const Badge = ({ ok, warn, children }) => {
  const tone = ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    : warn ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
    : 'border-rose-400/30 bg-rose-400/10 text-rose-300'
  const dot = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
      <i className={`h-2 w-2 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

const Num = ({ label, unit, value, onChange, step }) => (
  <label className="block">
    <span className="text-xs text-slate-400">
      {label} <span className="text-slate-500">[{unit}]</span>
    </span>
    <input
      type="number" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full rounded-lg border border-cyan-400/10 bg-[#050d1f] px-3 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400/50"
    />
  </label>
)

const Metric = ({ label, value, unit }) => (
  <div className="rounded-xl bg-[#050d1f] p-3">
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className="mt-1 font-mono text-xl text-white">
      {value}
      <span className="ml-1 text-xs text-slate-400">{unit}</span>
    </div>
  </div>
)

export default function SenalControl() {
  const { live, hist, online, metrics, send, mock } = useControl()
  const [draft, setDraft] = useState({})
  const [uMan, setUMan] = useState(0)

  const val = (k) => draft[k] ?? live[k]
  const edit = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const apply = (keys) => {
    const cmd = {}
    keys.forEach((k) => {
      const n = parseFloat(draft[k])
      if (!Number.isNaN(n)) cmd[k] = n
    })
    if (Object.keys(cmd).length) send(cmd)
    setDraft((d) => {
      const r = { ...d }
      keys.forEach((k) => delete r[k])
      return r
    })
  }

  const e = live.sp - live.h
  const auto = live.modo === 1
  const eColor = Math.abs(e) <= 0.5 ? 'text-emerald-300' : Math.abs(e) <= 3 ? 'text-amber-300' : 'text-rose-400'
  const ti = live.ki > 0 ? live.kp / live.ki : null
  const td = live.kp > 0 ? live.kd / live.kp : 0

  return (
    <div className="min-h-screen space-y-4 bg-[#040a18] p-4 text-slate-200 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Señal de control</h1>
          <p className="text-sm text-slate-400">Lazo PID de nivel · el controlador corre en el Arduino</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mock && <Badge warn>Simulación</Badge>}
          <Badge ok={online}>{online ? 'Enlace en línea' : 'Sin datos'}</Badge>
          <Badge ok={auto} warn={!auto}>{auto ? 'Modo automático' : 'Modo manual'}</Badge>
          <Badge ok={!live.seg}>{live.seg ? 'Desborde · válvula cerrada' : 'Seguridad OK'}</Badge>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi title="Setpoint" icon={Target} value={f(live.sp)} unit="cm" sub="Referencia activa en el Arduino" color="text-emerald-300">
          <div className="mt-3 flex gap-2">
            <input
              type="number" step="0.5" min="0" max={H_SEG - 1} placeholder="nuevo SP"
              value={draft.sp ?? ''} onChange={(ev) => edit('sp', ev.target.value)}
              className="w-full rounded-lg border border-cyan-400/10 bg-[#050d1f] px-3 py-1.5 font-mono text-sm outline-none focus:border-cyan-400/50"
            />
            <button onClick={() => apply(['sp'])} className="rounded-lg bg-cyan-500 px-3 text-sm font-medium text-slate-950 hover:bg-cyan-400">
              Fijar
            </button>
          </div>
        </Kpi>
        <Kpi title="Variable de proceso" icon={Gauge} value={f(live.h)} unit="cm" sub={`${f((live.h / H_MAX) * 100)} % del tanque`} color="text-cyan-300" />
        <Kpi title="Error  e = SP − PV" icon={Activity} value={`${e > 0 ? '+' : ''}${f(e, 2)}`} unit="cm" sub={Math.abs(e) <= 0.5 ? 'Dentro de ±0.5 cm' : 'Fuera de banda'} color={eColor} />
        <Kpi title="Señal de control u" icon={SlidersHorizontal} value={f(live.u)} unit="%" sub="Apertura comandada de la válvula" color="text-amber-300">
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#050d1f]">
            <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${live.u}%` }} />
          </div>
        </Kpi>
        <Kpi title="Salida eléctrica" icon={Zap} value={f((live.pwm / 255) * VALVE_V)} unit="V prom." sub={`PWM ${live.pwm}/255 · duty ${f(live.pwm / 2.55, 0)} %`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Respuesta del tanque · altura vs. tiempo" icon={Activity}>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={hist} syncId="ctrl" margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => `${Math.round(t)}s`} {...axis} />
                  <YAxis domain={[0, H_MAX]} unit=" cm" {...axis} />
                  <Tooltip {...tip} formatter={(v, n) => [`${Number(v).toFixed(2)} cm`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={H_SEG} stroke="#f87171" strokeDasharray="2 4" label={{ value: `Corte ${H_SEG} cm`, fill: '#f87171', fontSize: 10, position: 'insideTopRight' }} />
                  <Line name="Setpoint" dataKey="sp" type="stepAfter" stroke="#34d399" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line name="Altura (PV)" dataKey="h" stroke="#22d3ee" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Señal de control · hacia la válvula" icon={Zap}>
            <div className="h-52">
              <ResponsiveContainer>
                <AreaChart data={hist} syncId="ctrl" margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => `${Math.round(t)}s`} {...axis} />
                  <YAxis domain={[0, 100]} unit=" %" {...axis} />
                  <Tooltip {...tip} formatter={(v) => [`${Number(v).toFixed(1)} %  ·  ${((v * VALVE_V) / 100).toFixed(1)} V prom.`, 'Señal de control']} />
                  <Area dataKey="u" type="stepAfter" stroke="#fbbf24" strokeWidth={2} fill="url(#gu)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Controlador PID" icon={SlidersHorizontal}>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#050d1f] p-1">
              {[['Manual', 0, Hand], ['Automático', 1, Bot]].map(([t, m, Icon]) => (
                <button
                  key={m} onClick={() => send({ modo: m })}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition ${live.modo === m ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                >
                  <Icon size={15} />
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Num label="Kp" unit="%/cm" step="0.1" value={val('kp')} onChange={(v) => edit('kp', v)} />
              <Num label="Ki" unit="%/cm·s" step="0.01" value={val('ki')} onChange={(v) => edit('ki', v)} />
              <Num label="Kd" unit="%·s/cm" step="0.1" value={val('kd')} onChange={(v) => edit('kd', v)} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Activo: Ti = Kp/Ki = {ti ? `${f(ti)} s` : '∞'} · Td = Kd/Kp = {f(td)} s
            </p>
            <button onClick={() => apply(['kp', 'ki', 'kd'])} className="mt-3 w-full rounded-lg bg-cyan-500 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Aplicar ganancias
            </button>

            <div className={`mt-4 ${auto ? 'opacity-40' : ''}`}>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Salida manual</span>
                <span className="font-mono text-white">{uMan} %</span>
              </div>
              <input
                type="range" min="0" max="100" disabled={auto} value={uMan}
                onChange={(ev) => setUMan(+ev.target.value)}
                onPointerUp={() => send({ uManual: uMan })} onKeyUp={() => send({ uManual: uMan })}
                className="w-full accent-cyan-400"
              />
            </div>
          </Card>

          <Card title="Métricas del transitorio" icon={Timer}>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Sobrepaso" value={f(metrics?.overshoot)} unit="%" />
              <Metric label="T. subida 10–90 %" value={f(metrics?.tr)} unit="s" />
              <Metric label="T. establ. ±2 %" value={f(metrics?.ts)} unit="s" />
              <Metric label="Error estacionario" value={f(metrics?.ess, 2)} unit="cm" />
              <Metric label="IAE" value={f(metrics?.iae, 0)} unit="cm·s" />
              <div className="flex items-center gap-2 rounded-xl bg-[#050d1f] p-3 text-xs text-slate-400">
                <ShieldAlert size={16} className="shrink-0 text-rose-300" />
                Corte a {H_SEG} cm
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Calculadas desde el último cambio de setpoint (escalón ≥ 2 cm).</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
