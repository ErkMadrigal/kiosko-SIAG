import { Injectable } from '@angular/core';

export interface EstadoRequisitos {
  internet:  boolean;
  ubicacion: boolean;
  listo:     boolean;
}

@Injectable({ providedIn: 'root' })
export class RequisitoService {

  async verificar(): Promise<EstadoRequisitos> {
    const internet  = await this.verificarInternet();
    const ubicacion = await this.verificarUbicacion();
    return { internet, ubicacion, listo: internet && ubicacion };
  }

  private verificarInternet(): Promise<boolean> {
    return new Promise(resolve => {
      // Solo verificar navigator.onLine — suficiente para desarrollo
      resolve(navigator.onLine);
      // Listener para cambios en tiempo real
      window.addEventListener('online',  () => resolve(true),  { once: true });
      window.addEventListener('offline', () => resolve(false), { once: true });
    });
  }

  private verificarUbicacion(): Promise<boolean> {
    return new Promise(resolve => {
      if (!('geolocation' in navigator)) { resolve(false); return; }
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (result.state === 'granted') { resolve(true); return; }
        if (result.state === 'denied')  { resolve(false); return; }
        // 'prompt' — intentar obtener permiso
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 5000 }
        );
      }).catch(() => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 5000 }
        );
      });
    });
  }
}
