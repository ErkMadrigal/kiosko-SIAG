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
  async buscarEmpleado(query: string, salida: boolean = false): Promise<Empleado> {
    const res: any = await firstValueFrom(
      this.api.post('/biometrico/buscar', { query, salida })
    );
    const emp = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!emp) throw new Error('Empleado no encontrado');
    return emp as Empleado;
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

  // ── Registrar asistencia ────────────────────────────
  async registrarAsistencia(params: {
    id_empleado: number;
    lat: number | null;
    lon: number | null;
    ip: string;
    salida: boolean;
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
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
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
