export interface Empleado {
  id: number;
  nombreCompleto: string;
  curp: string;
  rfc: string;
  puesto: string;
  fotos: string | null;
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
