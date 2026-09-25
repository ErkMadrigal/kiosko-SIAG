import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Network } from '@capacitor/network';
import { SqliteService } from './sqlite.service';
import { TensorflowService } from './tensorflow.service';
import { BiometricoService } from './biometrico.service';
import { environment } from '../../environments/environment';

export interface SyncStatus {
  total:       number;
  procesados:  number;
  errores:     number;
  pendientes:  number;
  sincronizando: boolean;
}

@Injectable({ providedIn: 'root' })
export class SyncService {

  private _status: SyncStatus = {
    total: 0, procesados: 0, errores: 0, pendientes: 0, sincronizando: false
  };

  constructor(
    private http:    HttpClient,
    private sqlite:  SqliteService,
    private tf:      TensorflowService,
    private bio:     BiometricoService,
  ) {}

  get status() { return this._status; }

  // ── Verificar conexión ───────────────────────────────
  async hayInternet(): Promise<boolean> {
    const status = await Network.getStatus();
    return status.connected;
  }

  // ── Buscar ubicaciones por NOMBRE ─────────────────────
  // Antes había que saber el ID de memoria (ej. 145) -- ahora se busca
  // por texto y el usuario elige de una lista. Requiere el endpoint
  // GET /biometrico/ubicaciones-buscar?q=... en el backend (ver
  // ubicacionesBuscar_BiometricoController.php).
  async buscarUbicaciones(query: string): Promise<{ id: number; nombre: string }[]> {
    if (!query.trim()) return [];
    const res: any = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/biometrico/ubicaciones-buscar?q=${encodeURIComponent(query.trim())}`)
    );
    if (res.status !== 'ok') return [];
    return res.data ?? [];
  }

  // ── Descargar empleados por ubicación ────────────────
  async sincronizarUbicacion(ubicacionId: number, onProgress?: (msg: string) => void): Promise<SyncStatus> {
    this._status = { total: 0, procesados: 0, errores: 0, pendientes: 0, sincronizando: true };

    try {
      onProgress?.('Cargando modelos de IA...');
      await this.tf.cargarModelos();

      onProgress?.('Descargando empleados...');
      const res: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/biometrico/sync?ubicacion_id=${ubicacionId}`)
      );

      if (res.status !== 'ok') throw new Error('Error al obtener empleados');

      const empleados = res.empleados as any[];
      this._status.total = empleados.length;

      onProgress?.(`Procesando ${empleados.length} empleados...`);

      for (const emp of empleados) {
        try {
          onProgress?.(`Procesando ${emp.nombreCompleto}...`);

          // NUEVO -- si el empleado ya está enrolado (2 capturas en
          // vivo, verificadas), usa ESE descriptor tal cual lo manda
          // el servidor -- es más preciso y además evita descargar y
          // procesar la foto de cada empleado uno por uno. Solo si NO
          // está enrolado cae al método viejo (derivar de la foto).
          let descriptor = '';
          if (emp.descriptor_servidor) {
            descriptor = emp.descriptor_servidor;
          } else if (emp.fotos) {
            const blob = await this.bio.descargarFoto(emp.fotos);
            const desc = await this.tf.generarDescriptorDesdeBlob(blob);
            if (desc) descriptor = this.tf.serializarDescriptor(desc);
          }

          await this.sqlite.guardarEmpleado(emp, descriptor);
          this._status.procesados++;

        } catch (err) {
          console.error(`Error procesando ${emp.nombreCompleto}:`, err);
          this._status.errores++;
        }
      }

      // Guardar config de ubicación
      await this.sqlite.setConfig('ubicacion_id', String(ubicacionId));
      await this.sqlite.setConfig('ultima_sync', new Date().toISOString());

    } catch (err: any) {
      console.error('Error en sync:', err);
      throw err;
    } finally {
      this._status.sincronizando = false;
      this._status.pendientes = await this.sqlite.totalPendientes();
    }

    return this._status;
  }

  // ── Agregar empleado individual ──────────────────────
  async agregarEmpleado(query: string, onProgress?: (msg: string) => void): Promise<any> {
    onProgress?.('Buscando empleado...');
    const res: any = await firstValueFrom(
      this.http.get(`${environment.apiUrl}/biometrico/buscar-sync?query=${query}`)
    );

    if (res.status !== 'ok') throw new Error('Empleado no encontrado');

    const emp = res.data;
    onProgress?.('Generando descriptor facial...');

    await this.tf.cargarModelos();
    let descriptor = '';
    if (emp.descriptor_servidor) {
      descriptor = emp.descriptor_servidor;
    } else if (emp.fotos) {
      const blob = await this.bio.descargarFoto(emp.fotos);
      const desc = await this.tf.generarDescriptorDesdeBlob(blob);
      if (desc) descriptor = this.tf.serializarDescriptor(desc);
    }

    await this.sqlite.guardarEmpleado(emp, descriptor);
    return emp;
  }

  // ── Subir asistencias pendientes ─────────────────────
  async subirPendientes(onProgress?: (msg: string) => void): Promise<{ subidos: number; errores: number }> {
    const pendientes = await this.sqlite.getPendientes();
    let subidos = 0;
    let errores = 0;

    for (const p of pendientes) {
      try {
        onProgress?.(`Subiendo registro ${subidos + 1}/${pendientes.length}...`);
        await firstValueFrom(
          this.http.post(`${environment.apiUrl}/biometrico/registro`, {
            id_empleado:   p.id_empleado,
            lat:           p.lat,
            lon:           p.lon,
            ip:            p.ip || 'offline',
            salida:        p.salida === 1,
            id_capturista: p.id_capturista,
          })
        );
        await this.sqlite.marcarEnviado(p.id);
        subidos++;
      } catch {
        await this.sqlite.incrementarIntentos(p.id);
        errores++;
      }
    }

    return { subidos, errores };
  }

  // ── Monitor de conexión — sube pendientes automático ─
  // OJO -- esto ya existía pero nunca se llamaba desde ningún lado del
  // app (ni app.component ni ninguna página lo invocaba), por eso nunca
  // subía nada solo. Se activa ahora desde AppComponent al arrancar.
  private monitorActivo = false;

  iniciarMonitorRed(): void {
    if (this.monitorActivo) return; // evita duplicar el listener si se llama 2 veces
    this.monitorActivo = true;

    Network.addListener('networkStatusChange', async (status) => {
      if (status.connected) {
        await this.sqlite.init(); // por si esta es la primera pantalla que toca sqlite
        const pendientes = await this.sqlite.totalPendientes();
        if (pendientes > 0) {
          console.log(`[Sync] Conexión detectada, subiendo ${pendientes} pendientes...`);
          await this.subirPendientes();
        }
      }
    });
  }

  // ── Reintento periódico ───────────────────────────────
  // Además del listener de arriba (que depende de que el SO dispare el
  // evento de cambio de red, y algunos Android no lo hacen siempre
  // confiable), esto revisa cada cierto tiempo sin depender de ningún
  // evento: si hay internet Y hay pendientes, los sube. "después de
  // cierto tiempo o cuando detecte internet" -- esto cubre el "cierto
  // tiempo".
  private intervaloReintento: any = null;

  iniciarReintentosPeriodicos(minutos = 5): void {
    if (this.intervaloReintento) return; // ya estaba corriendo
    this.intervaloReintento = setInterval(async () => {
      try {
        await this.sqlite.init();
        const conectado = await this.hayInternet();
        if (!conectado) return;
        const pendientes = await this.sqlite.totalPendientes();
        if (pendientes > 0) {
          console.log(`[Sync] Revisión periódica -- subiendo ${pendientes} pendientes...`);
          await this.subirPendientes();
        }
      } catch (err) {
        console.error('[Sync] Error en reintento periódico:', err);
      }
    }, minutos * 60 * 1000);
  }

  detenerReintentosPeriodicos(): void {
    if (this.intervaloReintento) {
      clearInterval(this.intervaloReintento);
      this.intervaloReintento = null;
    }
  }
}
