import { Injectable } from '@angular/core';
import * as faceapi from '@vladmandic/face-api';

export interface DescriptorResult {
  descriptor: Float32Array;
  score:      number;
}

export interface ComparacionResult {
  similar:   boolean;
  distancia: number;
  score:     number; // 0-1, más alto = más similar
}

@Injectable({ providedIn: 'root' })
export class TensorflowService {

  private modelosCargados = false;
  private cargando        = false;

  // Umbral de distancia — menor = más estricto
  // 0.4 es estricto, 0.5 es moderado, 0.6 es permisivo
  private readonly UMBRAL_DISTANCIA = 0.376;

  // ── Cargar modelos una sola vez ──────────────────────────────────
  async cargarModelos(): Promise<void> {
    if (this.modelosCargados || this.cargando) return;
    this.cargando = true;

    try {
      // Los modelos deben estar en assets/models/
      const modelPath = '/assets/models';

      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);

      this.modelosCargados = true;
      console.log('[TF] Modelos cargados correctamente');
    } catch (err) {
      console.error('[TF] Error cargando modelos:', err);
      throw new Error('No se pudieron cargar los modelos de reconocimiento facial');
    } finally {
      this.cargando = false;
    }
  }

  get listo(): boolean { return this.modelosCargados; }

  // ── Generar descriptor desde URL de foto ─────────────────────────
  // Úsalo en el enrollment: cargar foto del empleado desde BD
  async generarDescriptorDesdeUrl(url: string): Promise<Float32Array | null> {
    await this.cargarModelos();

    try {
      const img = await faceapi.fetchImage(url);
      const deteccion = await faceapi
        .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.7 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!deteccion) {
        console.warn('[TF] No se detectó rostro en la foto de referencia');
        return null;
      }

      return deteccion.descriptor;
    } catch (err) {
      console.error('[TF] Error generando descriptor desde URL:', err);
      return null;
    }
  }

  // ── Generar descriptor desde Blob (foto capturada por cámara) ────
  async generarDescriptorDesdeBlob(blob: Blob): Promise<Float32Array | null> {
    await this.cargarModelos();
    try {
      const url = URL.createObjectURL(blob);
      const img = await faceapi.fetchImage(url);
      URL.revokeObjectURL(url);

      // Detecta con confianza más baja para no perder el rostro
      const deteccion = await faceapi
        .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!deteccion) return null;
      return deteccion.descriptor;
    } catch (err) {
      console.error('[TF] Error generando descriptor desde blob:', err);
      return null;
    }
  }

  // ── Generar descriptor desde HTMLVideoElement (stream de cámara) ─
  async generarDescriptorDesdeVideo(video: HTMLVideoElement): Promise<Float32Array | null> {
    await this.cargarModelos();

    try {
      const deteccion = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!deteccion) return null;
      return deteccion.descriptor;
    } catch (err) {
      console.error('[TF] Error generando descriptor desde video:', err);
      return null;
    }
  }

  // ── Comparar dos descriptores ─────────────────────────────────────
  comparar(descriptor1: Float32Array, descriptor2: Float32Array): ComparacionResult {
    const distancia = faceapi.euclideanDistance(descriptor1, descriptor2);
    const score     = Math.max(0, Math.min(1, Math.pow(1 - distancia, 0.5)));
    const similar   = score >= 0.79; // ← match si score es 79%+
    return { similar, distancia, score };
  }

  // ── Serializar descriptor para guardar en SQLite/localStorage ────
  serializarDescriptor(descriptor: Float32Array): string {
    return JSON.stringify(Array.from(descriptor));
  }

  // ── Deserializar descriptor desde SQLite/localStorage ─────────────
  deserializarDescriptor(json: string): Float32Array {
    return new Float32Array(JSON.parse(json));
  }

  // ── Detectar si hay un rostro en el video (para el scanner loop) ─
  async detectarRostro(video: HTMLVideoElement): Promise<boolean> {
    if (!this.modelosCargados) return false;
    try {
      const det = await faceapi.detectSingleFace(
        video,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      );
      return !!det;
    } catch {
      return false;
    }
  }
}
