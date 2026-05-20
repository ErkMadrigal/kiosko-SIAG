import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shieldCheckmarkOutline, keyOutline, searchOutline,
  closeCircle, alertCircleOutline, wifiOutline,
  locationOutline, refreshOutline, warningOutline
} from 'ionicons/icons';
import { BiometricoService } from '../../services/biometrico.service';
import { KioskoAuthService } from '../../services/kiosko-auth.service';
import { RequisitoService, EstadoRequisitos } from '../../services/requisito.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon],
})
export class LoginPage implements OnInit {

  query    = '';
  error    = '';
  buscando = false;

  requisitos: EstadoRequisitos = { internet: true, ubicacion: true, listo: true };
  verificandoRequisitos = true;

  constructor(
    private bio:      BiometricoService,
    private auth:     KioskoAuthService,
    private req:      RequisitoService,
    private router:   Router,
  ) {
    addIcons({
      shieldCheckmarkOutline, keyOutline, searchOutline,
      closeCircle, alertCircleOutline, wifiOutline,
      locationOutline, refreshOutline, warningOutline
    });
  }

  async ngOnInit() {
    // Si ya hay sesión activa, ir directo al home
    if (this.auth.estaAutenticado()) {
      this.router.navigate(['/home'], { replaceUrl: true });
      return;
    }
    await this.verificarRequisitos();
  }

  async verificarRequisitos() {
    this.verificandoRequisitos = true;
    this.requisitos = await this.req.verificar();
    this.verificandoRequisitos = false;
  }

  async buscar() {
    if (!this.query.trim() || !this.requisitos.listo) return;
    this.error    = '';
    this.buscando = true;

    try {
      const emp = await this.bio.buscarOperador(this.query.trim());


      // Navegar al scanner de login con flag especial
      this.router.navigate(['/scanner-login'], {
        state: { empleado: emp }
      });
    } catch (err: any) {
      this.error = this.traducirError(err.message || '');
    } finally {
      this.buscando = false;
    }
  }

  onInput() {
    this.query = this.query.toUpperCase();
    this.error = '';
  }

  private traducirError(msg: string): string {
    if (msg.includes('not found') || msg.includes('no encontrado'))
      return 'No se encontró ningún empleado con ese identificador';
    if (msg.includes('network') || msg.includes('Network'))
      return 'Sin conexión a internet. Verifica tu red e intenta de nuevo';
    if (msg.includes('timeout'))
      return 'La conexión tardó demasiado. Intenta de nuevo';
    return msg || 'Ocurrió un error, intenta de nuevo';
  }
}
