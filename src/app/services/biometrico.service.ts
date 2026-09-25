import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { Empleado, SimilarityResult } from '../models/empleado.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BiometricoService {

  constructor(
    private api: ApiService,
    private http: HttpClient,
  ) {}

  // ── Buscar empleado por CURP, RFC o número ──────────
  async buscarEmpleado(query: string): Promise<Empleado> {
    const res: any = await firstValueFrom(
      this.api.post('/auth/biometrico/buscar', { query })
    );
    const emp = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!emp) throw new Error('Empleado no encontrado');
    return emp as Empleado;
  }

  // ── Verificar estado ANTES de abrir cámara ──────────
  // Llama al backend para saber si el empleado puede registrar
  // entrada o salida SIN gastar tokens de Luxand.
  // Retorna: { puede: true } o { puede: false, bloqueado: true, data: {...} }
  //          o { puede: false, error: true, message: '...' }
  async verificarEstado(idEmpleado: number, esSalida: boolean): Promise<{
    puede:     boolean;
    bloqueado?: boolean;
    error?:     boolean;
    message?:   string;
    data?: {
      hora_salida_valida?: string;
      tiempo_restante?:    string;
      minutos_restantes?:  number;
    };
  }> {
    try {
      const res: any = await firstValueFrom(
        this.api.get(`/biometrico/estado/${idEmpleado}?salida=${esSalida ? 1 : 0}`)
      );

      // Backend dice OK — puede registrar
      if (res.status === 'ok') {
        return { puede: true };
      }

      // Backend dice bloqueado (salida anticipada)
      if (res.status === 'bloqueado') {
        return { puede: false, bloqueado: true, data: res.data, message: res.message };
      }

      // Cualquier otro error conocido (doble entrada, etc.)
      return { puede: false, error: true, message: res.message || 'No se puede registrar' };

    } catch (err: any) {
      // HTTP 423 — salida bloqueada
      if (err?.status === 423) {
        return { puede: false, bloqueado: true, data: err.error?.data, message: err.error?.message };
      }
      // HTTP 409 — doble entrada/salida
      if (err?.status === 409) {
        return { puede: false, error: true, message: err.error?.message || 'Registro duplicado' };
      }
      // Error de red u otro
      return { puede: false, error: true, message: 'Error de conexión' };
    }
  }

  // ── Descargar foto del empleado como Blob ───────────
  async descargarFoto(url: string): Promise<Blob> {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo descargar la foto');
    return res.blob();
  }

  // ── Comparar rostros con Luxand ─────────────────────
  async compararRostros(foto1: Blob, foto2: Blob): Promise<SimilarityResult> {
    const headers = new HttpHeaders({ 'token': environment.luxandToken });
    const form = new FormData();
    form.append('face1', foto1, 'face1.jpg');
    form.append('face2', foto2, 'face2.jpg');

    const res: any = await firstValueFrom(
      this.http.post('https://api.luxand.cloud/photo/similarity', form, { headers })
    );

    return {
      score:   res.score   ?? 0,
      similar: res.similar ?? false,
    };
  }

  // ── Registrar entrada/salida biométrica ─────────────
  async registrarAsistenciaLegacy(params: {
    id_empleado:    number;
    lat:            number | null;
    lon:            number | null;
    ip:             string;
    salida:         boolean;
    id_capturista?: number;
  }): Promise<any> {
    return firstValueFrom(
      this.api.post('/biometrico/registro', params)
    );
  }

  // ── Obtener IP pública ──────────────────────────────
  async obtenerIP(): Promise<string> {
    try {
      const res: any = await firstValueFrom(
        this.http.get('https://api.ipify.org?format=json')
      );
      return res.ip;
    } catch {
      return 'No disponible';
    }
  }

  // ── Obtener geolocalización ─────────────────────────
  obtenerGeo(): Promise<{ lat: number; lon: number }> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        err => reject(err),
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 30000 } // ← cambios aquí
      );
    });
  }

  // ── Enrolamiento facial (estilo Cheil) ──────────────
  // 2 capturas en vivo: descriptorGuardar es la que se guarda,
  // descriptorVerificar es una segunda inmediata solo para confirmar
  // calidad (el backend calcula la distancia entre ambas y rechaza si
  // no coinciden lo suficiente).
  async enrolarRostro(
    idEmpleado: number,
    descriptorGuardar: number[],
    descriptorVerificar: number[],
    idCapturista?: number,
  ): Promise<{ status: string; message: string; distancia?: number }> {
    return firstValueFrom(
      this.api.post('/biometrico/enrolar', {
        id_empleado: idEmpleado,
        descriptor_guardar: descriptorGuardar,
        descriptor_verificar: descriptorVerificar,
        id_capturista: idCapturista ?? 0,
      })
    );
  }

  async buscarOperador(query: string): Promise<Empleado> {
    const res: any = await firstValueFrom(
      this.api.post('/biometrico/buscar-login', { query })
    );
    const emp = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!emp) throw new Error('Empleado no encontrado');
    return emp as Empleado;
  }
}

export interface RegistroResponse {
  status:  'ok' | 'bloqueado';
  tipo:    'entrada' | 'salida' | 'salida_anticipada';
  data?: {
    estado_entrada?:       'puntual' | 'retardo_leve' | 'retardo_grave';
    minutos_retardo?:      number;
    hora_salida_esperada?: string;
    turno?:                string;
    estado_salida?:        'normal' | 'tardanza_salida';
    hora_salida_valida?:   string;
    tiempo_restante?:      string;
    minutos_restantes?:    number;
    mensaje_supervisor?:   string;
  };
}
