import { Injectable } from '@angular/core';

export interface KioskoSession {
  operadorId:     number;
  operadorNombre: string;
  operadorCurp:   string;
  token:          string;
  expira:         number; // timestamp ms
}

@Injectable({ providedIn: 'root' })
export class KioskoAuthService {

  private readonly KEY = 'kiosko_session';
  private readonly DURACION_MS = 24 * 60 * 60 * 1000; // 24 horas

  guardarSesion(operador: { id: number; nombre: string; curp: string }): void {
    const session: KioskoSession = {
      operadorId:     operador.id,
      operadorNombre: operador.nombre,
      operadorCurp:   operador.curp,
      token:          this.generarToken(),
      expira:         Date.now() + this.DURACION_MS,
    };
    localStorage.setItem(this.KEY, JSON.stringify(session));
  }

  getSesion(): KioskoSession | null {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const session: KioskoSession = JSON.parse(raw);
      if (Date.now() > session.expira) {
        this.cerrarSesion();
        return null;
      }
      return session;
    } catch { return null; }
  }

  estaAutenticado(): boolean {
    return this.getSesion() !== null;
  }

  cerrarSesion(): void {
    localStorage.removeItem(this.KEY);
  }

  tiempoRestante(): string {
    const s = this.getSesion();
    if (!s) return '';
    const ms   = s.expira - Date.now();
    const hrs  = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hrs}h ${mins}m`;
  }

  private generarToken(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}
