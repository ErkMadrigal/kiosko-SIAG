import {
  Component, OnInit, OnDestroy,
  ViewChild, ElementRef, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TensorflowService } from '../../services/tensorflow.service';
import { BiometricoService } from '../../services/biometrico.service';
import { SqliteService } from '../../services/sqlite.service';
import { KioskoAuthService } from '../../services/kiosko-auth.service';
import { Empleado } from '../../models/empleado.model';

/**
 * Enrolamiento facial -- estilo Cheil.
 *
 * 2 capturas en vivo (no se usa la foto de perfil):
 *   1) "Guardar"   -- se calcula el descriptor y se guarda en memoria.
 *   2) "Verificar" -- segunda captura inmediata; se manda junto con la
 *      primera al backend, que calcula la distancia entre ambas. Si no
 *      coinciden lo suficiente (mala luz, movimiento, etc.) se rechaza
 *      y hay que repetir -- así no queda enrolada una captura de mala
 *      calidad.
 *
 * Al terminar, marca empleado.rostro_enrolado y sigue al scanner de
 * TensorFlow para completar el checado.
 */
type EstadoEnrolamiento =
  | 'cargando_modelos'
  | 'preparando'
  | 'esperando_captura_1'
  | 'esperando_captura_2'
  | 'enviando'
  | 'ok'
  | 'fail';

@Component({
  selector: 'app-enrolamiento',
  templateUrl: './enrolamiento.page.html',
  styleUrls: ['./enrolamiento.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class EnrolamientoPage implements OnInit, OnDestroy {

  @ViewChild('video', { static: false }) videoRef!: ElementRef<HTMLVideoElement>;

  empleado!: Empleado;
  modo = 'entrada';
  estado: EstadoEnrolamiento = 'cargando_modelos';
  mensaje = 'Cargando modelos de IA...';
  paso: 1 | 2 = 1;

  private stream: MediaStream | null = null;
  private descriptor1: Float32Array | null = null;
  private _camaraReintentada = false;

  constructor(
    private tf:     TensorflowService,
    private bio:    BiometricoService,
    private sqlite: SqliteService,
    private auth:   KioskoAuthService,
    private router: Router,
    private zone:   NgZone,
  ) {}

  async ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/home']); return; }
    this.empleado = state.empleado;
    this.modo     = state.modo || 'entrada';
    await this.inicializar();
  }

  ngOnDestroy() { this.detenerCamara(); }

  // ── Inicialización ────────────────────────────────────
  private async inicializar() {
    this.setEstado('cargando_modelos', 'Cargando modelos de IA...');
    try {
      await this.tf.cargarModelos();
      await this.iniciarCamara();
    } catch (err: any) {
      this.setEstado('fail', err.message || 'No se pudieron cargar los modelos de reconocimiento facial');
    }
  }

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
        video.onloadedmetadata = () => video.play().then(() => resolve()).catch(reject);
        setTimeout(() => reject(new Error('Timeout iniciando cámara')), 8000);
      });

      this.setEstado('esperando_captura_1', 'Coloca tu rostro en el óvalo y presiona Capturar');
    } catch (err: any) {
      if (!this._camaraReintentada) {
        this._camaraReintentada = true;
        setTimeout(() => this.iniciarCamara(), 1500);
      } else {
        this.setEstado('fail', 'No se pudo acceder a la cámara');
      }
    }
  }

  // ── Captura (disparada por botón, no automática -- queremos que la
  // persona se acomode bien antes de tomar la referencia que va a
  // quedar guardada, a diferencia del scanner de checado normal) ────
  async capturar() {
    if (this.estado !== 'esperando_captura_1' && this.estado !== 'esperando_captura_2') return;

    const video = this.videoRef?.nativeElement;
    if (!video) return;

    this.setEstado('preparando', this.paso === 1 ? 'Procesando primera captura...' : 'Procesando segunda captura...');

    const descriptor = await this.tf.generarDescriptorDesdeVideo(video);
    if (!descriptor) {
      this.zone.run(() => {
        this.setEstado(
          this.paso === 1 ? 'esperando_captura_1' : 'esperando_captura_2',
          'No se detectó tu rostro claramente -- intenta de nuevo con buena luz'
        );
      });
      return;
    }

    if (this.paso === 1) {
      this.descriptor1 = descriptor;
      this.zone.run(() => {
        this.paso = 2;
        this.setEstado('esperando_captura_2', '¡Listo! Ahora una segunda captura para confirmar');
      });
      return;
    }

    await this.enviarEnrolamiento(descriptor);
  }

  private async enviarEnrolamiento(descriptor2: Float32Array) {
    this.setEstado('enviando', 'Guardando enrolamiento...');
    try {
      const sesion = this.auth.getSesion();
      const res = await this.bio.enrolarRostro(
        this.empleado.id,
        Array.from(this.descriptor1!),
        Array.from(descriptor2),
        sesion?.operadorId,
      );

      if (res.status !== 'ok') {
        this.zone.run(() => {
          this.paso = 2;
          this.setEstado('esperando_captura_2', res.message || 'No se pudo enrolar, intenta de nuevo');
        });
        return;
      }

      // Best-effort -- si este empleado ya estaba sincronizado en el
      // dispositivo, actualiza su descriptor offline con el recién
      // enrolado (más preciso que el derivado de la foto de perfil).
      try {
        await this.sqlite.init();
        const local = await this.sqlite.getEmpleado(this.empleado.id);
        if (local) {
          await this.sqlite.guardarEmpleado({
            id:                     this.empleado.id,
            nombreCompleto:         local.nombre_completo,
            curp:                   local.curp,
            rfc:                    local.rfc,
            fotos:                  local.fotos,
            id_turno:               local.id_turno,
            puesto:                 local.puesto,
            id_ubicacion_principal: local.ubicacion_id,
            rostro_enrolado:        1,
          }, this.tf.serializarDescriptor(this.descriptor1!));
        }
      } catch (e) {
        console.warn('No se pudo actualizar el descriptor local:', e);
      }

      this.zone.run(() => {
        this.empleado.rostro_enrolado = 1;
        this.setEstado('ok', '✅ Rostro enrolado correctamente');
      });

      setTimeout(() => {
        this.detenerCamara();
        this.router.navigate(['/scanner-tf'], { state: { empleado: this.empleado, modo: this.modo } });
      }, 1800);

    } catch (err: any) {
      this.zone.run(() => {
        this.paso = 2;
        this.setEstado('esperando_captura_2', 'Error al enrolar: ' + (err.error?.message || err.message || 'intenta de nuevo'));
      });
    }
  }

  reiniciar() {
    this.paso        = 1;
    this.descriptor1 = null;
    this.setEstado('esperando_captura_1', 'Coloca tu rostro en el óvalo y presiona Capturar');
  }

  cancelar() {
    this.detenerCamara();
    this.router.navigate(['/home']);
  }

  private detenerCamara() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  }

  private setEstado(estado: EstadoEnrolamiento, mensaje: string) {
    this.zone.run(() => { this.estado = estado; this.mensaje = mensaje; });
  }

  getInitials(nombre: string | undefined | null): string {
    return nombre?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || '??';
  }
}
