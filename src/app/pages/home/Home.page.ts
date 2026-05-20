import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, LoadingController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  logInOutline, logOutOutline, keyOutline, searchOutline,
  closeCircle, alertCircleOutline, powerOutline, timeOutline,
  personCircleOutline
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
export class HomePage implements OnInit {
  query    = '';
  modo     = 'entrada';
  error    = '';
  sesion!: KioskoSession;
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
      personCircleOutline
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

  async buscar() {
    if (!this.query.trim()) return;
    this.error = '';

    const loader = await this.loading.create({
      message: 'Buscando empleado...',
      spinner: 'crescent',
    });
    await loader.present();

    try {
      const emp = await this.bio.buscarEmpleado(this.query.trim(), this.modo === 'salida');
      await loader.dismiss();
      this.router.navigate(['/scanner'], { state: { empleado: emp, modo: this.modo } });
    } catch (err: any) {
      await loader.dismiss();
      this.error = this.traducirError(err.message || '');
    }
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
    return n?.split(' ').slice(0,2).map(x => x[0]).join('').toUpperCase() || 'OP';
  }

  private traducirError(msg: string): string {
    if (msg.includes('not found') || msg.includes('no encontrado'))
      return 'No se encontró ningún empleado con ese identificador';
    if (msg.includes('network') || msg.includes('Network'))
      return 'Sin conexión a internet';
    return msg || 'Error al buscar, intenta de nuevo';
  }
}
