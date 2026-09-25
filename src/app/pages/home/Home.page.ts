import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, LoadingController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  logInOutline, logOutOutline, keyOutline, searchOutline,
  closeCircle, alertCircleOutline, powerOutline, timeOutline,
  personCircleOutline, hardwareChipOutline
} from 'ionicons/icons';
import { BiometricoService } from '../../services/biometrico.service';
import { KioskoAuthService, KioskoSession } from '../../services/kiosko-auth.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon],
})
export class HomePage implements OnInit, OnDestroy {
  query      = '';
  modo       = 'entrada';
  error      = '';
  sesion!:   KioskoSession;
  horaActual = '';
  private reloj: any;


  constructor(
    private bio:     BiometricoService,
    private auth:    KioskoAuthService,
    private router:  Router,
    private loading: LoadingController,
  ) {
    addIcons({
      logInOutline, logOutOutline, keyOutline, searchOutline,
      closeCircle, alertCircleOutline, powerOutline, timeOutline,
      personCircleOutline, hardwareChipOutline
    });
  }

  ngOnInit() {
    const s = this.auth.getSesion();
    if (!s) { this.router.navigate(['/login']); return; }
    this.sesion = s;
    this.actualizarHora();
    this.reloj = setInterval(() => this.actualizarHora(), 60000);
  }

  ngOnDestroy() { clearInterval(this.reloj); }

  private actualizarHora() {
    this.horaActual = new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  cambiarModo(m: string) {
    this.modo  = m;
    this.error = '';
    this.query = '';
  }

  irSetup() {
    this.router.navigate(['/setup']);
  }

  // ── Buscar y registrar (reconocimiento facial local -- TensorFlow +
  // enrolamiento) -- esta es la única forma de registrar ahora. Antes
  // había un botón aparte con Luxand (Scanner.page.ts /scanner), pero se
  // ocultó: este flujo es más preciso (2 capturas verificadas en el
  // enrolamiento) y funciona sin depender de un servicio en la nube. El
  // código de Luxand se deja intacto por si se necesita reactivar.
  async buscarConTF() {
    if (!this.query.trim()) return;
    this.error = '';

    const loader = await this.loading.create({
      message: 'Verificando...', spinner: 'crescent',
    });
    await loader.present();

    try {
      const emp = await this.bio.buscarEmpleado(this.query.trim());

      const estado = await this.bio.verificarEstado(emp.id, this.modo === 'salida');
      await loader.dismiss();

      if (!estado.puede) {
        if (estado.bloqueado) {
          this.mostrarModalBloqueado(estado);
        } else {
          this.mostrarModalError(estado.message || 'No se puede registrar');
        }
        return;
      }

      // NUEVO -- si el empleado todavía no tiene su rostro enrolado (2
      // capturas en vivo), no lo mandamos al scanner con un descriptor
      // derivado nada más de la foto de perfil -- primero se enrola,
      // para que el reconocimiento sea más certero.
      if (!emp.rostro_enrolado) {
        this.router.navigate(['/enrolamiento'], {
          state: { empleado: emp, modo: this.modo }
        });
        return;
      }

      this.router.navigate(['/scanner-tf'], {
        state: { empleado: emp, modo: this.modo }
      });

    } catch (err: any) {
      await loader.dismiss();
      this.error = this.traducirError(err.message || '');
    }
  }

  // ── Modal bloqueado — salida anticipada ──────────────────────────
  private mostrarModalBloqueado(estado: any) {
    const d = estado.data || {};
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:0 24px;gap:0;
    `;
    overlay.innerHTML = `
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
      <button id="hm-modal-close" style="
        background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);
        border:1px solid rgba(255,255,255,.2);border-radius:40px;
        padding:13px 40px;font-size:14px;cursor:pointer;font-family:sans-serif;
      ">Entendido</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('hm-modal-close')?.addEventListener('click', () => overlay.remove());
  }

  // ── Modal error genérico ──────────────────────────────────────────
  private mostrarModalError(mensaje: string) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:0 24px;gap:0;
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
        letter-spacing:2px;text-align:center;text-transform:uppercase;">AVISO</p>
      <div style="
        background:rgba(244,183,64,0.08);border:1px solid rgba(244,183,64,0.25);
        border-radius:16px;padding:20px;width:100%;max-width:300px;margin-bottom:20px;
      ">
        <p style="font-size:14px;color:rgba(255,255,255,.8);margin:0;line-height:1.6;
          font-family:sans-serif;text-align:center;font-weight:500;">${mensaje}</p>
      </div>
      <button id="hm-modal-close" style="
        background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);
        border:1px solid rgba(255,255,255,.2);border-radius:40px;
        padding:13px 40px;font-size:14px;cursor:pointer;font-family:sans-serif;
      ">Entendido</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('hm-modal-close')?.addEventListener('click', () => overlay.remove());
  }

  onInput() {
    this.query = this.query.toUpperCase();
    this.error = '';
  }

  cerrarSesion() {
    this.auth.cerrarSesion();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  tiempoRestante(): string { return this.auth.tiempoRestante(); }

  getInitials(n: string): string {
    return n?.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'OP';
  }

  private traducirError(msg: string): string {
    if (msg.includes('not found') || msg.includes('no encontrado'))
      return 'No se encontró ningún empleado con ese identificador';
    if (msg.includes('network') || msg.includes('Network'))
      return 'Sin conexión a internet';
    return msg || 'Error al buscar, intenta de nuevo';
  }
}
