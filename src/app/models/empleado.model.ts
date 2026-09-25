export interface Empleado {
  id: number;
  nombreCompleto: string;
  curp: string;
  rfc: string;
  puesto: string;
  fotos: string | null;
  // NUEVO -- enrolamiento facial (2 capturas en vivo, más preciso que
  // derivar el descriptor solo de la foto de perfil).
  rostro_enrolado?: number | boolean;
  descriptor_servidor?: string | null; // JSON de 128 floats, si ya está enrolado
}

export interface ApiResponse<T> {
  status: string;
  data: T;
  message?: string;
}

export interface SimilarityResult {
  score: number;
  similar: boolean;
}
