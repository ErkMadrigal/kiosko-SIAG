import {
  Component, OnInit, OnDestroy, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  closeOutline, cameraOutline, refreshOutline,
  checkmarkCircleOutline, closeCircleOutline
} from 'ionicons/icons';
import { BiometricoService } from '../../services/biometrico.service';
import { KioskoAuthService } from '../../services/kiosko-auth.service';
import { Empleado } from '../../models/empleado.model';
import { environment } from '../../../environments/environment';

type Estado = 'listo' | 'capturando' | 'procesando' | 'ok' | 'fail';

@Component({
  selector: 'app-scanner-login',
  templateUrl: './scanner-login.page.html',
  styleUrls: ['./scanner-login.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
})
export class ScannerLoginPage implements OnInit, OnDestroy {

  empleado!: Empleado;
  estado: Estado = 'listo';
  mensaje    = 'Listo para escanear';
  submensaje = 'Presiona el botón para iniciar el reconocimiento facial';

  private fotoBlob:       Blob | null = null;
  private reintentoTimer: any = null;

  constructor(
    private bio:    BiometricoService,
    private auth:   KioskoAuthService,
    private router: Router,
    private zone:   NgZone,
  ) {
    addIcons({ closeOutline, cameraOutline, refreshOutline,
               checkmarkCircleOutline, closeCircleOutline });
  }

  async ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/login']); return; }
    this.empleado = state.empleado;

    if (this.empleado.fotos) {
      try { this.fotoBlob = await this.bio.descargarFoto(this.empleado.fotos); }
      catch { console.warn('Sin foto del empleado'); }
    }
  }

  ngOnDestroy() {
    if (this.reintentoTimer) clearTimeout(this.reintentoTimer);
  }

  async iniciarEscaneo() {
    if (this.estado === 'capturando' || this.estado === 'procesando') return;
    this.setEstado('capturando', 'Mira a la cámara', 'Coloca tu rostro dentro del óvalo');

    try {
      const fotoCapturada = await this.abrirScannerOverlay();

      if (!fotoCapturada) {
        this.setEstado('listo', 'Listo para escanear', 'Presiona el botón para iniciar el reconocimiento facial');
        return;
      }

      this.setEstado('procesando', 'Verificando identidad...', 'Comparando con el registro del sistema');

      if (!this.fotoBlob) {
        await this.accesoConcedido(); return;
      }

      // Comparar con Luxand directo (usando fetch para mayor control)
      const resultado = await this.compararConLuxand(this.fotoBlob, fotoCapturada);

      this.zone.run(async () => {
        if (resultado >= environment.similarityThreshold) {
          await this.accesoConcedido();
        } else {
          const pct = Math.round(resultado * 100);
          this.setEstado('fail', 'Identidad no verificada',
            `Coincidencia del ${pct}% — se requiere 90% o más. Intenta con mejor iluminación.`);
          this.reintentoTimer = setTimeout(() => this.reintentar(), 4000);
        }
      });

    } catch (err: any) {
      this.zone.run(() => {
        this.setEstado('fail', 'Error al verificar', this.traducirError(err?.message || ''));
        this.reintentoTimer = setTimeout(() => this.reintentar(), 3000);
      });
    }
  }

  // ── Luxand directo con fetch ──────────────────────────────────────────
  private async compararConLuxand(foto1: Blob, foto2: Blob): Promise<number> {
    const form = new FormData();
    form.append('face1', foto1, 'face1.jpg');
    form.append('face2', foto2, 'face2.jpg');

    const headers = new Headers();
    headers.append('token', environment.luxandToken);

    const res  = await fetch('https://api.luxand.cloud/photo/similarity', {
      method: 'POST', headers, body: form
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Luxand ${res.status}: ${txt}`);
    }

    const json = await res.json();
    if (json.status === 'failure') throw new Error(json.message);

    // Luxand puede devolver score o similarity
    return json.score ?? json.similarity ?? (json.similar ? 1 : 0);
  }

  // ── Scanner overlay DOM nativo ────────────────────────────────────────
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
        @keyframes sl-rot {
          from { transform-origin:50% 40%; transform:rotate(0deg); }
          to   { transform-origin:50% 40%; transform:rotate(360deg); }
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

      // Contenedor principal
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:#000;z-index:99999;overflow:hidden;
      `;

      // Video — cámara frontal visible solo dentro del clip oval
      const video = document.createElement('video');
      video.autoplay    = true;
      video.playsInline = true;
      video.muted       = true;
      video.style.cssText = `
        position:absolute;
        top:50%; left:50%;
        transform:translate(-50%, -40%) scaleX(-1);
        width:100%; height:auto; min-height:100%;
        object-fit:cover;
        clip-path:ellipse(42% 32% at 50% 36%);

        z-index:1;
      `;

      // SVG con máscara y decoraciones
      const NS  = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = `
        position:absolute;top:0;left:0;width:100%;height:100%;
        z-index:2;pointer-events:none;
      `;

      svg.innerHTML = `
        <defs>
          <mask id="sl-mask">
            <rect x="0" y="0" width="100" height="100" fill="white"/>
            <ellipse cx="50" cy="42" rx="42" ry="34" fill="black"/>
          </mask>
        </defs>

        <!-- Capa oscura con agujero oval -->
        <rect x="0" y="0" width="100" height="100"
          fill="rgba(0,0,0,0.82)" mask="url(#sl-mask)"/>

        <!-- Óvalo principal -->
        <ellipse id="sl-oval" cx="50" cy="45" rx="40" ry="32"
          fill="none" stroke="#1A5DAB" stroke-width="0.8"/>

        <!-- Óvalo exterior giratorio -->
        <ellipse cx="50" cy="45" rx="44" ry="34"
          fill="none" stroke="#1A5DAB" stroke-width="0.3"
          stroke-dasharray="5 4" opacity="0.4"
          stroke-dashoffset="0">
          <animate attributeName="stroke-dashoffset"
            from="0" to="100"
            dur="12s" repeatCount="indefinite"/>
        </ellipse>

        <!-- Esquinas HUD -->
        <g stroke="#00D4FF" stroke-width="0.7" fill="none" opacity="0.9">
          <path d="M 5 20 L 5 15 L 10 15"/>
          <path d="M 95 20 L 95 15 L 90 15"/>
          <path d="M 5 80 L 5 85 L 10 85"/>
          <path d="M 95 80 L 95 85 L 90 85"/>
        </g>

        <!-- Puntos parpadeantes -->
        <circle cx="50" cy="4" r="0.8" fill="#00D4FF">
          <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="50" cy="96" r="0.8" fill="#00D4FF">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="1.5s" repeatCount="indefinite"/>
        </circle>
      `;

      // Beam de escaneo
      const beam = document.createElement('div');
      beam.className = 'sl-beam';

      // Texto de estado
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

      // Botón cancelar
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
      overlay.appendChild(statusWrap);
      overlay.appendChild(btnCancelar);
      document.body.appendChild(overlay);

      let stream:   MediaStream;
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
                if ((faces.length > 0 || intentos >= 6) && !capturado) disparar(canvas);
              }).catch(() => {
                if (intentos >= 5 && !capturado) disparar(canvas);
              });
            } else {
              if (intentos >= 4 && !capturado) disparar(canvas);
            }
          }, 750);
        };

      }).catch(err => {
        cleanup();
        reject(new Error('Sin acceso a la cámara: ' + err.message));
      });

      const disparar = (canvas: HTMLCanvasElement) => {
        capturado = true;
        statusTxt.textContent = '¡Rostro detectado!';
        statusSub.textContent = 'VERIFICANDO...';
        statusSub.style.color = 'rgba(0,255,150,0.9)';
        setTimeout(() => {
          canvas.toBlob(blob => {
            cleanup();
            if (blob) resolve(blob);
            else reject(new Error('Error al capturar imagen'));
          }, 'image/jpeg', 0.9);
        }, 700);
      };

      btnCancelar.onclick = () => { cleanup(); resolve(null); };
    });
  }

  private async accesoConcedido() {
    await this.mostrarExito();
    this.setEstado('ok', '¡Identidad verificada!', 'Acceso concedido — Bienvenido');
    this.auth.guardarSesion({
      id:     this.empleado.id,
      nombre: this.empleado.nombreCompleto,
      curp:   this.empleado.curp,
    });
    setTimeout(() => {
      this.router.navigate(['/home'], { replaceUrl: true });
    }, 1500);
  }

  private mostrarExito(): Promise<void> {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,0.92);z-index:99999;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
      `;
      overlay.innerHTML = `
        <svg width="90" height="90" viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="40" fill="none" stroke="#00D4FF" stroke-width="3"
            stroke-dasharray="251" stroke-dashoffset="251">
            <animate attributeName="stroke-dashoffset" from="251" to="0" dur="0.5s" fill="freeze"/>
          </circle>
          <path d="M 25 45 L 38 58 L 65 30" fill="none" stroke="#00FF88" stroke-width="4.5"
            stroke-linecap="round" stroke-linejoin="round"
            stroke-dasharray="65" stroke-dashoffset="65">
            <animate attributeName="stroke-dashoffset" from="65" to="0" dur="0.4s" begin="0.4s" fill="freeze"/>
          </path>
        </svg>
        <p style="color:#00FF88;font-size:19px;font-family:sans-serif;margin:18px 0 6px;font-weight:600;letter-spacing:1px">
          Identidad verificada
        </p>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;font-family:sans-serif;margin:0;letter-spacing:3px">
          ACCESO PERMITIDO
        </p>
      `;
      document.body.appendChild(overlay);
      setTimeout(() => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        resolve();
      }, 1800);
    });
  }

  reintentar() {
    if (this.reintentoTimer) { clearTimeout(this.reintentoTimer); this.reintentoTimer = null; }
    this.setEstado('listo', 'Listo para escanear', 'Presiona el botón para intentar de nuevo');
  }

  cancelar() {
    if (this.reintentoTimer) clearTimeout(this.reintentoTimer);
    this.router.navigate(['/login']);
  }

  private setEstado(e: Estado, msg: string, sub: string) {
    this.zone.run(() => {
      this.estado     = e;
      this.mensaje    = msg;
      this.submensaje = sub;
    });
  }

  private traducirError(msg: string): string {
    if (msg.includes('401'))
      return 'Token de verificación inválido — contacta al administrador';
    if (msg.includes('network') || msg.includes('Network'))
      return 'Sin conexión — verifica tu internet e intenta de nuevo';
    if (msg.includes('permission') || msg.includes('cámara'))
      return 'Sin permiso de cámara — actívalo en configuración';
    return 'Ocurrió un error inesperado — intenta de nuevo';
  }

  getInitials(n: string): string {
    return n?.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'OP';
  }
}
