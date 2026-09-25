import {
  Component, OnInit, OnDestroy,
  ViewChild, ElementRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TensorflowService, ComparacionResult } from '../../services/tensorflow.service';
import { BiometricoService, RegistroResponse } from '../../services/biometrico.service';
import { Empleado } from '../../models/empleado.model';

type EstadoTF =
  | 'cargando_modelos'
  | 'preparando'
  | 'escaneando'
  | 'procesando'
  | 'ok'
  | 'fail'
  | 'bloqueado'
  | 'retardo'
  | 'sin_rostro';

@Component({
  selector: 'app-scanner-tf',
  templateUrl: './scanner-tf.page.html',
  styleUrls: ['./scanner-tf.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class ScannerTfPage implements OnInit, OnDestroy {

  @ViewChild('video',  { static: false }) videoRef!:  ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  empleado!: Empleado;
  modo      = 'entrada';
  estado: EstadoTF = 'cargando_modelos';
  mensajeEstado    = 'Cargando modelos de IA...';

  // Resultado de la comparación TF para mostrar en pantalla
  resultadoTF: {
    distancia?: number;
    score?:     number;
    similar?:   boolean;
    tiempoMs?:  number;
  } = {};

  // Info del registro
  infoRegistro: {
    tipo?:               'entrada' | 'salida';
    estadoEntrada?:      string;
    minutosRetardo?:     number;
    horaSalidaEsperada?: string;
    turno?:              string;
    estadoSalida?:       string;
  } = {};

  infoBloqueado: {
    horaSalidaValida?:  string;
    tiempoRestante?:    string;
    mensajeSupervisor?: string;
  } = {};

  scanY        = 50;
  colorOval    = '#00c3ff';
  colorOvalEnd = '#0080ff';

  private stream:           MediaStream | null = null;
  private descriptorRef:    Float32Array | null = null; // descriptor de la foto del empleado
  private detectLoop:       any = null;
  private scanAnim:         any = null;
  private scanDir           = 1;
  private biometricoToken   = '';
  private _camaraReintentada = false;


  constructor(
    private tf:     TensorflowService,
    private bio:    BiometricoService,
    private router: Router,
    private zone:   NgZone,
  ) {}

  async ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/home']); return; }

    this.empleado        = state.empleado;
    this.modo            = state.modo || 'entrada';
    this.biometricoToken = state.biometrico_token || '';

    // Verificar que sea el empleado 178
    // if (this.empleado.id !== 178) {
    //   this.router.navigate(['/scanner'], { state });
    //   return;
    // }

    await this.inicializar();
  }

  ngOnDestroy() { this.detenerTodo(); }

  // ── Inicialización ────────────────────────────────────────────────
  private async inicializar() {
    this.setEstado('cargando_modelos', 'Cargando modelos de IA...');

    try {
      // 1. Cargar modelos TF
      await this.tf.cargarModelos();
      this.setEstado('preparando', 'Generando descriptor del empleado...');

      // 2. Descriptor de referencia -- PREFIERE el enrolado (capturado
      // en vivo, 2 tomas verificadas) si el empleado ya tiene uno; es
      // más preciso que derivarlo de la foto de perfil (ángulo/luz
      // distintos, y a veces ni siquiera es una foto reciente). Solo
      // cae a la foto si por alguna razón no llegó el enrolado (no
      // debería pasar si viene de home.page, que ya manda a enrolar
      // primero, pero cubre el caso de entrar aquí directo).
      if (this.empleado.descriptor_servidor) {
        try {
          const arr = JSON.parse(this.empleado.descriptor_servidor);
          this.descriptorRef = new Float32Array(arr);
        } catch {
          this.descriptorRef = null;
        }
      }

      if (!this.descriptorRef && this.empleado.fotos) {
        try {
          const fotoBlob = await this.bio.descargarFoto(this.empleado.fotos);
          this.descriptorRef = await this.tf.generarDescriptorDesdeBlob(fotoBlob);
        } catch {
          this.setEstado('fail', 'No se pudo descargar la foto de referencia');
          return;
        }
      }

      if (!this.descriptorRef) {
        this.setEstado('fail', 'No hay rostro enrolado ni foto de referencia para este empleado');
        return;
      }

      // 3. Iniciar cámara
      await this.iniciarCamara();

    } catch (err: any) {
      this.setEstado('fail', err.message || 'Error al inicializar TensorFlow');
    }
  }

  // ── Cámara ────────────────────────────────────────────────────────
  private async iniciarCamara() {
    this.setEstado('preparando', 'Iniciando cámara...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });

      await new Promise<void>((resolve, reject) => {
        const video = this.videoRef?.nativeElement;
        if (!video) return reject(new Error('No hay elemento video'));

        video.srcObject = this.stream;
        video.onloadedmetadata = () => {
          video.play()
            .then(() => resolve())
            .catch(reject);
        };

        // Timeout por si el metadata nunca llega
        setTimeout(() => reject(new Error('Timeout iniciando cámara')), 8000);
      });

      this.setEstado('escaneando', 'Coloca tu rostro en el óvalo');
      this.iniciarDeteccion();

    } catch (err: any) {
      // Reintenta una vez si falla
      if (!this._camaraReintentada) {
        this._camaraReintentada = true;
        setTimeout(() => this.iniciarCamara(), 1500);
      } else {
        this.setEstado('fail', 'No se pudo acceder a la cámara');
      }
    }
  }

  // ── Loop de detección ─────────────────────────────────────────────
  private iniciarDeteccion() {
    let intentosSinRostro = 0;

    const loop = async () => {
      if (this.estado !== 'escaneando') return;

      const video = this.videoRef?.nativeElement;
      if (!video || video.readyState < 2) {
        this.detectLoop = setTimeout(loop, 200); return;
      }

      const hayRostro = await this.tf.detectarRostro(video);

      if (hayRostro) {
        intentosSinRostro = 0;
        this.procesarRostro();
      } else {
        intentosSinRostro++;
        if (intentosSinRostro > 40) {
          this.setEstado('sin_rostro', 'No se detectó ningún rostro');
          setTimeout(() => this.reintentar(), 3000);
        } else {
          this.detectLoop = setTimeout(loop, 150);
        }
      }
    };

    this.detectLoop = setTimeout(loop, 1000);
  }

  // ── Procesar rostro capturado ─────────────────────────────────────
  private async procesarRostro() {
    if (this.estado !== 'escaneando') return;
    this.setEstado('procesando', 'Analizando rostro con TensorFlow...');

    const inicio = Date.now();

    try {
      const video = this.videoRef?.nativeElement;
      if (!video) throw new Error('No hay video');

      const descriptorCapturado = await this.tf.generarDescriptorDesdeVideo(video);
      if (!descriptorCapturado) {
        this.setEstado('fail', 'No se pudo analizar el rostro');
        setTimeout(() => this.reintentar(), 2500);
        return;
      }

      const resultado: ComparacionResult = this.tf.comparar(
        this.descriptorRef!,
        descriptorCapturado
      );

      const tiempoMs = Date.now() - inicio;

      this.zone.run(() => {
        this.resultadoTF = {
          distancia: resultado.distancia,
          score:     resultado.score,
          similar:   resultado.similar,
          tiempoMs,
        };

        // ← Solo muestra resultado, NO registra en BD
        if (resultado.similar) {
          this.setEstado('ok', `✅ MATCH — Score: ${(resultado.score * 100).toFixed(1)}% en ${tiempoMs}ms`);
        } else {
          this.setEstado('fail', `❌ NO MATCH — Score: ${(resultado.score * 100).toFixed(1)}% | Distancia: ${resultado.distancia.toFixed(4)}`);
        }

        // Reintenta automático en 4s para seguir probando
        setTimeout(() => this.reintentar(), 4000);
      });

    } catch (err: any) {
      this.zone.run(() => {
        this.setEstado('fail', err.message || 'Error al procesar rostro');
        setTimeout(() => this.reintentar(), 3000);
      });
    }
  }

  // ── Registrar asistencia ──────────────────────────────────────────
  private async registrar() {
    try {
      const [ip, geo] = await Promise.all([
        this.bio.obtenerIP().catch(() => 'No disponible'),
        this.bio.obtenerGeo().catch(() => null),
      ]);

      const latitud  = (geo as any)?.lat ?? null;
      const longitud = (geo as any)?.lon ?? null;

      if (latitud === null || longitud === null) {
        this.zone.run(() => {
          this.setEstado('fail', 'No se pudo obtener ubicación GPS.');
          setTimeout(() => this.reintentar(), 4000);
        });
        return;
      }

      const res: any = await this.bio.registrarAsistenciaLegacy({
        id_empleado: this.empleado.id,
        lat:    latitud,
        lon:    longitud,
        ip:     ip as string,
        salida: this.modo === 'salida',
      });

      this.zone.run(() => {
        if (res.status === 'bloqueado' && res.tipo === 'salida_anticipada') {
          this.infoBloqueado = {
            horaSalidaValida:  res.data?.hora_salida_valida,
            tiempoRestante:    res.data?.tiempo_restante,
            mensajeSupervisor: res.data?.mensaje_supervisor,
          };
          this.setEstado('bloqueado',
            `No puedes salir todavía.\nFaltan ${res.data?.tiempo_restante}`
          );
          return;
        }

        if (res.tipo === 'entrada') {
          this.infoRegistro = {
            tipo:               'entrada',
            estadoEntrada:      res.data?.estado_entrada,
            minutosRetardo:     res.data?.minutos_retardo,
            horaSalidaEsperada: res.data?.hora_salida_esperada,
            turno:              res.data?.turno,
          };
          if (res.data?.estado_entrada === 'retardo_grave') {
            this.setEstado('retardo', `Entrada con retardo de ${res.data?.minutos_retardo} min`);
          } else {
            this.setEstado('ok', '✅ Entrada registrada con TensorFlow');
          }
        }

        if (res.tipo === 'salida') {
          this.infoRegistro = { tipo: 'salida', estadoSalida: res.data?.estado_salida };
          this.setEstado('ok', '✅ Salida registrada con TensorFlow');
        }

        setTimeout(() => {
          this.router.navigate(['/resultado'], {
            state: {
              empleado:     this.empleado,
              tipo:         res.tipo,
              infoRegistro: this.infoRegistro,
              resultadoTF:  this.resultadoTF,
              motor:        'tensorflow',
              exito:        true,
            }
          });
        }, 2000);
      });

    } catch (err: any) {
      this.zone.run(() => {
        this.setEstado('fail', err.message || 'Error al registrar');
        setTimeout(() => this.reintentar(), 3000);
      });
    }
  }

  // ── Acciones públicas ─────────────────────────────────────────────
  reintentar() {
    this._camaraReintentada = false;
    this.resultadoTF  = {};
    this.infoBloqueado = {};
    this.setEstado('escaneando', 'Coloca tu rostro en el óvalo');
    this.iniciarDeteccion();
  }

  cancelar() { this.detenerTodo(); this.router.navigate(['/home']); }

  // ── Helpers ───────────────────────────────────────────────────────
  private detenerTodo() {
    if (this.detectLoop) { clearTimeout(this.detectLoop); this.detectLoop = null; }
    this.pararAnimLinea();
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }

  private setEstado(estado: EstadoTF, mensaje: string) {
    this.zone.run(() => {
      this.estado        = estado;
      this.mensajeEstado = mensaje;
      switch (estado) {
        case 'escaneando':
          this.colorOval = '#00c3ff'; this.colorOvalEnd = '#0080ff';
          this.iniciarAnimLinea(); break;
        case 'procesando':
        case 'cargando_modelos':
        case 'preparando':
          this.colorOval = '#4f8ef7'; this.colorOvalEnd = '#2356a8'; break;
        case 'ok':
          this.colorOval = '#22c97a'; this.colorOvalEnd = '#16a05c';
          this.pararAnimLinea(); break;
        case 'retardo':
          this.colorOval = '#f5a623'; this.colorOvalEnd = '#c07d10';
          this.pararAnimLinea(); break;
        case 'bloqueado':
        case 'fail':
        case 'sin_rostro':
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

  // Getters para template
  get scorePercent(): string {
    return this.resultadoTF.score !== undefined
      ? (this.resultadoTF.score * 100).toFixed(1) + '%'
      : '—';
  }

  get distanciaStr(): string {
    return this.resultadoTF.distancia !== undefined
      ? this.resultadoTF.distancia.toFixed(4)
      : '—';
  }

  get colorScore(): string {
    if (!this.resultadoTF.score) return 'var(--tx2)';
    if (this.resultadoTF.score >= 0.7) return '#22c97a';
    if (this.resultadoTF.score >= 0.5) return '#f5a623';
    return '#f05454';
  }
}
