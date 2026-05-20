import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { Empleado } from '../../models/empleado.model';

@Component({
  selector: 'app-resultado',
  templateUrl: './resultado.page.html',
  styleUrls: ['./resultado.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
})
export class ResultadoPage implements OnInit, OnDestroy {
  empleado!: Empleado;
  modo    = 'entrada';
  exito   = true;
  hora    = '';
  private timer: any;

  constructor(private router: Router) {}

  ngOnInit() {
    const state = history.state;
    if (!state?.empleado) { this.router.navigate(['/home']); return; }
    this.empleado = state.empleado;
    this.modo     = state.modo  || 'entrada';
    this.exito    = state.exito ?? true;
    this.hora     = new Date().toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    this.timer = setTimeout(() => this.router.navigate(['/home']), 4000);
  }

  ngOnDestroy() { clearTimeout(this.timer); }

  volverInicio() { clearTimeout(this.timer); this.router.navigate(['/home']); }

  getInitials(nombre: string): string {
    if (!nombre) return 'US';
    return nombre.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  }
}
