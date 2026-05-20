import {
  Component, OnInit, OnDestroy,
  ViewChild, ElementRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { BiometricoService } from '../../services/biometrico.service';
import { Empleado } from '../../models/empleado.model';

type EstadoScanner = 'preparando' | 'escaneando' | 'procesando' | 'ok' | 'fail';

@Component({
  selector: 'app-scanner',
  templateUrl: './scanner.page.html',
  styleUrls: ['./scanner.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class ScannerPage implements OnInit, OnDestroy {

  @ViewChild('video',  { static: false }) videoRef!:  ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  empleado!: Empleado;
  modo      = 'entrada';
  estado: EstadoScanner = 'preparando';
  mensajeEstado = 'Preparando escaneo...';

  scanY        = 50;
  colorOval    = '#00c3ff';
  colorOvalEnd = '#0080ff';

  private stream:     MediaStream | null = null;
  private fotoBlob:   Blob | null = null;
  private detectLoop: any = null;
  private faceApi:    any = null;
  private faceApiListo = false;
  private scanDir     = 1;
  private scanAnim:   any = null;

  constructor(
    private bio:    BiometricoService,
    private router: Router,
    private zone:   NgZone,
  ) {}

  async ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/home']); return; }

    this.empleado = state.empleado;
    this.modo     = state.modo || 'entrada';

    await this.cargarFaceApi();

    if (this.empleado.fotos) {
      try { this.fotoBlob = await this.bio.descargarFoto(this.empleado.fotos); }
      catch { console.warn('No se pudo descargar foto'); }
    }

    await this.iniciarCamara();
  }

  ngOnDestroy() { this.detenerTodo(); }

  private cargarFaceApi(): Promise<void> {
    return new Promise((resolve) => {
      if ((window as any)['faceapi']) {
        this.faceApi = (window as any)['faceapi'];
        resolve(); return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
      script.onload = async () => {
        this.faceApi = (window as any)['faceapi'];
        try {
          await this.faceApi.nets.tinyFaceDetector.loadFromUri('/weights');
          this.faceApiListo = true; // ← agregar
        } catch {
          console.warn('No se cargaron modelos face-api');
          this.faceApi = null; // ← agregar para forzar fallback
        }
        resolve();
      };
      script.onerror = () => resolve(); // continuar aunque falle
      document.head.appendChild(script);
    });
  }

  private async iniciarCamara() {
    this.setEstado('preparando', 'Iniciando cámara...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
      setTimeout(() => {
        const video = this.videoRef?.nativeElement;
        if (video && this.stream) {
          video.srcObject = this.stream;
          video.play().then(() => {
            this.setEstado('escaneando', 'Coloca tu rostro en el óvalo');
            this.iniciarDeteccionAutomatica();
          });
        }
      }, 300);
    } catch {
      this.setEstado('fail', 'No se pudo acceder a la cámara');
    }
  }

  private iniciarDeteccionAutomatica() {
    if (!this.faceApi || !this.faceApiListo) {
      this.detectLoop = setTimeout(() => this.procesarRostro(), 3000);
      return;
    }
    let intentos = 0;
    const loop = async () => {
      if (this.estado !== 'escaneando') return;
      const video = this.videoRef?.nativeElement;
      if (!video || video.readyState < 2) {
        this.detectLoop = setTimeout(loop, 200); return;
      }
      try {
        const det = await this.faceApi.detectAllFaces(
          video, new this.faceApi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })
        );
        if (det.length > 0) {
          this.procesarRostro();
        } else {
          intentos++;
          if (intentos > 30) {
            this.setEstado('fail', 'No se detectó ningún rostro');
            setTimeout(() => this.reintentar(), 3000);
          } else {
            this.detectLoop = setTimeout(loop, 100);
          }
        }
      } catch { this.detectLoop = setTimeout(loop, 200); }
    };
    this.detectLoop = setTimeout(loop, 1000);
  }

  private async procesarRostro() {
    if (this.estado !== 'escaneando') return;
    this.setEstado('procesando', 'Comparando rostros...');
    try {
      const fotoCapturada = await this.capturarFotoAsync();
      if (!fotoCapturada) throw new Error('No se pudo capturar imagen');

      if (!this.fotoBlob) {
        await this.registrar(); return;
      }

      const resultado = await this.bio.compararRostros(this.fotoBlob, fotoCapturada);
      this.zone.run(async () => {
        if (resultado.score >= 0.9 && resultado.similar) {
          this.setEstado('ok', '¡Identidad verificada!');
          await this.registrar();
        } else {
          this.setEstado('fail', 'Rostro no coincide. Acceso denegado.');
          setTimeout(() => this.reintentar(), 3000);
        }
      });
    } catch (err: any) {
      this.zone.run(() => {
        this.setEstado('fail', 'Error: ' + (err.message || 'intenta de nuevo'));
        setTimeout(() => this.reintentar(), 3000);
      });
    }
  }

  private capturarFotoAsync(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const video  = this.videoRef?.nativeElement;
      const canvas = this.canvasRef?.nativeElement;
      if (!video || !canvas) { reject(new Error('No hay video')); return; }
      canvas.width  = video.videoWidth  || 480;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas ctx')); return; }
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Blob vacío'));
      }, 'image/jpeg', 0.9);
    });
  }

  private async registrar() {
    try {
      const ip = await this.bio.obtenerIP();
      let lat: number | null = null, lon: number | null = null;
      try { const c = await this.bio.obtenerGeo(); lat = c.lat; lon = c.lon; } catch {}
      await this.bio.registrarAsistencia({
        id_empleado: this.empleado.id, lat, lon, ip,
        salida: this.modo === 'salida',
      });
      setTimeout(() => {
        this.router.navigate(['/resultado'], {
          state: { empleado: this.empleado, modo: this.modo, exito: true }
        });
      }, 1500);
    } catch (err: any) {
      this.setEstado('fail', err.message || 'Error al registrar');
      setTimeout(() => this.reintentar(), 3000);
    }
  }

  reintentar() {
    this.setEstado('escaneando', 'Coloca tu rostro en el óvalo');
    this.iniciarDeteccionAutomatica();
  }

  cancelar() { this.detenerTodo(); this.router.navigate(['/home']); }

  private detenerTodo() {
    if (this.detectLoop) { clearTimeout(this.detectLoop); this.detectLoop = null; }
    this.pararAnimLinea();
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }

  private setEstado(estado: EstadoScanner, mensaje: string) {
    this.zone.run(() => {
      this.estado = estado; this.mensajeEstado = mensaje;
      switch (estado) {
        case 'escaneando':
          this.colorOval = '#00c3ff'; this.colorOvalEnd = '#0080ff';
          this.iniciarAnimLinea(); break;
        case 'procesando':
          this.colorOval = '#4f8ef7'; this.colorOvalEnd = '#2356a8'; break;
        case 'ok':
          this.colorOval = '#22c97a'; this.colorOvalEnd = '#16a05c';
          this.pararAnimLinea(); break;
        case 'fail':
          this.colorOval = '#f05454'; this.colorOvalEnd = '#c0392b';
          this.pararAnimLinea(); break;
      }
    });
  }

  private iniciarAnimLinea() {
    this.pararAnimLinea();
    const animar = () => {
      this.scanY += this.scanDir * 3;
      if (this.scanY >= 350) this.scanDir = -1;
      if (this.scanY <= 50)  this.scanDir = 1;
      this.scanAnim = requestAnimationFrame(animar);
    };
    this.scanAnim = requestAnimationFrame(animar);
  }

  private pararAnimLinea() {
    if (this.scanAnim) { cancelAnimationFrame(this.scanAnim); this.scanAnim = null; }
  }

  getInitials(nombre: string): string {
    if (!nombre) return 'US';
    return nombre.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  }
}
