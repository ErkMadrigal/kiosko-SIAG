import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http'; // ← agrega HttpClientModule aquí
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cloudDownloadOutline, searchOutline, trashOutline,
  checkmarkCircleOutline, alertCircleOutline, syncOutline,
  wifiOutline, cloudOfflineOutline, locationOutline  // ← agrega locationOutline
} from 'ionicons/icons';
import { SqliteService } from '../../services/sqlite.service';
import { SyncService } from '../../services/sync.service';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-setup',
  templateUrl: './setup.page.html',
  styleUrls: ['./setup.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, HttpClientModule],

})
export class SetupPage implements OnInit, OnDestroy {

  // Config -- NUEVO: ahora se busca la ubicación por NOMBRE en vez de
  // capturar el ID a mano. ubicacionSeleccionada es lo que de verdad se
  // manda al sincronizar; queryUbicacion es solo el texto de búsqueda.
  queryUbicacion         = '';
  resultadosUbicacion: { id: number; nombre: string }[] = [];
  buscandoUbicacion      = false;
  ubicacionSeleccionada: { id: number; nombre: string } | null = null;
  private debounceUbicacion: any = null;

  queryBuscar  = '';

  // Estado
  cargando     = false;
  progreso     = '';
  mensaje      = '';
  tipoMensaje  = ''; // ok | error

  // Datos
  empleados:    any[] = [];
  pendientes    = 0;
  ultimaSync    = '';
  hayInternet   = false;
  private netListener?: PluginListenerHandle;

  constructor(
    private sqlite: SqliteService,
    private sync:   SyncService,
    private router: Router,
    private http:   HttpClient,
  ) {
    addIcons({
      cloudDownloadOutline, searchOutline, trashOutline,
      checkmarkCircleOutline, alertCircleOutline, syncOutline,
      wifiOutline, cloudOfflineOutline, locationOutline  // ← agrega
    });
  }

  async ngOnInit() {
    await this.sqlite.init();
    await this.cargarEstado();
    this.hayInternet = await this.sync.hayInternet();

    // NUEVO -- antes hayInternet se calculaba UNA sola vez al entrar a
    // la pantalla y ya se quedaba pegado con ese valor para siempre.
    // Si el kiosko se conectaba a wifi DESPUÉS de abrir esta pantalla
    // (lo normal), el badge seguía diciendo "Sin conexión" y los
    // botones de Sync/Agregar seguían bloqueados aunque ya hubiera
    // internet de verdad. Con este listener el badge se actualiza solo.
    this.netListener = await Network.addListener('networkStatusChange', (status) => {
      this.hayInternet = status.connected;
    });
  }

  ngOnDestroy() {
    this.netListener?.remove();
    if (this.debounceUbicacion) clearTimeout(this.debounceUbicacion);
  }

  async cargarEstado() {
    this.empleados   = await this.sqlite.getEmpleados();
    this.pendientes  = await this.sqlite.totalPendientes();
    this.ultimaSync  = await this.sqlite.getConfig('ultima_sync') ?? '';

    // Si ya había una ubicación configurada de una sync anterior, se
    // muestra como "seleccionada" (aunque solo tengamos el id guardado
    // -- no el nombre bonito, pero al menos no se ve vacío).
    const ubId = await this.sqlite.getConfig('ubicacion_id');
    if (ubId && !this.ubicacionSeleccionada) {
      this.ubicacionSeleccionada = { id: parseInt(ubId), nombre: `Ubicación #${ubId}` };
    }
  }

  // ── Buscar ubicación por NOMBRE (con debounce) ────────
  onInputUbicacion() {
    this.ubicacionSeleccionada = null; // si vuelve a teclear, invalida la selección previa
    if (this.debounceUbicacion) clearTimeout(this.debounceUbicacion);

    const texto = this.queryUbicacion.trim();
    if (texto.length < 3) {
      this.resultadosUbicacion = [];
      return;
    }

    this.debounceUbicacion = setTimeout(async () => {
      if (!this.hayInternet) return; // buscar en el catálogo sí necesita internet
      this.buscandoUbicacion = true;
      try {
        this.resultadosUbicacion = await this.sync.buscarUbicaciones(texto);
      } catch (err) {
        console.error('Error buscando ubicaciones:', err);
        this.resultadosUbicacion = [];
      } finally {
        this.buscandoUbicacion = false;
      }
    }, 400);
  }

  elegirUbicacion(u: { id: number; nombre: string }) {
    this.ubicacionSeleccionada = u;
    this.queryUbicacion        = u.nombre;
    this.resultadosUbicacion   = [];
  }

  limpiarUbicacion() {
    this.ubicacionSeleccionada = null;
    this.queryUbicacion        = '';
    this.resultadosUbicacion   = [];
  }

  // ── Sync por ubicación ───────────────────────────────
  async sincronizar() {
    if (!this.ubicacionSeleccionada) {
      this.showMsg('Busca y selecciona una ubicación primero', 'error'); return;
    }
    // NUEVO -- revisa la conexión EN ESE MOMENTO, no el valor que se
    // haya calculado cuando se abrió la pantalla.
    const conectado = await this.sync.hayInternet();
    this.hayInternet = conectado;
    if (!conectado) {
      this.showMsg('Sin conexión a internet', 'error'); return;
    }

    this.cargando = true;
    this.mensaje  = '';
    try {
      const result = await this.sync.sincronizarUbicacion(
        this.ubicacionSeleccionada.id,
        (msg) => this.progreso = msg
      );
      await this.cargarEstado();
      this.showMsg(
        `✅ ${result.procesados} empleados sincronizados${result.errores ? ` · ${result.errores} errores` : ''}`,
        'ok'
      );
    } catch (err: any) {
      this.showMsg('Error al sincronizar: ' + err.message, 'error');
    } finally {
      this.cargando = false;
      this.progreso = '';
    }
  }

  // ── Agregar empleado individual ──────────────────────
  async buscarYAgregar() {
    if (!this.queryBuscar.trim()) {
      this.showMsg('Ingresa CURP, RFC o número', 'error'); return;
    }
    const conectado = await this.sync.hayInternet();
    this.hayInternet = conectado;
    if (!conectado) {
      this.showMsg('Sin conexión a internet', 'error'); return;
    }

    this.cargando = true;
    this.mensaje  = '';
    try {
      const emp = await this.sync.agregarEmpleado(
        this.queryBuscar.trim(),
        (msg) => this.progreso = msg
      );
      this.queryBuscar = '';
      await this.cargarEstado();
      this.showMsg(`✅ ${emp.nombreCompleto} agregado`, 'ok');
    } catch (err: any) {
      this.showMsg('No se encontró el empleado', 'error');
    } finally {
      this.cargando = false;
      this.progreso = '';
    }
  }

  // ── Subir pendientes ─────────────────────────────────
  async subirPendientes() {
    const conectado = await this.sync.hayInternet();
    this.hayInternet = conectado;
    if (!conectado) {
      this.showMsg('Sin conexión a internet', 'error'); return;
    }
    this.cargando = true;
    try {
      const r = await this.sync.subirPendientes(
        (msg) => this.progreso = msg
      );
      await this.cargarEstado();
      this.showMsg(`✅ ${r.subidos} subidos${r.errores ? ` · ${r.errores} errores` : ''}`, 'ok');
    } catch {
      this.showMsg('Error al subir pendientes', 'error');
    } finally {
      this.cargando = false;
      this.progreso = '';
    }
  }

  // ── Eliminar empleado ────────────────────────────────
  async eliminarEmpleado(id: number, nombre: string) {
    if (!confirm(`¿Eliminar a ${nombre} del dispositivo?`)) return;
    await this.sqlite.eliminarEmpleado(id);
    await this.cargarEstado();
    this.showMsg(`${nombre} eliminado`, 'ok');
  }

  // ── Ir al home ───────────────────────────────────────
  irHome() {
    this.router.navigate(['/home'], { replaceUrl: true });
  }

  private showMsg(msg: string, tipo: string) {
    this.mensaje    = msg;
    this.tipoMensaje = tipo;
    setTimeout(() => this.mensaje = '', 4000);
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  getInitials(n: string): string {
    return n?.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase() || '??';
  }

  async obtenerUbicacionGPS() {
    this.cargando = true;
    this.progreso = 'Obteniendo ubicación GPS...';
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      this.progreso = 'Buscando ubicación más cercana...';

      // Llama al EP que devuelve la ubicación más cercana
      const res: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/biometrico/ubicacion-cercana?lat=${lat}&lon=${lon}`)
      );

      if (res.status === 'ok') {
        this.ubicacionSeleccionada = { id: res.data.id, nombre: res.data.nombre };
        this.queryUbicacion        = res.data.nombre;
        this.resultadosUbicacion   = [];
        this.showMsg(`✅ Ubicación detectada: ${res.data.nombre}`, 'ok');
      } else {
        this.showMsg('No se encontró ubicación cercana', 'error');
      }

    } catch (err: any) {
      this.showMsg('No se pudo obtener GPS: ' + err.message, 'error');
    } finally {
      this.cargando = false;
      this.progreso = '';
    }
  }
}
