const int pinSensor = A0;

// ====== ZONA DE CALIBRACIÓN ELÉCTRICA =====
const float Vref = 5.08;
const int N_SAMPLES = 50;

// ====== CALIBRACIÓN FÍSICA  =========
const float V_VACIO = 0.50;
const float OFFSET_ALTURA = 3.725;
const float Hmax = 50.0;
const float CM_POR_VOLTIO = 10.17;

// ====== CORRECCIÓN POR SEGMENTOS (según el voltaje filtrado) ======
// Cada fila es un punto: a ese voltaje se suma esa corrección en cm.
// Entre puntos se interpola linealmente (sin saltos bruscos).
// Corrección = (lo que marca la regla) - (lo que marca el sensor)
//   > 0 : el sensor marca de menos  -> se suma
//   < 0 : el sensor marca de más    -> se resta
const int N_CORR = 4;
const float corrV[N_CORR]  = { 0.626, 2.100, 3.083, 5.050 };  // = 5, 20, 30 y 50 cm
const float corrCm[N_CORR] = { +0.40, 0.00,  0.00,  -0.40 };

float correccionCm(float v) {
  if (v <= corrV[0]) return corrCm[0];
  if (v >= corrV[N_CORR - 1]) return corrCm[N_CORR - 1];
  for (int i = 0; i < N_CORR - 1; i++) {
    if (v <= corrV[i + 1]) {
      float t = (v - corrV[i]) / (corrV[i + 1] - corrV[i]);
      return corrCm[i] + t * (corrCm[i + 1] - corrCm[i]);
    }
  }
  return 0.0;
}

// ====== VARIABLES DEL FILTRO EMA ==========
float voltajeFiltrado = -1.0;
const float factorSuavizado = 0.30;

// =====================================================================
// ============  CONTROL PID  (SECCIÓN NUEVA)  =========================
// =====================================================================
// Salida: módulo puente H (L298N) usado en un solo sentido
//   ENA <- PWM (pin 5, ~980 Hz)      IN1 = HIGH      IN2 = LOW
// Ley de control (forma paralela, salida en % de apertura):
//   u = Kp*e + I + D          e = SP - h          I += Ki*e*dt
//   La D se calcula sobre la medición (sin "patada" al cambiar el SP) y filtrada.
//   Anti-windup: no se integra mientras la salida esté saturada.
// Unidades:  Kp [%/cm]   Ki [%/(cm*s)]   Kd [%*s/cm]
//
// Comandos por serial (cada uno termina en salto de línea):
//   SP:35.0   setpoint en cm          KP:2.0   KI:0.05   KD:0.0   ganancias
//   M:1       automático (M:0 = manual)       U:40   salida manual en %
// En cada ciclo se envía UNA línea JSON adicional con el estado del lazo.

const int pinENA = 5;
const int pinIN1 = 7;
const int pinIN2 = 8;

const float H_SEGURIDAD = 47.0;    // cm: por encima, la válvula se cierra a la fuerza
const int   PWM_MIN_APERTURA = 0;  // duty (0-255) en el que la válvula EMPIEZA a abrir (se mide)
const float U_MIN = 0.0;
const float U_MAX = 100.0;
const float TAU_D = 1.0;           // s, constante del filtro de la derivada

float spCm = 25.0;
float kp = 2.0, ki = 0.05, kd = 0.0;
bool  modoAuto = false;            // arranca en MANUAL con la válvula cerrada
float uManual = 0.0;
float uSalida = 0.0;
int   ultimoPwm = 0;
float integral = 0.0, derivadaFilt = 0.0, pvPrev = 0.0;
unsigned long tPrev = 0;
bool  enSeguridad = false;
char  bufCmd[24];
byte  nBuf = 0;

void aplicarSalida(float u) {
  uSalida = constrain(u, U_MIN, U_MAX);
  int pwm = 0;
  if (uSalida > 0.0) {
    pwm = PWM_MIN_APERTURA + (int)(uSalida * (255 - PWM_MIN_APERTURA) / 100.0 + 0.5);
  }
  ultimoPwm = constrain(pwm, 0, 255);
  analogWrite(pinENA, ultimoPwm);
}

void procesarComando(char *c) {
  char *dos = strchr(c, ':');
  if (!dos) return;
  *dos = 0;
  float v = atof(dos + 1);
  if      (!strcmp(c, "SP")) spCm = constrain(v, 0.0, H_SEGURIDAD - 1.0);
  else if (!strcmp(c, "KP")) kp = constrain(v, 0.0, 100.0);
  else if (!strcmp(c, "KI")) ki = constrain(v, 0.0, 100.0);
  else if (!strcmp(c, "KD")) kd = constrain(v, 0.0, 100.0);
  else if (!strcmp(c, "U"))  uManual = constrain(v, U_MIN, U_MAX);
  else if (!strcmp(c, "M")) {
    bool nuevo = (v > 0.5);
    if (nuevo && !modoAuto) {                    // manual -> auto sin salto (bumpless)
      integral = uSalida - kp * (spCm - pvPrev);
      derivadaFilt = 0.0;
    }
    if (!nuevo && modoAuto) uManual = uSalida;   // auto -> manual: se queda donde estaba
    modoAuto = nuevo;
  }
}

void leerComandos() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (nBuf > 0) { bufCmd[nBuf] = 0; procesarComando(bufCmd); nBuf = 0; }
    } else if (nBuf < sizeof(bufCmd) - 1) {
      bufCmd[nBuf++] = ch;
    } else {
      nBuf = 0;                                  // línea demasiado larga: se descarta
    }
  }
}

void controlSetup() {
  pinMode(pinENA, OUTPUT);
  pinMode(pinIN1, OUTPUT);
  pinMode(pinIN2, OUTPUT);
  digitalWrite(pinIN1, HIGH);
  digitalWrite(pinIN2, LOW);
  aplicarSalida(0.0);
}

void controlLoop(float pv) {
  leerComandos();

  // dt real medido (el ciclo del sketch no es exactamente fijo)
  unsigned long ahora = millis();
  float dt = (ahora - tPrev) / 1000.0;
  tPrev = ahora;
  if (dt <= 0.0 || dt > 5.0) dt = 0.3;

  float e = spCm - pv;
  float dPv = (pv - pvPrev) / dt;
  derivadaFilt += (dt / (TAU_D + dt)) * (-dPv - derivadaFilt);
  pvPrev = pv;

  enSeguridad = (pv >= H_SEGURIDAD);
  float u;
  if (enSeguridad) {
    u = 0.0;
    integral = 0.0;
    uManual = 0.0;
  } else if (!modoAuto) {
    u = uManual;
  } else {
    float uPre = kp * e + integral + kd * derivadaFilt;
    bool saturado = (uPre >= U_MAX && e > 0) || (uPre <= U_MIN && e < 0);
    if (!saturado) integral += ki * e * dt;
    integral = constrain(integral, U_MIN, U_MAX);
    u = kp * e + integral + kd * derivadaFilt;
  }
  aplicarSalida(u);

  Serial.print("{\"sp\":");     Serial.print(spCm, 1);
  Serial.print(",\"u\":");      Serial.print(uSalida, 1);
  Serial.print(",\"pwm\":");    Serial.print(ultimoPwm);
  Serial.print(",\"modo\":");   Serial.print(modoAuto ? 1 : 0);
  Serial.print(",\"kp\":");     Serial.print(kp, 3);
  Serial.print(",\"ki\":");     Serial.print(ki, 4);
  Serial.print(",\"kd\":");     Serial.print(kd, 3);
  Serial.print(",\"seg\":");    Serial.print(enSeguridad ? 1 : 0);
  Serial.println("}");
}
// ================= FIN CONTROL PID ===================================

void setup() {
  Serial.begin(115200);
  delay(2000);
  controlSetup();                 // <-- NUEVO (control PID)
}

void loop() {
  // 1. Sobremuestreo (50 lecturas rápidas)
  long suma = 0;
  for (int i = 0; i < N_SAMPLES; i++) {
    suma += analogRead(pinSensor);
    delay(2);
  }
  float promedio_crudo = suma / (float)N_SAMPLES;
  float v_crudo = (promedio_crudo * Vref) / 1023.0;

  // 2. Filtro Exponencial Móvil (EMA)
  if (voltajeFiltrado < 0) {
    voltajeFiltrado = v_crudo;
  } else {
    voltajeFiltrado = (factorSuavizado * v_crudo) + ((1.0 - factorSuavizado) * voltajeFiltrado);
  }

  // 3. Aplicar Tara
  float v_tanque_neto = voltajeFiltrado - V_VACIO;
  float nivel_cm = 0.00;

  // 4. Calcular Altura (+ corrección por segmentos)
  if (v_tanque_neto <= 0.05) {
    nivel_cm = 0.00;
  } else {
    nivel_cm = (v_tanque_neto * CM_POR_VOLTIO) + OFFSET_ALTURA;
    nivel_cm += correccionCm(voltajeFiltrado);   // <-- ÚNICA LÍNEA NUEVA
  }

  if (nivel_cm > Hmax) nivel_cm = Hmax;
  if (nivel_cm < 0)    nivel_cm = 0;

  // ====== ENVÍO DE DATOS EN FORMATO JSON ===========
  Serial.print("{\"vSensor\":");
  Serial.print(v_crudo, 3);
  Serial.print(",\"vFiltrado\":");
  Serial.print(voltajeFiltrado, 3);
  Serial.print(",\"h\":");
  Serial.print(nivel_cm, 2);
  Serial.println("}");

  controlLoop(nivel_cm);           // <-- NUEVO (control PID)

  delay(200);
}
