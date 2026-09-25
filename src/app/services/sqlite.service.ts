import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

@Injectable({ providedIn: 'root' })
export class SqliteService {

  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db!: SQLiteDBConnection;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    // Evita carreras si dos cosas llaman init() casi al mismo tiempo
    // (ej. la página y el monitor de red de SyncService).
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // NUEVO -- en navegador (ng serve / build web) el plugin necesita
      // el custom element <jeep-sqlite> (ya está en index.html) y que
      // se inicialice su "web store" (IndexedDB) ANTES de abrir
      // cualquier conexión. En Android/iOS nativo esto se salta -- ahí
      // el plugin habla directo con SQLite del sistema operativo.
      if (Capacitor.getPlatform() === 'web') {
        await customElements.whenDefined('jeep-sqlite');
        await this.sqlite.initWebStore();
      }

      // Si ya existe una conexión 'kiosko_siag' abierta de antes (ej. el
      // dev-server de Angular recargó el módulo pero el web store de
      // IndexedDB/jeep-sqlite quedó vivo), createConnection() truena con
      // "Connection already exists". En vez de dejar init() fallando para
      // siempre, se reutiliza la conexión existente.
      try {
        const existe = await this.sqlite.isConnection('kiosko_siag', false);
        if (existe.result) {
          this.db = await this.sqlite.retrieveConnection('kiosko_siag', false);
        } else {
          this.db = await this.sqlite.createConnection('kiosko_siag', false, 'no-encryption', 1, false);
        }
      } catch {
        this.db = await this.sqlite.createConnection('kiosko_siag', false, 'no-encryption', 1, false);
      }

      const abierta = await this.db.isDBOpen();
      if (!abierta.result) {
        await this.db.open();
      }
      await this.crearTablas();
      this.ready = true;
    })();

    try {
      await this.initPromise;
    } catch (err) {
      // Sin esto, un fallo (ej. el wasm tardó en cargar la primera vez)
      // dejaba this.initPromise apuntando a una promesa rechazada para
      // siempre -- cualquier llamada futura a init() volvía a fallar de
      // inmediato sin reintentar. Al limpiarla, la siguiente llamada a
      // init() (ej. la próxima acción del usuario) vuelve a intentarlo
      // desde cero en vez de quedarse muerta.
      this.initPromise = null;
      this.ready = false;
      throw err;
    }

    return this.initPromise;
  }

  /** Todos los métodos públicos pasan por aquí antes de tocar this.db --
   *  así ninguno depende de que quien lo llame se haya acordado de hacer
   *  sqlite.init() primero (antes SyncService.sincronizarUbicacion() no
   *  lo hacía, y por eso tronaba "database not opened" al sincronizar). */
  private async ready_(): Promise<void> {
    if (!this.ready) await this.init();
  }

  private async crearTablas(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS empleados (
        id              INTEGER PRIMARY KEY,
        nombre_completo TEXT NOT NULL,
        curp            TEXT,
        rfc             TEXT,
        fotos           TEXT,
        id_turno        INTEGER,
        puesto          TEXT,
        ubicacion_id    INTEGER,
        descriptor      TEXT,
        sync_at         TEXT,
        rostro_enrolado INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS asistencias_pendientes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        id_empleado     INTEGER NOT NULL,
        lat             REAL,
        lon             REAL,
        ip              TEXT,
        salida          INTEGER DEFAULT 0,
        id_capturista   INTEGER DEFAULT 0,
        fecha_local     TEXT,
        intentos        INTEGER DEFAULT 0,
        enviado         INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS config (
        clave TEXT PRIMARY KEY,
        valor TEXT
      );
    `);

    // Migración para dispositivos que ya tenían la tabla `empleados`
    // creada ANTES de agregar la columna rostro_enrolado -- CREATE
    // TABLE IF NOT EXISTS no la agrega si la tabla ya existía. Se
    // ignora el error si la columna ya está (SQLite no tiene
    // "ADD COLUMN IF NOT EXISTS").
    try {
      await this.db.execute(`ALTER TABLE empleados ADD COLUMN rostro_enrolado INTEGER DEFAULT 0;`);
    } catch { /* la columna ya existía -- no pasa nada */ }
  }

  // ── CONFIG ──────────────────────────────────────────
  async setConfig(clave: string, valor: string): Promise<void> {
    await this.ready_();
    await this.db.run(
      'INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)',
      [clave, valor]
    );
  }

  async getConfig(clave: string): Promise<string | null> {
    await this.ready_();
    const r = await this.db.query('SELECT valor FROM config WHERE clave = ?', [clave]);
    return r.values?.[0]?.valor ?? null;
  }

  // ── EMPLEADOS ────────────────────────────────────────
  async guardarEmpleado(emp: any, descriptor: string): Promise<void> {
    await this.ready_();
    await this.db.run(`
      INSERT OR REPLACE INTO empleados
        (id, nombre_completo, curp, rfc, fotos, id_turno, puesto, ubicacion_id, descriptor, sync_at, rostro_enrolado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      emp.id, emp.nombreCompleto, emp.curp, emp.rfc,
      emp.fotos, emp.id_turno, emp.puesto,
      emp.id_ubicacion_principal, descriptor,
      new Date().toISOString(),
      emp.rostro_enrolado ? 1 : 0,
    ]);
  }

  async getEmpleados(): Promise<any[]> {
    await this.ready_();
    const r = await this.db.query('SELECT * FROM empleados');
    return r.values ?? [];
  }

  async getEmpleado(id: number): Promise<any | null> {
    await this.ready_();
    const r = await this.db.query('SELECT * FROM empleados WHERE id = ?', [id]);
    return r.values?.[0] ?? null;
  }

  async eliminarEmpleado(id: number): Promise<void> {
    await this.ready_();
    await this.db.run('DELETE FROM empleados WHERE id = ?', [id]);
  }

  async totalEmpleados(): Promise<number> {
    await this.ready_();
    const r = await this.db.query('SELECT COUNT(*) as total FROM empleados');
    return r.values?.[0]?.total ?? 0;
  }

  // ── ASISTENCIAS PENDIENTES ───────────────────────────
  async guardarAsistenciaPendiente(data: {
    id_empleado:   number;
    lat:           number;
    lon:           number;
    ip:            string;
    salida:        boolean;
    id_capturista: number;
  }): Promise<void> {
    await this.ready_();
    await this.db.run(`
      INSERT INTO asistencias_pendientes
        (id_empleado, lat, lon, ip, salida, id_capturista, fecha_local)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      data.id_empleado, data.lat, data.lon, data.ip,
      data.salida ? 1 : 0, data.id_capturista,
      new Date().toISOString()
    ]);
  }

  async getPendientes(): Promise<any[]> {
    await this.ready_();
    const r = await this.db.query(
      'SELECT * FROM asistencias_pendientes WHERE enviado = 0 ORDER BY id ASC'
    );
    return r.values ?? [];
  }

  async marcarEnviado(id: number): Promise<void> {
    await this.ready_();
    await this.db.run('UPDATE asistencias_pendientes SET enviado = 1 WHERE id = ?', [id]);
  }

  async incrementarIntentos(id: number): Promise<void> {
    await this.ready_();
    await this.db.run('UPDATE asistencias_pendientes SET intentos = intentos + 1 WHERE id = ?', [id]);
  }

  async totalPendientes(): Promise<number> {
    await this.ready_();
    const r = await this.db.query(
      'SELECT COUNT(*) as total FROM asistencias_pendientes WHERE enviado = 0'
    );
    return r.values?.[0]?.total ?? 0;
  }
}
