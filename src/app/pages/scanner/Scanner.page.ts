import {
  Component, OnInit, OnDestroy, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { BiometricoService } from '../../services/biometrico.service';
import { Empleado } from '../../models/empleado.model';
import { environment } from '../../../environments/environment';
import { KioskoAuthService } from '../../services/kiosko-auth.service';


@Component({
  selector: 'app-scanner',
  templateUrl: './scanner.page.html',
  styleUrls: ['./scanner.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class ScannerPage implements OnInit, OnDestroy {

  empleado!: Empleado;
  modo = 'entrada';

  private fotoBlob: Blob | null = null;
  private reintentoTimer: any = null;

  constructor(
    private bio:    BiometricoService,
    private auth:   KioskoAuthService,
    private router: Router,
    private zone:   NgZone,
  ) {}

  async ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/home']); return; }
    this.empleado = state.empleado;
    this.modo     = state.modo || 'entrada';

    if (this.empleado.fotos) {
      try { this.fotoBlob = await this.bio.descargarFoto(this.empleado.fotos); }
      catch { console.warn('No se pudo descargar foto'); }
    }

    await this.iniciarEscaneo();
  }

  ngOnDestroy() {
    if (this.reintentoTimer) clearTimeout(this.reintentoTimer);
  }

  // ── Flujo principal ───────────────────────────────────────────────
  async iniciarEscaneo() {
    try {
      const fotoCapturada = await this.abrirScannerOverlay();
      if (!fotoCapturada) { this.cancelar(); return; }

      this.mostrarOverlayProcesando();

      if (!this.fotoBlob) {
        await this.registrar(); return;
      }

      const score = await this.compararConLuxand(this.fotoBlob, fotoCapturada);
      this.zone.run(async () => {
        if (score >= environment.similarityThreshold) {
          await this.registrar();
        } else {
          const pct = Math.round(score * 100);
          this.mostrarResultadoFinal('fail',
            'Rostro no coincide. Acceso denegado.',
            `Coincidencia: ${pct}% — se requiere 90%`
          );
          this.reintentoTimer = setTimeout(() => this.iniciarEscaneo(), 1000);
        }
      });

    } catch (err: any) {
      this.zone.run(() => {
        this.mostrarResultadoFinal('fail', 'Error al verificar', err?.message || '');
        this.reintentoTimer = setTimeout(() => this.iniciarEscaneo(), 1000);
      });
    }
  }

  // ── Registro — EP viejo /biometrico/registro ──────────────────────
  private async registrar() {
    try {
      const sesion = this.auth.getSesion();

      // IP y GPS en paralelo
      const [ipRes, geoRes] = await Promise.allSettled([
        this.bio.obtenerIP(),
        this.bio.obtenerGeo(),
      ]);

      const ip  = ipRes.status  === 'fulfilled' ? ipRes.value  : 'No disponible';
      const lat = geoRes.status === 'fulfilled' ? geoRes.value.lat : null;
      const lon = geoRes.status === 'fulfilled' ? geoRes.value.lon : null;

      if (lat === null || lon === null) {
        this.mostrarResultadoFinal('fail',
          'No se pudo obtener ubicación GPS',
          'Activa el GPS e intenta de nuevo'
        );
        this.reintentoTimer = setTimeout(() => this.iniciarEscaneo(), 1000);
        return;
      }

      const res: any = await this.bio.registrarAsistenciaLegacy({
        id_empleado:   this.empleado.id,
        lat, lon, ip,
        salida:        this.modo === 'salida',
        id_capturista: sesion?.operadorId ?? 0,
      });

      this.zone.run(() => {
        if (res.status === 'ok') {
          const esSalida = this.modo === 'salida';
          const retardo  = res.data?.estado_entrada === 'retardo_grave' || res.data?.estado_entrada === 'retardo_leve';
          this.mostrarResultadoFinal(
            retardo ? 'retardo' : 'ok',
            esSalida ? '¡Salida registrada!' : (retardo ? `Entrada con retardo de ${res.data?.minutos_retardo} min` : '¡Entrada registrada!'),
            esSalida ? 'Hasta pronto' : (res.data?.hora_salida_esperada ? `Salida esperada: ${res.data.hora_salida_esperada}` : 'Bienvenido')
          );
          setTimeout(() => {
            const overlay = document.getElementById('sc-result-overlay');
            if (overlay) overlay.remove();
            this.router.navigate(['/home']);
          }, retardo ? 1000 : 1500);

        } else if (res.status === 'bloqueado') {
          this.mostrarModalBloqueado(res);
        } else {
          this.mostrarModalError(res.message || 'Error al registrar');
        }
      });

    } catch (err: any) {
      this.zone.run(() => {
        if (err?.status === 423) {
          this.mostrarModalBloqueado(err.error);
          return;
        }
        if (err?.status === 409) {
          this.mostrarModalError(err.error?.message || 'Registro duplicado');
          return;
        }
        this.mostrarResultadoFinal('fail', err.message || 'Error al registrar', 'Intenta de nuevo');
        this.reintentoTimer = setTimeout(() => this.iniciarEscaneo(), 1000);
      });
    }
  }

  // ── Modal bloqueado — salida anticipada ──────────────────────────
  private mostrarModalBloqueado(res: any) {
    const existing = document.getElementById('sc-result-overlay');
    if (existing) existing.remove();

    const d = res?.data || {};

    const overlay = document.createElement('div');
    overlay.id = 'sc-result-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:0;padding:0 24px;
    `;

    overlay.innerHTML = `
      <!-- Icono candado -->
      <svg width="80" height="80" viewBox="0 0 80 80" style="margin-bottom:16px">
        <circle cx="40" cy="40" r="36" fill="rgba(240,84,84,0.12)" stroke="#f05454" stroke-width="2"/>
        <rect x="26" y="38" width="28" height="20" rx="3" fill="none" stroke="#f05454" stroke-width="2.5"/>
        <path d="M 30 38 Q 30 26 40 26 Q 50 26 50 38"
          fill="none" stroke="#f05454" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="40" cy="47" r="3" fill="#f05454"/>
      </svg>

      <p style="color:#f05454;font-size:20px;font-family:sans-serif;margin:0 0 6px;font-weight:700;text-align:center;">
        Turno no cumplido
      </p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;font-family:sans-serif;margin:0 0 20px;
        letter-spacing:2px;text-align:center;text-transform:uppercase;">
        SALIDA ANTICIPADA
      </p>

      <!-- Card con info -->
      <div style="
        background:rgba(240,84,84,0.08);border:1px solid rgba(240,84,84,0.25);
        border-radius:16px;padding:20px;width:100%;max-width:300px;
        display:flex;flex-direction:column;gap:12px;margin-bottom:20px;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <span style="font-size:13px;color:rgba(255,255,255,.5);font-family:sans-serif;">Puedes salir a partir de:</span>
          <span style="font-size:14px;font-weight:700;color:#fff;font-family:sans-serif;text-align:right;">${d.hora_salida_valida || '—'}</span>
        </div>
        <div style="height:1px;background:rgba(255,255,255,.08);"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <span style="font-size:13px;color:rgba(255,255,255,.5);font-family:sans-serif;">Tiempo restante:</span>
          <span style="font-size:18px;font-weight:800;color:#f05454;font-family:sans-serif;">${d.tiempo_restante || '—'}</span>
        </div>
        <div style="height:1px;background:rgba(255,255,255,.08);"></div>
        <p style="font-size:12px;color:rgba(255,255,255,.35);margin:0;line-height:1.5;font-family:sans-serif;text-align:center;">
          Se generó una incidencia. Tu supervisor fue notificado.
        </p>
      </div>

      <!-- Botón cerrar -->
      <button id="sc-modal-close" style="
        background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);
        border:1px solid rgba(255,255,255,.2);border-radius:40px;
        padding:13px 40px;font-size:14px;cursor:pointer;
        font-family:sans-serif;letter-spacing:.5px;
      ">Entendido</button>
    `;

    document.body.appendChild(overlay);

    document.getElementById('sc-modal-close')?.addEventListener('click', () => {
      overlay.remove();
      this.router.navigate(['/home']);
    });
  }

  // ── Modal error genérico (409, doble registro, etc.) ─────────────
  private mostrarModalError(mensaje: string) {
    const existing = document.getElementById('sc-result-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'sc-result-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:0;padding:0 24px;
    `;

    overlay.innerHTML = `
      <svg width="80" height="80" viewBox="0 0 80 80" style="margin-bottom:16px">
        <circle cx="40" cy="40" r="36" fill="rgba(244,183,64,0.12)" stroke="#f4b740" stroke-width="2"/>
        <path d="M 40 24 L 40 46 M 40 54 L 40 56"
          fill="none" stroke="#f4b740" stroke-width="3.5" stroke-linecap="round"/>
      </svg>

      <p style="color:#f4b740;font-size:20px;font-family:sans-serif;margin:0 0 6px;font-weight:700;text-align:center;">
        No se pudo registrar
      </p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;font-family:sans-serif;margin:0 0 20px;
        letter-spacing:2px;text-align:center;text-transform:uppercase;">
        AVISO
      </p>

      <!-- Card con mensaje -->
      <div style="
        background:rgba(244,183,64,0.08);border:1px solid rgba(244,183,64,0.25);
        border-radius:16px;padding:20px;width:100%;max-width:300px;
        margin-bottom:20px;
      ">
        <p style="font-size:14px;color:rgba(255,255,255,.8);margin:0;line-height:1.6;
          font-family:sans-serif;text-align:center;font-weight:500;">
          ${mensaje}
        </p>
      </div>

      <!-- Botones -->
      <div style="display:flex;gap:10px;width:100%;max-width:300px;">
        <button id="sc-modal-home" style="
          flex:1;background:rgba(255,255,255,.06);color:rgba(255,255,255,.6);
          border:1px solid rgba(255,255,255,.15);border-radius:40px;
          padding:13px;font-size:13px;cursor:pointer;font-family:sans-serif;
        ">Ir al inicio</button>
        <button id="sc-modal-retry" style="
          flex:1;background:rgba(244,183,64,.15);color:#f4b740;
          border:1px solid rgba(244,183,64,.3);border-radius:40px;
          padding:13px;font-size:13px;cursor:pointer;font-family:sans-serif;font-weight:600;
        ">Reintentar</button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('sc-modal-home')?.addEventListener('click', () => {
      overlay.remove();
      this.router.navigate(['/home']);
    });

    document.getElementById('sc-modal-retry')?.addEventListener('click', () => {
      overlay.remove();
      this.iniciarEscaneo();
    });
  }

  // ── Scanner overlay — IGUAL al scanner-login ─────────────────────
  private abrirScannerOverlay(): Promise<Blob | null> {
    return new Promise((resolve, reject) => {

      const styleEl = document.createElement('style');
      styleEl.textContent = `
        @keyframes sl-pulse {
          0%,100% { stroke:#1A5DAB; filter:drop-shadow(0 0 8px #1A5DAB88); }
          50%      { stroke:#00D4FF; filter:drop-shadow(0 0 18px #00D4FFCC); }
        }
        @keyframes sl-scan {
          0%   { top:12%; opacity:0; }
          8%   { opacity:1; }
          92%  { opacity:1; }
          100% { top:68%; opacity:0; }
        }
        #sl-oval { animation: sl-pulse 2s ease-in-out infinite; }
        .sl-beam {
          position:absolute; left:50%; transform:translateX(-50%);
          width:66%; height:2px; border-radius:2px;
          background:linear-gradient(90deg,transparent,rgba(0,212,255,.9) 50%,transparent);
          box-shadow:0 0 12px rgba(0,212,255,.8);
          animation:sl-scan 2.2s ease-in-out infinite; z-index:10;
          pointer-events:none;
        }
      `;
      document.head.appendChild(styleEl);

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:#000;z-index:99999;overflow:hidden;
      `;

      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true;
      video.style.cssText = `
        position:absolute;
        top:50%; left:50%;
        transform:translate(-50%, -40%) scaleX(-1);
        width:100%; height:auto; min-height:100%;
        object-fit:cover;
        clip-path:ellipse(42% 32% at 50% 36%);
        z-index:1;
      `;

      const NS  = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = `
        position:absolute;top:0;left:0;width:100%;height:100%;
        z-index:2;pointer-events:none;
      `;

      const modoColor = this.modo === 'salida' ? '#f05454' : '#22c97a';
      const modoLabel = this.modo === 'salida' ? 'Salida' : 'Entrada';
      const initials  = this.getInitials(this.empleado?.nombreCompleto || '');

      svg.innerHTML = `
        <defs>
          <mask id="sl-mask">
            <rect x="0" y="0" width="100" height="100" fill="white"/>
            <ellipse cx="50" cy="42" rx="42" ry="34" fill="black"/>
          </mask>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.82)" mask="url(#sl-mask)"/>
        <ellipse id="sl-oval" cx="50" cy="45" rx="40" ry="32"
          fill="none" stroke="#1A5DAB" stroke-width="0.8"/>
        <ellipse cx="50" cy="45" rx="44" ry="34"
          fill="none" stroke="#1A5DAB" stroke-width="0.3"
          stroke-dasharray="5 4" opacity="0.4" stroke-dashoffset="0">
          <animate attributeName="stroke-dashoffset" from="0" to="100" dur="12s" repeatCount="indefinite"/>
        </ellipse>
        <g stroke="#00D4FF" stroke-width="0.7" fill="none" opacity="0.9">
          <path d="M 5 20 L 5 15 L 10 15"/>
          <path d="M 95 20 L 95 15 L 90 15"/>
          <path d="M 5 80 L 5 85 L 10 85"/>
          <path d="M 95 80 L 95 85 L 90 85"/>
        </g>
        <circle cx="50" cy="4" r="0.8" fill="#00D4FF">
          <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="50" cy="96" r="0.8" fill="#00D4FF">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      `;

      const beam = document.createElement('div');
      beam.className = 'sl-beam';

      const badge = document.createElement('div');
      badge.style.cssText = `
        position:absolute;top:4%;left:50%;transform:translateX(-50%);
        display:flex;align-items:center;gap:10px;
        background:rgba(0,0,0,0.6);
        border:1px solid rgba(0,195,255,0.3);
        border-radius:40px;padding:8px 16px 8px 8px;
        z-index:6;pointer-events:none;
        backdrop-filter:blur(8px);white-space:nowrap;
      `;
      badge.innerHTML = `
        <div style="width:30px;height:30px;border-radius:50%;
          background:linear-gradient(135deg,#2356a8,#1a3a6b);
          display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:700;color:#fff;flex-shrink:0;">
          ${initials}
        </div>
        <div style="display:flex;flex-direction:column;gap:1px;min-width:0;">
          <span style="font-size:12px;font-weight:600;color:#fff;font-family:sans-serif;
            max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${this.empleado?.nombreCompleto || ''}
          </span>
          <span style="font-size:10px;color:rgba(255,255,255,.45);font-family:monospace;letter-spacing:.5px;">
            ${this.empleado?.curp || ''}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;
          padding:4px 10px;border-radius:20px;flex-shrink:0;
          background:rgba(${this.modo==='salida'?'240,84,84':'34,201,122'},.2);
          color:${modoColor};border:1px solid ${modoColor};font-family:sans-serif;">
          ${modoLabel}
        </div>
      `;

      const statusWrap = document.createElement('div');
      statusWrap.style.cssText = `
        position:absolute;bottom:16%;left:0;right:0;
        text-align:center;z-index:5;pointer-events:none;
      `;
      const statusTxt = document.createElement('p');
      statusTxt.style.cssText = `
        color:#fff;font-size:17px;font-family:sans-serif;
        margin:0 0 6px;letter-spacing:0.5px;font-weight:600;
      `;
      statusTxt.textContent = 'Coloca tu rostro en el óvalo';

      const statusSub = document.createElement('p');
      statusSub.style.cssText = `
        color:rgba(0,212,255,0.85);font-size:11px;
        font-family:sans-serif;margin:0;letter-spacing:3px;
      `;
      statusSub.textContent = 'RECONOCIMIENTO FACIAL';

      const btnCancelar = document.createElement('button');
      btnCancelar.textContent = 'Cancelar';
      btnCancelar.style.cssText = `
        position:absolute;bottom:5%;left:50%;transform:translateX(-50%);
        background:transparent;color:rgba(255,255,255,0.5);
        border:1px solid rgba(255,255,255,0.25);border-radius:20px;
        padding:10px 32px;font-size:13px;cursor:pointer;
        font-family:sans-serif;letter-spacing:1px;z-index:5;
      `;

      statusWrap.appendChild(statusTxt);
      statusWrap.appendChild(statusSub);
      overlay.appendChild(video);
      overlay.appendChild(svg);
      overlay.appendChild(beam);
      overlay.appendChild(badge);
      overlay.appendChild(statusWrap);
      overlay.appendChild(btnCancelar);
      document.body.appendChild(overlay);

      let stream: MediaStream;
      let intervalo: any;
      let capturado = false;
      let intentos  = 0;

      const cleanup = () => {
        clearInterval(intervalo);
        stream?.getTracks().forEach(t => t.stop());
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        if (document.head.contains(styleEl)) document.head.removeChild(styleEl);
      };

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }).then(s => {
        stream = s;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          intervalo = setInterval(() => {
            if (capturado) return;
            intentos++;
            const canvas  = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 640;
            canvas.height = video.videoHeight || 480;
            const ctx     = canvas.getContext('2d')!;
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0);
            if ('FaceDetector' in window) {
              const fd = new (window as any).FaceDetector({ fastMode: true });
              fd.detect(canvas).then((faces: any[]) => {
                if ((faces.length > 0 || intentos >= 6) && !capturado) disparar(canvas, statusTxt, statusSub, cleanup, resolve, reject);
              }).catch(() => {
                if (intentos >= 5 && !capturado) disparar(canvas, statusTxt, statusSub, cleanup, resolve, reject);
              });
            } else {
              if (intentos >= 4 && !capturado) disparar(canvas, statusTxt, statusSub, cleanup, resolve, reject);
            }
          }, 750);
        };
      }).catch(err => {
        cleanup();
        reject(new Error('Sin acceso a la cámara: ' + err.message));
      });

      const disparar = (
        canvas: HTMLCanvasElement,
        sTxt: HTMLElement, sSub: HTMLElement,
        clean: () => void,
        res: (b: Blob | null) => void,
        rej: (e: Error) => void
      ) => {
        capturado = true;
        sTxt.textContent = '¡Rostro detectado!';
        sTxt.style.color = '#22c97a';
        sSub.textContent = 'VERIFICANDO...';
        sSub.style.color = 'rgba(0,255,150,0.9)';
        setTimeout(() => {
          canvas.toBlob(blob => {
            clean();
            if (blob) res(blob);
            else rej(new Error('Error al capturar imagen'));
          }, 'image/jpeg', 0.9);
        }, 700);
      };

      btnCancelar.onclick = () => { cleanup(); resolve(null); };
    });
  }

  private async compararConLuxand(foto1: Blob, foto2: Blob): Promise<number> {
    const form = new FormData();
    form.append('face1', foto1, 'face1.jpg');
    form.append('face2', foto2, 'face2.jpg');

    const headers = new Headers();
    headers.append('token', environment.luxandToken);

    const res = await fetch('https://api.luxand.cloud/photo/similarity', {
      method: 'POST', headers, body: form
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Luxand ${res.status}: ${txt}`);
    }

    const json = await res.json();
    if (json.status === 'failure') throw new Error(json.message);

    return json.score ?? json.similarity ?? (json.similar ? 1 : 0);
  }

  // ── Overlay procesando ────────────────────────────────────────────
  private mostrarOverlayProcesando() {
    const existing = document.getElementById('sc-result-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'sc-result-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
    `;
    overlay.innerHTML = `
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="34" fill="none" stroke="#4f8ef7" stroke-width="2.5" stroke-dasharray="8 4">
          <animateTransform attributeName="transform" type="rotate"
            from="0 40 40" to="360 40 40" dur="1.2s" repeatCount="indefinite"/>
        </circle>
        <text x="40" y="45" text-anchor="middle" font-size="14" fill="#4f8ef7" font-family="monospace">AI</text>
      </svg>
      <p style="color:#fff;font-size:17px;font-family:sans-serif;margin:0;font-weight:600;">Verificando identidad...</p>
      <p style="color:rgba(79,142,247,.8);font-size:11px;font-family:sans-serif;margin:0;letter-spacing:3px;">COMPARANDO ROSTROS</p>
    `;
    document.body.appendChild(overlay);
  }

  // ── Overlay resultado final ───────────────────────────────────────
  private mostrarResultadoFinal(tipo: 'ok' | 'fail' | 'retardo' | 'bloqueado', titulo: string, subtitulo: string) {
    const existing = document.getElementById('sc-result-overlay');
    if (existing) existing.remove();

    const colorMap: Record<string, string> = {
      ok: '#22c97a', fail: '#f05454', retardo: '#f5a623', bloqueado: '#f05454'
    };

    const svgMap: Record<string, string> = {
      ok: `
        <circle cx="40" cy="40" r="34" fill="none" stroke="#00D4FF" stroke-width="2.5"
          stroke-dasharray="214" stroke-dashoffset="214">
          <animate attributeName="stroke-dashoffset" from="214" to="0" dur="0.5s" fill="freeze"/>
        </circle>
        <path d="M 24 40 L 35 51 L 56 28" fill="none" stroke="#22c97a" stroke-width="4"
          stroke-linecap="round" stroke-linejoin="round"
          stroke-dasharray="55" stroke-dashoffset="55">
          <animate attributeName="stroke-dashoffset" from="55" to="0" dur="0.4s" begin="0.4s" fill="freeze"/>
        </path>`,
      fail: `
        <circle cx="40" cy="40" r="34" fill="none" stroke="#f05454" stroke-width="2.5"/>
        <path d="M 26 26 L 54 54 M 54 26 L 26 54" fill="none" stroke="#f05454" stroke-width="4" stroke-linecap="round"/>`,
      retardo: `
        <circle cx="40" cy="40" r="34" fill="none" stroke="#f5a623" stroke-width="2.5"/>
        <path d="M 40 22 L 40 42 M 40 50 L 40 52" fill="none" stroke="#f5a623" stroke-width="4" stroke-linecap="round"/>`,
      bloqueado: `
        <circle cx="40" cy="40" r="34" fill="none" stroke="#f05454" stroke-width="2.5"/>
        <rect x="28" y="38" width="24" height="18" rx="2" fill="none" stroke="#f05454" stroke-width="3"/>
        <path d="M 32 38 Q 32 28 40 28 Q 48 28 48 38" fill="none" stroke="#f05454" stroke-width="3" stroke-linecap="round"/>`,
    };

    const overlay = document.createElement('div');
    overlay.id = 'sc-result-overlay';
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.92);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:14px;padding:0 32px;
    `;
    overlay.innerHTML = `
      <svg width="90" height="90" viewBox="0 0 80 80">${svgMap[tipo]}</svg>
      <p style="color:${colorMap[tipo]};font-size:19px;font-family:sans-serif;margin:0;font-weight:700;text-align:center;">
        ${titulo}
      </p>
      <p style="color:rgba(255,255,255,.5);font-size:12px;font-family:sans-serif;margin:0;
        letter-spacing:2px;text-align:center;text-transform:uppercase;">
        ${subtitulo}
      </p>
    `;
    document.body.appendChild(overlay);
  }

  cancelar() {
    if (this.reintentoTimer) clearTimeout(this.reintentoTimer);
    const overlay = document.getElementById('sc-result-overlay');
    if (overlay) overlay.remove();
    this.router.navigate(['/home']);
  }

  getInitials(nombre: string): string {
    if (!nombre) return 'US';
    return nombre.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  }
}
